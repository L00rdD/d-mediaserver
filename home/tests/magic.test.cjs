// Tests of the Hogwarts theme kit's moving magic (home/site/theme/magic.js) on a fake page:
// node --test home/tests/
const test = require("node:test");
const assert = require("node:assert");
const { page, load } = require("./magic-page.cjs");

const panel = (p, top, extra = {}) => p.el("section", { cls: "t-panel", rect: { left: 100, top, width: 400, height: 300 }, ...extra });
const calls = (p, name) => p.log.filter((c) => c[0] === name);
// where the Snitch was last drawn: save, translate to it, then its wings
const snitchAt = (p) => {
  for (let j = p.log.length - 3; j >= 0; j--) {
    if (p.log[j][0] === "save" && p.log[j + 1][0] === "translate" && p.log[j + 2][0] === "=globalCompositeOperation") return p.log[j + 1].slice(1);
  }
  return null;
};

test("starts on a Hogwarts page: the hall at the back, the canvas over the page", () => {
  const p = page();
  const M = load();
  const hall = p.body.children[0];
  assert.equal(hall.className, "t-hall");
  assert.equal(hall.attributes["aria-hidden"], "true");
  assert.deepEqual(hall.children.map((e) => e.className), ["t-sky", "t-mist", "t-rays", "t-runes"]);
  assert.match(hall.children[3].innerHTML, /^<svg viewBox="0 0 1000 1000"/);
  assert.equal(p.canvas().width, 1280 * 1.5); // phones and Retina: 1.5 device pixels at most
  assert.ok(p.root.classList.contains("t-magic"));
  assert.equal(M.running, true);
  assert.equal(load(undefined, false), M, "a second copy of the script leaves the first one alone");
});

test("keeps a page's own hall and moves its layers with the mouse and the scroll", () => {
  const p = page();
  const hall = p.el("div", { cls: "t-hall" });
  const near = p.el("div", { data: { depth: "30", scroll: "0.2" }, parent: hall });
  const flat = p.el("div", { data: { depth: "x" }, parent: hall });
  load();
  assert.equal(p.body.children.filter((e) => e.classList.contains("t-hall")).length, 1);
  assert.equal(hall.children.length, 6);
  p.window("pointermove", { clientX: 1200, clientY: 700 });
  globalThis.scrollY = 100;
  p.run(1);
  const [x, y] = near.style.translate.split(" ").map(parseFloat);
  assert.ok(x < -5 && y < -20, near.style.translate);
  assert.ok(flat.style.translate === undefined || flat.style.translate.startsWith("0.00px"));
  // a hall taken out of the page is built again
  hall.remove();
  globalThis.Magic.stop();
  globalThis.Magic.start();
  assert.equal(p.body.children[0].className, "t-hall");
});

test("a still page gets the hall but nothing that moves", () => {
  for (const make of [() => page({ reduce: true }), () => { const q = page(); q.body.attributes["data-t-calm"] = ""; return q; }]) {
    const p = make();
    const M = load();
    assert.ok(p.body.querySelector(".t-hall"));
    assert.equal(p.canvas(), undefined);
    assert.equal(M.running, false);
    assert.equal(M.emit(1, 1), false);
  }
});

test("another look: nothing; before the body exists: waits for it", () => {
  let p = page({ theme: "reactor" });
  load();
  assert.equal(p.body.children.length, 0);
  p = page({ body: false });
  const M = load();
  assert.equal(M.running, false);
  p.root.children.push(p.body);
  p.body.parent = p.root;
  p.document.fire("DOMContentLoaded");
  assert.equal(M.running, true);
});

test("fireflies and ribbons fill the air; a page with its own air gets a canvas left alone", () => {
  let p = page();
  load();
  p.run(1);
  assert.ok(calls(p, "drawImage").length > 1000);
  assert.ok(calls(p, "lineTo").length > 100, "the ribbons' bright threads");
  p = page({ fine: false });
  p.body.dataset.tAir = "off";
  load();
  p.run(1.5);
  assert.equal(calls(p, "clearRect").length, 1, "cleared once, then nothing to draw");
});

