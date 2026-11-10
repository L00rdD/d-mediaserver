// Tests of the Hogwarts look's WebGL world (home/site/vivarium.js) on a fake hub page, real
// three.js maths without a GPU: the intro, then a walk through the case's worlds. The tests
// follow each other on one page (an ES module runs once): node --test home/tests/
const test = require("node:test");
const assert = require("node:assert");
const { page, load } = require("./vivarium-page.cjs");

const p = page({ intro: true });
const three = () => p.three();
const drawn = () => three().renderer.drawn;
// the worlds drawn since the last call, by the name of their sky
const sky = (scene) => {
  if (scene.background?.isTexture) return scene.background.name;
  const g = scene.children.find((o) => o.material?.map?.name);
  return g ? g.material.map.name : "";
};
const shown = () => {
  const names = [...new Set(drawn().filter(([s]) => s.isScene).map(([s]) => sky(s) || (s.fog ? "case" : "?")))];
  drawn().length = 0;
  return names;
};
const scenes = () => [...new Set(drawn().filter(([s]) => s.isScene).map(([s]) => s))];
// the scenes of the next frame
const frame = async () => { drawn().length = 0; await p.run(1 / 60); return scenes(); };
const all = (scene, pred) => { const out = []; scene.traverse((o) => pred(o) && out.push(o)); return out; };
const scrollTo = (y) => { globalThis.scrollY = y; };
const creature = (name) => p.creatures.find((e) => e.dataset.creature === name);

test("the case rattles, opens, and lets the page in", async () => {
  await load();
  assert.ok(p.root.classList.contains("gl") && p.root.classList.contains("gl-ready"));
  assert.equal(three().renderer.shadowMap.enabled, true);
  await p.run(1);
  assert.deepEqual(shown(), ["case"]);
  assert.ok(p.root.classList.contains("intro"));
  // the clasps spring, the lid opens; then a click skips to the dive
  await p.run(1);
  const [caseScene] = scenes();
  assert.ok(all(caseScene, (o) => o.isMesh).length > 30);
  p.skip.fire("click");
  await p.run(0.6);
  assert.ok(p.root.classList.contains("intro-done"));
  assert.ok(!p.root.classList.contains("intro"));
  assert.equal(p.magic.released, 1);
  assert.equal(three().renderer.shadowMap.enabled, false);
  p.skip.fire("click"); // too late: nothing
  await p.run(0.2);
  await frame();
  assert.deepEqual(shown(), ["/assets/hdri/rogland_clear_night.webp"]);
});

test("worlds load one at a time: a small sky, the sharp one, then models and creature", () => {
  const asked = three().asked;
  const at = (url) => asked.indexOf(url);
  assert.ok(at("/assets/hdri/rogland_clear_night-low.webp") >= 0);
  assert.ok(at("/assets/hdri/rogland_clear_night-low.webp") < at("/assets/hdri/rogland_clear_night.webp"));
  assert.ok(at("/assets/hdri/rogland_clear_night.webp") < at("/assets/hdri/hikers_cave-low.webp"), "the neighbour after");
  assert.ok(at("/assets/hdri/hikers_cave.webp") < at("/assets/creatures/niffler.glb"));
  assert.ok(at("/assets/creatures/phoenix.glb") >= 0, "Fawkes comes along");
});

test("scrolling across a section's edge crosses into the next world through a ring", async () => {
  scrollTo(450); // the edge between the night and the cave is at the middle of the screen
  await p.run(0.5);
  const worlds = shown();
  assert.deepEqual(worlds.sort(), ["/assets/hdri/hikers_cave.webp", "/assets/hdri/rogland_clear_night.webp"]);
  scrollTo(900);
  await p.run(1);
  assert.deepEqual(shown(), ["/assets/hdri/hikers_cave.webp"]);
});

