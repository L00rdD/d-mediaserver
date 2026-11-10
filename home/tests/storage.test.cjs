// Tests of the storage bar (home/site/storage.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run } = require("./cards-page.cjs");

test("fills the bar in TB and GB", async () => {
  const { card, text, part } = page({ id: "storage", answers: { "/disk.json": { total: 4e12, used: 3.8e12, free: 2e11 } } });
  await run("storage.js");
  assert.equal(card.hidden, false);
  assert.equal(text("used"), "3.80 TB used of 4.00 TB");
  assert.equal(text("free"), "200 GB free");
  assert.equal(text("pct"), "95 %");
  assert.equal(part("fill").style.width, "95%");
  assert.equal(part("fill").classList.contains("full"), true);
});

test("not full under 90 %, missing parts skipped", async () => {
  const { card, part } = page({ id: "storage", missing: ["free"], answers: { "/disk.json": { total: 1e12, used: 5e11, free: 5e11 } } });
  await run("storage.js");
  assert.equal(card.hidden, false);
  assert.equal(part("fill").classList.contains("full"), false);
});

for (const [why, answer] of [
  ["the service is off", 404],
  ["the page cannot reach it", new Error("offline")],
  ["no disk size", { total: 0 }],
]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "storage", answers: { "/disk.json": answer } });
    await run("storage.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("storage.js");
});
