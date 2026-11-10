// Tests of the Cerebro card (home/site/cerebro.js) on a fake page, with a fake
// scene engine standing for cerebro-scene.js
const test = require("node:test");
const assert = require("node:assert");
const { page, run, settle, minutesAgo } = require("./cards-page.cjs");

// Pictures decode at once, except those with "broken" in their name
const later = [];
globalThis.Image = class {
  decode() { return this.src.includes("broken") ? Promise.reject(new Error("broken")) : Promise.resolve(); }
};
globalThis.setTimeout = (fn, ms) => later.push({ fn, ms });

function scene() {
  const s = {
    frames: [], drawn: [], animating: [], stopped: 0,
    STATUS_LABELS: { busy: "Working", idle: "Idle" },
    humanizeDuration: (ms) => `${Math.round(ms / 60000)}m`,
    onFrame: (fn) => (s.frames.push(fn), () => s.stopped++),
    setAnimating: (on) => s.animating.push(on),
    drawScene: (ctx, catalog, room, actors, seconds) => s.drawn.push({ ctx, catalog, room, actors, seconds }),
  };
  return s;
}

// cerebro.js imports /cerebro-scene.js: it resolves to a module handing out the test's
// fake engine, or to one that fails to load. A new address each time, so each test
// gets its own copy
let copies = 0, loads = true;
require("node:module").registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== "/cerebro-scene.js") return next(specifier, context);
    const body = loads ? "export const { drawScene, onFrame, setAnimating, STATUS_LABELS, humanizeDuration } = globalThis.__cerebroScene;" : "throw new Error('no engine');";
    return { url: `data:text/javascript,${encodeURIComponent(body)}//${copies++}`, shortCircuit: true };
  },
});

// The page, with the scene engine loading or failing to load
function cerebro({ answer = 404, load = "there", eventSource = false, dpr } = {}) {
  const p = page({ id: "cerebro", answers: { "/screen.json": () => (typeof answer === "function" ? answer() : answer) }, eventSource });
  const engine = scene();
  globalThis.__cerebroScene = engine;
  loads = load !== "fails";
  if (dpr) window.devicePixelRatio = dpr;
  const make = document.createElement;
  document.createElement = (tag) => {
    const e = make(tag);
    if (tag === "canvas") e.getContext = () => ({ setTransform: (...m) => (e.transform = m) });
    return e;
  };
  return { ...p, engine };
}

const session = (id, more = {}) => ({
  id, name: `session ${id}`, status: "busy", room: "Danger Room", project: "~/code/" + id, since: minutesAgo(5),
  scene: { room: { sprite: "/cerebro/rooms/danger.png", frames: 4, fps: 10, walk: [1, 2] }, actors: [{ id: "logan", name: "Wolverine", sprite: "/cerebro/x/logan.png", aura: "red", move: "walk", power: "claws", color: "#f00", state: "fight" }] },
  ...more,
});

test("does nothing on a page without the card", async () => {
  page({});
  await run("cerebro.js");
});

test("stays hidden when the scene engine cannot load", async () => {
  const { card, calls } = cerebro({ load: "fails", answer: { cerebro: { sessions: [] } } });
  await run("cerebro.js");
  assert.equal(card.hidden, true);
  assert.equal(calls.length, 0);
});

test("hidden without cerebro in the feed, or when the feed fails", async () => {
  for (const answer of [{ playing: [] }, null, 404, new Error("offline")]) {
    const { card } = cerebro({ load: "script", answer });
    await run("cerebro.js");
    assert.equal(card.hidden, true);
  }
});

