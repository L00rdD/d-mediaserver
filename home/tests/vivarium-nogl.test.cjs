// Tests of the Hogwarts look's WebGL world (home/site/vivarium.js) where WebGL 2 is missing
const test = require("node:test");
const assert = require("node:assert");
const { page, load } = require("./vivarium-page.cjs");

test("without WebGL 2: html.no-gl, and the intro is over at once", async () => {
  const p = page({ intro: true });
  globalThis.__three = { webgl2: false };
  const warned = [];
  console.warn = (...a) => warned.push(a[0]);
  await assert.rejects(load(), /WebGL 2 needed/);
  assert.ok(p.root.classList.contains("no-gl"));
  assert.ok(p.root.classList.contains("intro-done") && !p.root.classList.contains("intro"));
  assert.equal(p.magic.released, 1);
  assert.deepEqual(warned, ["vivarium: no WebGL"]);
});
