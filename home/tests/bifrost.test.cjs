// Tests of the Bifrost card (home/site/bifrost.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, minutesAgo } = require("./cards-page.cjs");

const URL = "http://dpi.lan:8582/api/status.json";
const cells = (li) => li.children.map((c) => `${c.textContent}${c.className ? "|" + c.className : ""}`);

test("all up, outlets in every state, a last code", async () => {
  const { card, text, part } = page({ id: "bifrost", answers: { [URL]: {
    broker: true, homebridge: true,
    bridge: { online: true, last_seen: minutesAgo(0) },
    outlets: [
      { name: "Lamp", on: true, at: minutesAgo(5) },
      { name: "Fan", on: false, at: minutesAgo(120) },
      { name: "Heater", on: null, at: minutesAgo(3 * 1440) },
      { name: "Plug", on: true },
    ],
    last_code: { code: 1234, via: "rf", at: minutesAgo(5) },
  } } });
  await run("bifrost.js");
  assert.equal(card.hidden, false);
  const rows = part("list").children;
  assert.deepEqual(cells(rows[0]), ["MQTT broker", "Online|up", ":1883", ""]);
  assert.deepEqual(cells(rows[1]), ["Homebridge", "Online|up", ":8581", ""]);
  assert.deepEqual(cells(rows[2]), ["RF bridge", "Online|up", "seen just now", ""]);
  assert.deepEqual(cells(rows[3]), ["Lamp", "On|up", "5 min ago", ""]);
  assert.deepEqual(cells(rows[4]), ["Fan", "Off|down", "2 h ago", ""]);
  assert.deepEqual(cells(rows[5]), ["Heater", "Unknown|up", "3 d ago", ""]);
  assert.deepEqual(cells(rows[6]), ["Plug", "On|up", "", ""]);
  assert.equal(text("state"), "3/3 online");
  assert.equal(text("last"), "last code 1234 (rf) 5 min ago");
});

test("all down, the bridge never seen, no code", async () => {
  const { text, part } = page({ id: "bifrost", answers: { [URL]: { broker: false, homebridge: false, bridge: { online: false }, outlets: [] } } });
  await run("bifrost.js");
  const rows = part("list").children;
  assert.deepEqual(cells(rows[0]), ["MQTT broker", "Down|down", ":1883", ""]);
  assert.deepEqual(cells(rows[1]), ["Homebridge", "Down|down", ":8581", ""]);
  assert.deepEqual(cells(rows[2]), ["RF bridge", "Offline|down", "never seen", ""]);
  assert.equal(text("state"), "0/3 online");
  assert.equal(text("last"), "no RF code yet");
});

for (const [why, answer] of [["the service is off", 404], ["the page cannot reach it", new Error("offline")]]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "bifrost", answers: { [URL]: answer } });
    await run("bifrost.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("bifrost.js");
});
