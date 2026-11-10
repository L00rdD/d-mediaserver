// Tests of the One Piece card (home/site/kpiece.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, minutesAgo } = require("./cards-page.cjs");

const latest = { url: "https://x/1130", arc: "Elbaf", scan: "1130", name: "The chapter", date: "2026-11-01", pages: 17 };

test("the latest scan and the countdown to the next", async () => {
  const at = new Date(Date.now() + (2 * 86400 + 3 * 3600 + 4 * 60 + 5.5) * 1000).toISOString();
  const { card, text, timers } = page({ id: "kpiece", answers: { "/kpiece.json": { checked_at: minutesAgo(5), latest, next: { scan: "1131", at } } } });
  await run("kpiece.js");
  assert.equal(card.hidden, false);
  assert.equal(card.href, "https://x/1130");
  assert.equal(text("arc"), "Arc Elbaf");
  assert.equal(text("scan"), "1130");
  assert.equal(text("name"), "The chapter");
  assert.match(text("date"), /^out /);
  assert.equal(text("pages"), "17 pages");
  assert.equal(text("next"), "1131");
  assert.notEqual(text("when"), "");
  assert.equal(text("timer"), "2d 03h 04m 05s");
  assert.equal(timers[0].ms, 1000);
});

test("a date in words, no pages, no next date", async () => {
  const { text } = page({ id: "kpiece", missing: ["next"], answers: { "/kpiece.json": { checked_at: minutesAgo(5), latest: { ...latest, date: "soon", pages: 0 } } } });
  await run("kpiece.js");
  assert.equal(text("date"), "soon");
  assert.equal(text("pages"), "");
  assert.equal(text("timer"), "date not announced");
});

test("the next scan is due", async () => {
  const { text } = page({ id: "kpiece", answers: { "/kpiece.json": { checked_at: minutesAgo(5), latest, next: { scan: "1131", at: minutesAgo(1) } } } });
  await run("kpiece.js");
  assert.equal(text("timer"), "any minute now");
});

for (const [why, answer] of [
  ["the service is off", 404],
  ["the page cannot reach it", new Error("offline")],
  ["no scan yet", { checked_at: minutesAgo(5) }],
  ["not refreshed for a day", { checked_at: minutesAgo(25 * 60), latest }],
]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "kpiece", answers: { "/kpiece.json": answer } });
    await run("kpiece.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("kpiece.js");
});
