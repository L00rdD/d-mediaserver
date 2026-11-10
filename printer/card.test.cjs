// Tests of the home page's printer card (home/site/printer.js) on a fake page:
// node --test printer/
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "../home/site/printer.js");
const SCENE = path.join(__dirname, "../home/site/printer-scene.js");

// The card: each [data-pr=...] element as a plain object, and the fetch answer
function page(answer, { full = false, view = false } = {}) {
  const parts = {};
  const classes = new Set();
  const card = {
    hidden: true,
    dataset: full ? { page: "" } : {},
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    addEventListener: (type, fn) => (card.click = fn),
    querySelector: (sel) => {
      const key = sel.match(/"(.+)"/)[1];
      if (key === "view" && !view) return null;
      return (parts[key] ??= { textContent: "", style: {}, hidden: true, src: "" });
    },
  };
  globalThis.document = { getElementById: (id) => (id === "printer" ? card : null) };
  globalThis.setInterval = () => 0;
  globalThis.fetch = async () => {
    if (answer instanceof Error) throw answer;
    return { ok: answer !== 404, json: async () => answer };
  };
  return { card, text: (key) => card.querySelector(`[data-pr="${key}"]`).textContent, part: (key) => card.querySelector(`[data-pr="${key}"]`) };
}

async function run() {
  delete require.cache[SCRIPT];
  require(SCRIPT);
  await new Promise((done) => setImmediate(done));
}

const now = () => new Date().toISOString();

test("shows the print going on", async () => {
  const { card, text, part } = page({
    online: true, checked_at: now(), name: "M7", cloud: "ok",
    job: { state: "printing", active: true, name: "04_riser", progress: 37.4, layer: 740, layers: 2000, remaining_min: 95, started_at: now(), image: "https://x/p.png" },
  });
  await run();
  assert.equal(card.hidden, false);
  assert.equal(text("name"), "M7");
  assert.equal(text("state"), "Printing");
  assert.equal(text("file"), "04_riser");
  assert.equal(text("pct"), "37%");
  assert.equal(text("layers"), "layer 740 / 2000");
  assert.equal(text("left"), "1h 35m");
  assert.match(text("end"), /^done at /);
  assert.match(text("note"), /^started /);
  assert.equal(part("fill").style.width, "37.4%");
  assert.equal(part("image").src, "https://x/p.png");
  assert.equal(part("image").hidden, false);
});

test("progress from the layers when the cloud gives none, short time left", async () => {
  const { text } = page({ online: true, checked_at: now(), job: { state: "levelling", active: true, layer: 50, layers: 200, remaining_min: 12 } });
  await run();
  assert.equal(text("state"), "Levelling");
  assert.equal(text("pct"), "25%");
  assert.equal(text("left"), "12m");
});

test("a finished print: ready, no time left", async () => {
  const { text, part } = page({ online: true, checked_at: now(), cloud: "ok", job: { state: "done", active: false, name: "lid", progress: 100, remaining_min: 0 } });
  await run();
  assert.equal(text("state"), "Ready · last print done");
  assert.equal(text("left"), "–");
  assert.equal(text("end"), "");
  assert.equal(part("image").hidden, true);
});

test("on without a token: says how to follow the print", async () => {
  const { card, text } = page({ online: true, checked_at: now(), cloud: "no token", job: null });
  await run();
  assert.equal(card.hidden, false);
  assert.equal(text("name"), "Anycubic");
  assert.equal(text("state"), "Ready");
  assert.equal(text("file"), "–");
  assert.equal(text("pct"), "–");
  assert.equal(text("layers"), "");
  assert.equal(text("note"), "Set ANYCUBIC_TOKEN to follow the print");
});

test("unknown cloud word and no start time: empty note", async () => {
  const { text } = page({ online: true, checked_at: now(), cloud: "ok", job: { state: "weird", active: true } });
  await run();
  assert.equal(text("state"), "weird");
  assert.equal(text("note"), "");
});

for (const [why, answer] of [
  ["the printer is off", { online: false, checked_at: now() }],
  ["the service stopped writing", { online: true, checked_at: "2020-01-01T00:00:00Z" }],
  ["the service is off", 404],
  ["the page cannot reach the server", new Error("offline")],
]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page(answer);
    await run();
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  globalThis.document = { getElementById: () => null };
  await run();
});