test("the Niffler wakes up when its card is hovered: its light, its circle, a burst of gold", async () => {
  await p.run(0.5);
  const [cave] = await frame();
  const glow = all(cave, (o) => o.isPointLight && o.distance === 6)[0];
  const calm = glow.intensity;
  creature("niffler").fire("pointerenter");
  creature("niffler").fire("focusin"); // already awake
  await p.run(1.5);
  assert.ok(glow.intensity > calm * 1.5, `${glow.intensity} > ${calm}`);
  creature("niffler").fire("pointerleave");
  creature("niffler").fire("focusout");
  await p.run(2);
  assert.ok(glow.intensity < calm * 1.3);
  creature("basilisk").fire("pointerenter"); // no such creature: nothing
});

test("Fawkes goes along, and comes close when Jellyfin is hovered", async () => {
  scrollTo(0);
  await p.run(1);
  const [night] = await frame();
  const fawkes = () => all(night, (o) => o.isPointLight && o.color.getHex() === 0xff8a30)[0];
  assert.ok(fawkes(), "Fawkes is in the world shown");
  creature("phoenix").fire("pointerenter");
  await p.run(4);
  await frame();
  const cam = drawn().find(([s]) => s === night)[1];
  const near = fawkes().getWorldPosition(new (fawkes().position.constructor)()).distanceTo(cam.position);
  assert.ok(near < 8, `called close: ${near}`);
  creature("phoenix").fire("pointerleave");
  await p.run(8);
});

test("Hedwig flies across with the news, once she has come", async () => {
  assert.equal(globalThis.Vivarium.hedwig(), true, "asked for: she comes once loaded");
  await p.settle();
  await p.run(0.5);
  await frame();
  const owls = () => scenes().flatMap((s) => all(s, (o) => o.isMesh && o.material.emissiveIntensity === 0.55));
  assert.equal(owls().length, 1, "flying");
  assert.equal(globalThis.Vivarium.hedwig(), false, "one at a time");
  await p.run(7);
  await frame();
  assert.equal(owls().length, 0, "gone");
  assert.equal(globalThis.Vivarium.hedwig(), true);
});

test("the forest, the mist and the shed, their creatures awake", async () => {
  for (const [y, name] of [[1800, "bowtruckle"], [2700, "hippogriff"], [3600, "owl"]]) {
    scrollTo(y);
    await p.run(2);
    creature(name).fire("pointerenter");
    await p.run(2);
    creature(name).fire("pointerleave");
    await p.run(1.5);
    assert.equal((await frame()).length, 1);
  }
  const [shed] = await frame();
  assert.ok(all(shed, (o) => o.isPointLight && o.intensity > 4.5).length >= 1, "Newt's lamp on");
  // and back up through every world
  for (let y = 3600; y >= 0; y -= 150) { scrollTo(y); await p.run(0.2); }
});

test("a phone in portrait gets a wider view and fewer pixels", async () => {
  Object.assign(globalThis, { innerWidth: 500, innerHeight: 900, devicePixelRatio: 3 });
  p.resized();
  await p.run(0.3);
  const [, cam] = drawn().find(([s]) => s.isScene);
  assert.equal(cam.fov, 68);
  assert.equal(three().renderer.pixelRatio, 1.25);
  Object.assign(globalThis, { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 0 });
  p.resized();
  p.resized();
  await p.run(0.3);
  assert.equal(drawn().find(([s]) => s.isScene)[1].fov, 50);
  assert.equal(three().renderer.pixelRatio, 1);
});

test("a hidden tab stops drawing; back, it draws again", async () => {
  p.document.hidden = true;
  p.document.fire("visibilitychange");
  assert.equal(p.frames.size, 0);
  p.document.hidden = false;
  p.document.fire("visibilitychange");
  p.document.fire("visibilitychange");
  assert.equal(p.frames.size, 1);
  p.window("pointermove", { clientX: 100, clientY: 100 });
  await p.run(70); // long enough for Hedwig to come by on her own
});

test("sections gone from the page: the last world stays", async () => {
  await frame();
  const last = shown();
  p.sections.length = 0;
  p.resized();
  await p.run(0.5);
  await frame();
  assert.deepEqual(shown(), last);
});