test("the hall's life comes in time: owl post, Snitch, shooting stars, Occamy, Revelio, Patronus", () => {
  const p = page({ seed: 3 });
  p.body.dataset.tHall = "rich";
  panel(p, 100);
  load();
  const seen = new Set();
  let letterHidden = false;
  p.run(80, () => {
    for (const e of p.root.all()) {
      for (const c of e.className.split(" ")) seen.add(c);
      if (e.classList.contains("t-owl") && e.parts?.["t-owl-letter"]?.style.display === "none") letterHidden = true;
    }
    p.log.length = 0;
  });
  for (const c of ["t-owl", "t-letter", "t-patronus", "t-shoot", "t-revealed", "t-glide"]) assert.ok(seen.has(c), c);
  assert.ok(letterHidden, "the owl lets its letter go");
  // they all leave in the end
  p.run(30);
  assert.equal(p.body.children.filter((e) => e.className.includes("t-flyer")).length, 0);
});

test("the Occamy coils across the sky and the Snitch darts about", () => {
  const p = page({ seed: 11 });
  const M = load();
  let wings = 0, loops = 0, snitches = 0;
  for (let k = 0; k < 6; k++) {
    M.occamy();
    M.snitch();
    p.run(12, () => {
      wings += calls(p, "quadraticCurveTo").length;
      snitches += p.log.filter((c) => c[0] === "ellipse" && c[1] === 10).length;
      loops += p.log.filter((c) => c[0] === "arc" && c[5] === Math.PI * 2 && c[3] < 2).length;
      p.log.length = 0;
    });
  }
  assert.ok(wings > 100, "feathers drawn");
  assert.ok(snitches > 100, "wings beating");
  assert.ok(loops > 0);
});

test("a click casts Lumos; a click on the Snitch catches it", () => {
  const p = page();
  const M = load();
  p.run(0.2);
  p.log.length = 0;
  p.window("pointerdown", { clientX: 300, clientY: 300, button: 2 });
  p.run(0.05);
  assert.equal(p.log.filter((c) => c[0] === "arc" && c[1] === 300).length, 0, "not with the right button");
  p.window("pointerdown", { clientX: 300, clientY: 300, button: 0 });
  p.run(0.1);
  assert.ok(p.log.some((c) => c[0] === "arc" && c[1] === 300 && c[2] === 300), "the ring of light");
  M.snitch();
  p.run(1);
  const [x, y] = snitchAt(p);
  p.window("pointerdown", { clientX: x + 5, clientY: y - 5, button: 0 });
  p.log.length = 0;
  p.run(0.05);
  assert.equal(snitchAt(p), null, "caught: gone");
});

test("the wand leaves sparks behind the mouse, not behind a finger", () => {
  const p = page();
  load();
  p.body.dataset.tAir = "off";
  globalThis.Magic.stop();
  globalThis.Magic.start();
  p.run(0.1);
  p.log.length = 0;
  p.window("pointermove", { clientX: 10, clientY: 10, pointerType: "touch" });
  p.window("pointermove", { clientX: 200, clientY: 10, pointerType: "touch" });
  p.run(1 / 60);
  assert.equal(calls(p, "drawImage").length, 0);
  p.window("pointermove", { clientX: 400, clientY: 10, pointerType: "mouse" });
  p.run(1 / 60);
  assert.equal(calls(p, "drawImage").length, 3, "three sparks at most");
  p.document.fire("pointerleave");
});

test("panels gather out of light; scroll boxes are left alone; held ones wait for the intro", () => {
  const p = page();
  p.root.classList.add("t-hold");
  const seen = panel(p, 100);
  const below = panel(p, 2000);
  const box = panel(p, 100, { style: { overflowY: "auto" } });
  const placed = panel(p, 100, { style: { position: "absolute" } });
  const M = load();
  const deco = seen.children.find((e) => e.className === "t-frame");
  assert.equal((deco.innerHTML.match(/t-corner/g) || []).length, 4);
  assert.equal(seen.style.position, "relative");
  assert.equal(placed.style.position, "absolute");
  assert.equal(box.children.length, 0);
  assert.ok(seen.classList.contains("t-wait") && p.observed.has(seen), "held back");
  p.intersections([{ isIntersecting: true, target: seen }]);
  assert.ok(seen.classList.contains("t-wait"), "still held");
  M.release();
  assert.ok(!p.root.classList.contains("t-hold"));
  p.intersections([{ isIntersecting: true, target: seen }, { isIntersecting: false, target: below }]);
  assert.ok(seen.classList.contains("t-in") && !seen.classList.contains("t-wait"));
  assert.ok(!p.observed.has(seen) && p.observed.has(below));
  // drawn by the page long after load: in at once, no flicker
  p.run(3);
  const late = panel(p, 50, { parent: null });
  p.body.append(late);
  p.body.append(p.el("span", { cls: "t-frame", parent: null }));
  p.run(0.1);
  assert.ok(late.classList.contains("t-in-now"));
});