test("full view: stays when the printer is off and says so", async () => {
  const { card, text } = page({ online: false, checked_at: now() }, { full: true });
  await run();
  assert.equal(card.hidden, false);
  assert.equal(card.classList.contains("off"), true);
  assert.equal(text("state"), "Switched off");
});

test("dims what is left of the picture, shows the local copy", async () => {
  const { part, text } = page({ online: true, checked_at: now(), job: { state: "printing", active: true, progress: 40, preview: "/printer.jpg?k", image: "https://x/p.png", resin_ml: 99.5 } });
  await run();
  assert.equal(part("ghost").style.height, "60%");
  assert.equal(part("image").src, "/printer.jpg?k");
  assert.equal(part("image").hidden, false);
  assert.equal(text("resin"), "100 ml of resin");
});

test("3D view: mounted once, fed, and a drag does not open the link", async () => {
  const { card, part } = page({ online: true, checked_at: now(), job: { state: "printing", active: true, preview: "/printer.jpg?k" } }, { view: true });
  const fed = [];
  let dragged = false;
  globalThis.window = { WebGLRenderingContext: function () {} };
  const scene = { update: (p) => fed.push(p), dragged: () => dragged };
  globalThis.__printerScene = scene;
  // printer.js imports /printer-scene.js: answer with the fake scene
  const src = require("node:fs").readFileSync(SCRIPT, "utf8").replace('import("/printer-scene.js")', "Promise.resolve({ mountPrinter: async (v, o) => (o.onPicture('/printer.jpg?k', 'data:cropped'), globalThis.__printerScene) })");
  new Function(src)();
  await new Promise((done) => setImmediate(done));
  await new Promise((done) => setImmediate(done));
  assert.equal(fed.length, 1);
  assert.equal(part("view").hidden, false);
  assert.equal(part("image").hidden, false);
  // the cropped picture from the 3D view replaces the slicer's
  assert.equal(part("image").src, "data:cropped");
  let prevented = false;
  card.click({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, false);
  dragged = true;
  card.click({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  delete globalThis.window;
});

test("3D view: picture kept when the scene cannot load", async () => {
  const { part } = page({ online: true, checked_at: now(), job: { state: "printing", active: true, image: "https://x/p.png" } }, { view: true });
  globalThis.window = { WebGLRenderingContext: function () {} };
  const src = require("node:fs").readFileSync(SCRIPT, "utf8").replace('import("/printer-scene.js")', "Promise.reject(new Error('no WebGL'))");
  new Function(src)();
  await new Promise((done) => setImmediate(done));
  await new Promise((done) => setImmediate(done));
  assert.equal(part("view").hidden, true);
  assert.equal(part("image").hidden, false);
  delete globalThis.window;
});

test("scene helpers", async () => {
  const s = await import(SCENE);
  // a 4 × 2 picture: background grey, one dark pixel at (2, 1)
  const px = new Uint8ClampedArray(4 * 2 * 4).fill(238);
  px.set([20, 40, 200, 255], (1 * 4 + 2) * 4);
  assert.deepEqual(s.keyOut(px, 4, 2), { x: 2, y: 1, w: 1, h: 1 });
  assert.equal(px[3], 0);
  assert.equal(px[(1 * 4 + 2) * 4 + 3], 255);
  assert.equal(s.keyOut(new Uint8ClampedArray(16).fill(9), 2, 2), null);

  assert.equal(s.plateHeight(null), 200);
  assert.equal(s.plateHeight({ active: false, layer: 10 }), 200);
  assert.equal(s.plateHeight({ active: true, layer: 100, layer_mm: 0.05 }), 5);
  assert.equal(s.plateHeight({ active: true, layer: 100 }), 5);

  assert.deepEqual(s.partSize({ height_mm: 150 }, { w: 100, h: 50 }), { h: 150, w: 223 });
  assert.deepEqual(s.partSize(null, { w: 50, h: 100 }), { h: 100, w: 50 });

  const [x, y, z] = s.orbit(0, 0, 100);
  assert.deepEqual([Math.round(x), Math.round(y), Math.round(z)], [0, 105, 100]);
  assert.equal(s.focus(0), 40);
  assert.equal(s.focus(100), 75);
  assert.equal(s.focus(300), 120);
  assert.equal(s.clamp(5, 0, 3), 3);
  assert.equal(s.clamp(-1, 0, 3), 0);
});
