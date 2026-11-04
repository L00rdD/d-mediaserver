// Tests of the home page's printer card (home/site/printer.js) on a fake page:
// node --test printer/
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const SCRIPT = path.join(__dirname, "../home/site/printer.js");

// The card: each [data-pr=...] element as a plain object, and the fetch answer
function page(answer) {
  const parts = {};
  const card = {
    hidden: true,
    querySelector: (sel) => (parts[sel.match(/"(.+)"/)[1]] ??= { textContent: "", style: {}, hidden: false, src: "" }),
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