test("one card per session, drawn as Cerebro draws it", async () => {
  const doc = { cerebro: {
    link: "http://mac.lan:7000", busy: 1, waiting: 0,
    sessions: [session("a"), session("b", { status: "idle", since: null, room: null, project: null, scene: null })],
  } };
  const { card, text, part, engine, timers } = cerebro({ answer: doc, dpr: 2 });
  await run("cerebro.js");
  assert.equal(card.hidden, false);
  assert.equal(card.href, "http://mac.lan:7000");
  assert.equal(text("state"), "2 sessions");
  assert.equal(text("counts"), "1 working");
  assert.equal(document.head.children[0].tagName, "STYLE");
  const [a, b] = part("list").children;
  assert.equal(a.className, "cb-card busy");
  assert.equal(a.title, "~/code/a");
  const [title, canvas, cast, meta] = a.children;
  assert.equal(title.children[0].className, "cb-dot");
  assert.equal(title.children[1].textContent, "session a");
  assert.equal(cast.textContent, "Danger Room — Wolverine");
  assert.equal(cast.children[0].className, "cb-muted");
  assert.equal(meta.children[0].textContent, "~/code/a");
  assert.equal(meta.children[1].textContent, "Working 5m");
  assert.deepEqual([canvas.width, canvas.height, canvas.transform], [768, 480, [4, 0, 0, 4, 0, 0]]);
  assert.equal(b.className, "cb-card idle");
  assert.equal(b.title, "");
  assert.equal(b.children[2].textContent, " — ");
  assert.equal(b.children[3].children[0].textContent, "");
  assert.equal(b.children[3].children[1].textContent, "Idle 0m");
  // the status line ticks every second
  assert.equal(timers[0].ms, 1000);
  timers[0].fn();
  // the pictures decode after the first frame: nothing drawn until then
  engine.frames[0](1.5);
  assert.equal(engine.drawn.length, 0);
  await settle();
  // the room is there, the characters' pictures are asked for
  engine.frames[0](2);
  assert.equal(engine.drawn[0].catalog.characters.size, 0);
  await settle();
  engine.frames[0](2.5);
  const drawn = engine.drawn[1];
  assert.equal(drawn.seconds, 2.5);
  assert.deepEqual(drawn.catalog.characterSize, { width: 24, height: 24 });
  assert.deepEqual(drawn.catalog.roomSize, { width: 192, height: 120 });
  assert.equal(drawn.catalog.emotes.src, "/cerebro/ui/emotes.png");
  assert.deepEqual({ ...drawn.catalog.characters.get("logan"), image: null }, { id: "logan", name: "Wolverine", aura: "red", move: "walk", power: "claws", powerColor: "#f00", image: null });
  assert.equal(drawn.room.image.src, "/cerebro/rooms/danger.png");
  assert.deepEqual([drawn.room.frames, drawn.room.fps, drawn.room.walkArea], [4, 10, [1, 2]]);
  assert.deepEqual(drawn.actors, [{ id: "logan", character: "logan", state: "fight" }]);
  // a session without a scene draws nothing
  engine.frames[1](3);
  assert.equal(engine.drawn.length, 2);
});

test("pushed: kept, updated, removed; actors without a picture left out", async () => {
  const actor = (id, sprite) => ({ id, name: id, sprite, state: "idle" });
  let doc = { cerebro: {
    waiting: 2, room_size: [100, 50], character_size: [16, 32], emotes: "/cerebro/ui/mine.png",
    sessions: [session("a"), session("b")],
  } };
  const { text, part, engine, sources, timers, fire } = cerebro({ answer: () => doc, eventSource: true });
  await run("cerebro.js");
  assert.equal(text("counts"), "2 waiting for you");
  const [a] = part("list").children;
  assert.deepEqual([a.children[1].width, a.children[1].height], [200, 100]);
  // one session left, the other with two actors, one without a picture yet
  const kept = session("a", { scene: { room: session("a").scene.room, actors: [actor("storm", "/cerebro/x/storm.png"), actor("jean", "/cerebro/x/broken.png")] } });
  sources[0].onmessage({ data: JSON.stringify({ cerebro: { ...doc.cerebro, waiting: 0, busy: 0, sessions: [kept] } }) });
  assert.equal(engine.stopped, 1);
  assert.equal(engine.frames.length, 2);
  assert.equal(part("list").children.length, 1);
  assert.equal(part("list").children[0], a);
  assert.equal(text("state"), "1 session");
  assert.equal(text("counts"), "all idle");
  assert.equal(a.children[2].textContent, "Danger Room — storm · jean");
  for (const t of [1, 2, 3]) {
    engine.frames[0](t);
    await settle();
  }
  const drawn = engine.drawn.at(-1);
  assert.deepEqual(drawn.catalog.characterSize, { width: 16, height: 32 });
  assert.equal(drawn.catalog.emotes.src, "/cerebro/ui/mine.png");
  assert.equal(drawn.catalog.characters.get("storm").aura, undefined);
  assert.deepEqual(drawn.actors.map((x) => x.id), ["storm"]);
  // a picture that failed is asked again 30 s later
  assert.equal(later.at(-1).ms, 30000);
  later.at(-1).fn();
  // no session
  sources[0].onmessage({ data: JSON.stringify({ cerebro: { sessions: undefined } }) });
  assert.equal(part("list").children[0].textContent, "No session");
  assert.equal(text("state"), "0 sessions");
  // polls while the stream is down, stops when it is back
  sources[0].onerror();
  sources[0].onerror();
  assert.deepEqual(timers.map((t) => t.ms), [1000, 10000]);
  doc = { cerebro: { sessions: [session("c")] } };
  await timers[1].fn();
  assert.equal(text("state"), "1 session");
  sources[0].onmessage({ data: JSON.stringify({ cerebro: { sessions: [] } }) });
  assert.equal(timers[1].cleared, true);
  sources[0].onerror();
  assert.equal(timers.length, 3);
  // animation follows the tab's visibility
  document.hidden = true;
  await fire("visibilitychange");
  document.hidden = false;
  await fire("visibilitychange");
  assert.deepEqual(engine.animating, [false, true]);
});

test("without the stream: asks every 10 s", async () => {
  const { timers } = cerebro({ answer: { cerebro: { sessions: [] } } });
  await run("cerebro.js");
  assert.deepEqual(timers.map((t) => t.ms), [1000, 10000]);
});