test("in view at once: the panel's edges light up", () => {
  const p = page();
  const seen = panel(p, 100);
  load();
  p.run(0.1);
  assert.ok(seen.classList.contains("t-in"));
  assert.ok(calls(p, "drawImage").length > 0);
});

test("Revelio lights up the panels it passes, for a while", () => {
  const p = page();
  const near = panel(p, 100);
  const away = panel(p, 3000);
  const M = load();
  const events = [];
  p.document.addEventListener("magic:revelio", (e) => events.push(e.detail));
  M.revelio();
  assert.deepEqual(events, [{ x: 640, y: 800 * 0.45 }]);
  p.run(0.6);
  assert.ok(near.classList.contains("t-revealed"));
  assert.ok(!away.classList.contains("t-revealed"));
  p.run(2);
  assert.ok(!near.classList.contains("t-revealed"));
});

test("a hidden tab stops the frames; back, they run again", () => {
  const p = page();
  load();
  p.run(0.1);
  p.document.hidden = true;
  p.document.fire("visibilitychange");
  assert.equal(p.frames.size, 0);
  p.document.hidden = false;
  p.document.fire("visibilitychange");
  p.document.fire("visibilitychange");
  assert.equal(p.frames.size, 1);
});

test("stop leaves the page as it was; reduced motion stops and restarts it", () => {
  const p = page();
  const hall = p.el("div", { cls: "t-hall" });
  const layer = p.el("div", { data: { depth: "10" }, parent: hall });
  const one = panel(p, 100);
  const M = load();
  p.window("pointermove", { clientX: 0, clientY: 0 });
  M.owl();
  p.run(1);
  M.stop();
  M.stop();
  assert.equal(M.running, false);
  assert.equal(p.canvas(), undefined);
  assert.equal(one.children.length, 0);
  assert.equal(one.style.position, "");
  assert.equal(layer.style.translate, "");
  assert.ok(!p.root.classList.contains("t-magic"));
  assert.equal(p.body.children.filter((e) => e.className.includes("t-flyer")).length, 0);
  assert.equal(p.listeners.pointermove.length, 0);
  M.release();
  p.media.reduce.matches = false;
  p.onReduce();
  assert.equal(M.running, true);
  p.media.reduce.matches = true;
  p.onReduce();
  assert.equal(M.running, false);
  p.root.dataset.theme = "cyberpunk";
  p.media.reduce.matches = false;
  p.onReduce();
  assert.equal(M.running, false);
});

test("the API: does nothing while stopped, runes as SVG paths, frame hooks", () => {
  const p = page();
  const M = load();
  M.stop();
  for (const f of [() => M.emit(1, 1), () => M.burst(1, 1), () => M.circle(1, 1), () => M.revelio(), () => M.snitch(), () => M.patronus()]) assert.equal(f(), false);
  assert.equal(M.owl(), undefined);
  assert.equal(M.occamy(), undefined);
  assert.equal(M.shootingStar(), undefined);
  assert.equal(M.runePath(10, 0, 0, 10), "M2.5 0.0L2.5 10.0"); // isa: a single stroke
  assert.equal(M.runePath(-14, 0, 0, 10), M.runePath(10, 0, 0, 10));
  M.start();
  const got = [];
  const off = M.onFrame((time, dt, pointer, view) => got.push([dt, view.scroll]));
  const offBug = M.onFrame(() => { throw new Error("a page's bug"); });
  const errors = [];
  const original = console.error;
  console.error = (e) => errors.push(e.message);
  p.run(0.05);
  console.error = original;
  offBug();
  assert.equal(got.length, 3);
  assert.ok(errors.length === 3 && errors[0] === "a page's bug", "a page's error does not stop the magic");
  off();
  p.run(0.05);
  assert.equal(got.length, 3);
  assert.equal(M.patronus(), true);
  assert.equal(M.patronus(), false, "one at a time");
  M.burst(10, 10, "silver");
  M.circle(10, 10);
  for (let k = 0; k < 8; k++) M.circle(10, 10, { r: 20, life: 0.5, color: "blue" });
  M.emit(10, 10, { n: 400, dir: 0 });
  p.run(1);
});

test("Firefox draws one device pixel per CSS pixel; a phone gets fewer ribbons", () => {
  const p = page({ gecko: true, width: 400, height: 700 });
  load();
  assert.ok(p.root.classList.contains("t-gecko"));
  assert.equal(p.canvas().width, 400);
  globalThis.innerWidth = 1600;
  p.window("resize");
  assert.equal(p.canvas().width, 1600);
  globalThis.devicePixelRatio = 0;
});
