// Tests of the turtle card (home/site/quiet.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run } = require("./cards-page.cjs");

// The quiet service: GET answers the status, POST sets the turtle mode by hand,
// unless refused
function quiet({ status, saves = true }) {
  const saved = [];
  const answers = {
    "/quiet": (url, options) => {
      if (options?.method !== "POST") return typeof status === "function" ? status() : status;
      saved.push(JSON.parse(options.body));
      if (!saves) return 502;
      return { ...status, ...JSON.parse(options.body), hand: true };
    },
  };
  return { ...page({ id: "quiet", answers }), saved };
}

test("hidden when the quiet service does not answer", async () => {
  for (const status of [502, new Error("offline")]) {
    const { card } = quiet({ status });
    await run("quiet.js");
    assert.equal(card.hidden, true);
  }
});

test("on for a console, a film and the others' use", async () => {
  const { card, text, part } = quiet({
    status: { turtle: true, hand: false, consoles: [{ name: "PS5-399" }], playing: ["Dune"], others_mbps: 8.5 },
  });
  await run("quiet.js");
  assert.equal(card.hidden, false);
  assert.equal(part("switch").checked, true);
  assert.equal(card.classList.contains("on"), true);
  assert.equal(text("state"), "Downloads slowed down");
  assert.equal(text("why"), "PS5-399, Dune, 8.5 Mb/s used by the others");
});

test("off, and on during the five calm minutes", async () => {
  let status = { turtle: false, hand: false, consoles: [], playing: [], others_mbps: null };
  const { text, part, timers } = quiet({ status: () => status });
  await run("quiet.js");
  assert.equal(part("switch").checked, false);
  assert.equal(text("state"), "Full speed");
  assert.equal(text("why"), "Nobody uses the network");
  status = { turtle: true, hand: false };
  await timers[0].fn();
  assert.equal(timers[0].ms, 20000);
  assert.equal(text("why"), "The network was used a moment ago");
});

test("the switch sets it by hand", async () => {
  const { text, part, saved } = quiet({ status: { turtle: true, hand: false, consoles: [{ name: "PS5" }] } });
  await run("quiet.js");
  const sw = part("switch");
  sw.checked = false;
  await sw.fire("change");
  assert.deepEqual(saved, [{ turtle: false }]);
  assert.equal(sw.checked, false);
  assert.equal(sw.disabled, false);
  assert.equal(text("why"), "Switched off by hand until the network is calm");
});

test("switched on by hand", async () => {
  const { text, part } = quiet({ status: { turtle: false, hand: false } });
  await run("quiet.js");
  part("switch").checked = true;
  await part("switch").fire("change");
  assert.equal(text("why"), "Switched on by hand");
});

test("a refused switch shows the state as it was, and a failed refresh keeps it", async () => {
  let status = { turtle: false, hand: false };
  const { part, saved, timers, text } = quiet({ status: () => status, saves: false });
  await run("quiet.js");
  part("switch").checked = true;
  await part("switch").fire("change");
  assert.equal(saved.length, 1);
  assert.equal(part("switch").checked, false);
  status = new Error("offline");
  await timers[0].fn();
  assert.equal(text("state"), "Full speed");
});
