// Tests of the Hogwarts look's WebGL world (home/site/vivarium.js) for reduced motion: no intro,
// a still picture redrawn on scroll and as the skies arrive; and files that do not come
const test = require("node:test");
const assert = require("node:assert");
const { page, load } = require("./vivarium-page.cjs");

// the kit's runes missing, a few files lost
const p = page({ intro: true, reduce: true, magic: false, sections: ["night", "cave", "unknown", "forest", "mist", "shed"] });
globalThis.__three = { fail: ["hikers_cave-low", "creatures/phoenix", "fern_02", "creatures/owl"] };
const warnings = [];
console.warn = (...a) => warnings.push(a.slice(0, 2).join(" "));
const three = () => p.three();

test("no intro, one picture, and nothing more without a reason", async () => {
  await load();
  assert.ok(!p.root.classList.contains("intro"));
  assert.ok(p.root.classList.contains("intro-done"));
  assert.equal(three().renderer.shadowMap.enabled, false);
  assert.equal(p.frames.size, 0, "no animation loop");
  await p.run(0.5);
  assert.equal(p.frames.size, 0);
});

test("a scroll redraws once; the skies are polled for 20 s", async () => {
  const before = three().renderer.drawn.length;
  p.window("scroll");
  p.window("scroll"); // one frame for both
  p.window("resize");
  assert.equal(p.frames.size, 1);
  await p.run(1 / 60);
  assert.ok(three().renderer.drawn.length > before);
  for (let y = 0; y <= 4500; y += 300) { globalThis.scrollY = y; p.window("scroll"); await p.run(0.8); }
  const polls = p.timers.length;
  await p.run(25);
  assert.ok(p.timers.length < polls, "the poll stops after 20 s");
});

test("a sky, a model or a creature that does not come is left out, with a warning", () => {
  for (const what of ["vivarium: world cave", "vivarium: model fern_02", "vivarium: Fawkes 404 /assets/creatures/phoenix.glb"]) {
    assert.ok(warnings.some((w) => w.startsWith(what)), `${what} in ${warnings}`);
  }
  assert.ok(!three().asked.includes("/assets/creatures/niffler.glb"), "no creature without its world");
});

test("Hedwig asked for but lost: never flies", async () => {
  assert.equal(globalThis.Vivarium.hedwig(), true);
  await p.settle();
  assert.equal(globalThis.Vivarium.hedwig(), false);
  assert.ok(warnings.some((w) => w.startsWith("vivarium: Hedwig")));
});
