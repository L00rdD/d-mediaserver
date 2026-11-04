// Tests of Cerebro's scene engine as bundled for the home page (home/site/cerebro-scene.js), on a
// fake canvas: node --test home/tests/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT = path.join(__dirname, "../site/cerebro-scene.js");

// The bundle is a classic script that sets the global CerebroScene
function load() {
  delete globalThis.CerebroScene;
  vm.runInThisContext(fs.readFileSync(SCRIPT, "utf8"), { filename: SCRIPT });
  return globalThis.CerebroScene;
}

// A 2D context that records every call and every style set on it
function canvas() {
  const calls = [];
  const state = { globalAlpha: 1, fillStyle: "#000", imageSmoothingEnabled: true, calls };
  const ctx = new Proxy(state, {
    get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a])),
    set: (t, k, v) => { t[k] = v; calls.push(["=" + k, v]); return true; },
  });
  return ctx;
}

const POWERS = ["beam", "bolt", "psychic", "fire", "frost", "claws", "throw", "sparks", "shield", "magnet", "sonic", "quake", "clone", "leap", "absorb", "glow"];
const MOVES = ["walk", "phase", "fly", "teleport", "dash"];
const catalog = (extra = {}) => ({
  roomSize: { width: 320, height: 180 },
  characterSize: { width: 24, height: 24 },
  emotes: "emotes.png",
  characters: new Map(POWERS.map((power, i) => [power, { image: power + ".png", power, powerColor: "#F0A", move: MOVES[i % MOVES.length], aura: i % 4 ? null : "#0FF", ...extra }])),
});
const ROOM = { image: "room.png", frames: 4, fps: 2, walkArea: { x: 20, y: 90, width: 280, height: 70 } };
const STATES = ["walking", "asleep", "alert", "walking"];
const actors = () => POWERS.map((power, i) => ({ id: "agent-" + i, character: power, state: STATES[i % STATES.length] }));

test("draws the room's current frame, then every known character, back to front", () => {
  const { drawScene } = load();
  const ctx = canvas();
  drawScene(ctx, catalog(), ROOM, [...actors(), { id: "ghost", character: "nobody", state: "walking" }], 1.6);
  assert.equal(ctx.imageSmoothingEnabled, false);
  assert.deepEqual(ctx.calls[1], ["clearRect", 0, 0, 320, 180]);
  // 1.6 s at 2 fps: frame 3 of the strip
  assert.deepEqual(ctx.calls[2], ["drawImage", "room.png", 960, 0, 320, 180, 0, 0, 320, 180]);
  const sprites = ctx.calls.filter((c) => c[0] === "drawImage" && c[1].endsWith(".png") && c[1] !== "room.png");
  assert.ok(sprites.length >= POWERS.length);
  assert.ok(!sprites.some((c) => c[1] === "nobody.png"));
});

test("a still room has a single frame; the sleeping and the alert get their emote", () => {
  const { drawScene } = load();
  const ctx = canvas();
  const one = [{ id: "a", character: "glow", state: "asleep" }, { id: "b", character: "glow", state: "alert" }];
  drawScene(ctx, catalog(), { ...ROOM, frames: 1 }, one, 0.1); // the ! blinks: on at 0.1 s
  assert.deepEqual(ctx.calls[2], ["drawImage", "room.png", 0, 0, 320, 180, 0, 0, 320, 180]);
  const emotes = ctx.calls.filter((c) => c[1] === "emotes.png").map((c) => c[2]);
  assert.deepEqual(emotes.sort(), [0, 9]); // the Zz and the !
});

test("the same instant always gives the same picture", () => {
  const { drawScene } = load();
  const a = canvas(), b = canvas();
  drawScene(a, catalog(), ROOM, actors(), 123.4);
  drawScene(b, catalog(), ROOM, actors(), 123.4);
  assert.deepEqual(a.calls, b.calls);
});

// Over a few minutes every movement walks, pauses, uses its power, flies, fades and dashes
test("every movement and every power, all along the walk", () => {
  const { drawScene } = load();
  const seen = new Set();
  for (const move of MOVES) {
    const cat = catalog({ move });
    for (let s = 0; s < 240; s += 0.1) {
      const ctx = canvas();
      drawScene(ctx, cat, ROOM, actors().map((a) => ({ ...a, state: "walking" })), s);
      for (const c of ctx.calls) seen.add(c[0]);
      assert.ok(ctx.calls.every((c) => c.every((v) => typeof v !== "number" || Number.isFinite(v))), `${move} at ${s}`);
    }
  }
  for (const call of ["drawImage", "fillRect", "save", "restore", "translate", "scale", "=globalAlpha"]) assert.ok(seen.has(call), call);
});

test("sprites face left by mirroring the side row", () => {
  const { drawScene } = load();
  let mirrored = 0;
  for (let s = 0; s < 120; s += 0.25) {
    const ctx = canvas();
    drawScene(ctx, catalog({ move: "walk" }), ROOM, actors().map((a) => ({ ...a, state: "walking" })), s);
    mirrored += ctx.calls.filter((c) => c[0] === "scale" && c[1] === -1 && c[2] === 1).length;
  }
  assert.ok(mirrored > 0);
});

test("the ticker draws once at once, then at 10 fps while animating", () => {
  const { onFrame, setAnimating } = load();
  const frames = [];
  globalThis.requestAnimationFrame = (fn) => (frames.push(fn), frames.length);
  globalThis.cancelAnimationFrame = () => frames.splice(0);
  const drawn = [];
  const off = onFrame((s) => drawn.push(s));
  assert.equal(drawn.length, 1);
  frames.shift()(1000);
  assert.equal(drawn.length, 2);
  frames.shift()(1050); // too soon
  assert.equal(drawn.length, 2);
  frames.shift()(1100);
  assert.equal(drawn.length, 3);
  setAnimating(false);
  assert.equal(frames.length, 0);
  setAnimating(true);
  assert.equal(frames.length, 1);
  off();
  frames.shift()(5000); // nobody left to draw: the loop stops
  assert.equal(frames.length, 0);
  setAnimating(false);
  setAnimating(false);
});

test("durations and status labels", () => {
  const { humanizeDuration, STATUS_LABELS, CHARACTER_SCALE } = load();
  assert.equal(humanizeDuration(-5), "0s");
  assert.equal(humanizeDuration(42e3), "42s");
  assert.equal(humanizeDuration(5 * 60e3), "5min");
  assert.equal(humanizeDuration(3600e3 + 5 * 60e3), "1h05");
  assert.equal(humanizeDuration(3 * 86400e3), "3d");
  assert.equal(STATUS_LABELS.waiting, "needs you");
  assert.equal(CHARACTER_SCALE, 1.5);
});
