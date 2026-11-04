// Tests of the Errol card (home/site/errol.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, settle, element, minutesAgo } = require("./cards-page.cjs");

// The screen service: GET answers the settings, POST merges the changes, unless
// saving is refused; /screen.json answers the feed
function errol({ settings, theme, saves = true, feed = 404, eventSource = false }) {
  const saved = [];
  const answers = {
    "/screen/settings": (url, options) => {
      if (options?.method !== "POST") return settings;
      saved.push(JSON.parse(options.body));
      if (!saves) return saves === false ? 500 : new Error("offline");
      return { ...settings, ...JSON.parse(options.body) };
    },
    "/screen.json": () => (typeof feed === "function" ? feed() : feed),
  };
  const p = page({ id: "errol", answers, eventSource });
  if (theme) document.documentElement.dataset.theme = theme;
  const buttons = ["friday", "cyberpunk", "hogwarts"].map((look) => Object.assign(element("button"), { dataset: { errolLook: look } }));
  p.card.querySelectorAll = () => buttons;
  const pressed = () => buttons.filter((b) => b.attributes["aria-pressed"] === "true").map((b) => b.dataset.errolLook);
  return { ...p, saved, buttons, pressed };
}

test("hidden when the screen service does not answer", async () => {
  const { card } = errol({ settings: new Error("offline") });
  await run("errol.js");
  assert.equal(card.hidden, true);
});

test("shows the look, buttons change it and stop following", async () => {
  const { card, saved, buttons, pressed, part } = errol({ settings: { look: "cyberpunk", follow_hub: false } });
  await run("errol.js");
  assert.equal(card.hidden, false);
  assert.deepEqual(saved, []);
  assert.deepEqual(pressed(), ["cyberpunk"]);
  assert.equal(part("follow").checked, false);
  let prevented = false;
  await buttons[2].fire("click", { preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.deepEqual(saved, [{ look: "hogwarts", follow_hub: false }]);
  assert.deepEqual(pressed(), ["hogwarts"]);
});

test("a refused save keeps the look shown", async () => {
  const { buttons, pressed, saved } = errol({ settings: { look: "cyberpunk", follow_hub: false }, saves: false });
  await run("errol.js");
  await buttons[0].fire("click", { preventDefault() {} });
  assert.equal(saved.length, 1);
  assert.deepEqual(pressed(), ["cyberpunk"]);
});

test("following this page: the screen takes the page's look", async () => {
  const { saved, pressed, part } = errol({ settings: { look: "friday", follow_hub: true }, theme: "hogwarts" });
  await run("errol.js");
  assert.deepEqual(saved, [{ look: "hogwarts" }]);
  assert.deepEqual(pressed(), ["hogwarts"]);
  assert.equal(part("follow").checked, true);
});

test("following, already on the page's look (or an unknown one): nothing saved", async () => {
  const { saved } = errol({ settings: { look: "friday", follow_hub: true }, theme: "space" });
  await run("errol.js");
  assert.deepEqual(saved, []);
});

test("following, the save fails: the card still shows", async () => {
  const { card, saved, pressed } = errol({ settings: { look: "friday", follow_hub: true }, theme: "cyberpunk", saves: null });
  await run("errol.js");
  assert.equal(saved.length, 1);
  assert.equal(card.hidden, false);
  assert.deepEqual(pressed(), ["friday"]);
});

test("the follow box turns following on and off", async () => {
  const { saved, part, pressed } = errol({ settings: { look: "friday", follow_hub: false }, theme: "reactor", saves: true });
  await run("errol.js");
  const follow = part("follow");
  follow.checked = true;
  await follow.fire("change");
  follow.checked = false;
  await follow.fire("change");
  assert.deepEqual(saved, [{ follow_hub: true, look: "friday" }, { follow_hub: false }]);
  assert.equal(follow.checked, false);
  assert.deepEqual(pressed(), ["friday"]);
});

test("the follow box: a refused save puts it back", async () => {
  const { part } = errol({ settings: { look: "friday", follow_hub: false }, saves: false });
  await run("errol.js");
  const follow = part("follow");
  follow.checked = true;
  await follow.fire("change");
  assert.equal(follow.checked, false);
});

test("without the stream: asks the feed every 10 s, says what the screen shows", async () => {
  let feed = { playing: [{ series: "One Piece", title: "Episode 1" }] };
  const { text, timers } = errol({ settings: { look: "friday", follow_hub: false }, feed: () => feed });
  await run("errol.js");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 10000);
  const now = async (d) => { feed = d; await timers[0].fn(); await settle(); return text("now"); };
  assert.equal(await now(feed), "Cinema · One Piece");
  assert.equal(await now({ playing: [{ title: "Dune" }] }), "Cinema · Dune");
  assert.equal(await now({ events: [{ kind: "light", name: "On", at: minutesAgo(1) }, { kind: "play", at: minutesAgo(0) }] }), "Lamp · On");
  assert.equal(await now({ events: [{ kind: "doorbell", title: "Ring", at: minutesAgo(1) }] }), "doorbell · Ring");
  assert.equal(await now({ events: [{ kind: "scan", scan: "1130", at: minutesAgo(1) }] }), "One Piece · 1130");
  assert.equal(await now({ events: [{ kind: "import", at: minutesAgo(1) }] }), "New in the library · ");
  assert.equal(await now({ events: [{ kind: "light", name: "On", at: minutesAgo(3) }] }), "Idle · clock and cards");
  assert.equal(await now({}), "Idle · clock and cards");
  assert.equal(await now(new Error("offline")), "–");
});

test("with the stream: pushed documents and settings, polling only while it is down", async () => {
  const { sources, timers, text, pressed } = errol({ settings: { look: "friday", follow_hub: false }, eventSource: true, feed: () => ({}) });
  await run("errol.js");
  const source = sources[0];
  assert.equal(source.url, "/screen/events");
  assert.equal(timers.length, 0);
  source.onmessage({ data: JSON.stringify({ playing: [{ title: "Dune" }], settings: { look: "cyberpunk", follow_hub: false } }) });
  await settle();
  assert.equal(text("now"), "Cinema · Dune");
  assert.deepEqual(pressed(), ["cyberpunk"]);
  source.onerror();
  source.onerror();
  assert.equal(timers.length, 1);
  source.onmessage({ data: JSON.stringify({}) });
  await settle();
  assert.equal(timers[0].cleared, true);
  assert.equal(text("now"), "Idle · clock and cards");
  assert.deepEqual(pressed(), ["cyberpunk"]);
  source.onerror();
  assert.equal(timers.length, 2);
});

test("does nothing on a page without the card", async () => {
  page({});
  await run("errol.js");
});
