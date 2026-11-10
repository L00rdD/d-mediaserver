// Tests of the Ohara card (home/site/ohara.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run } = require("./cards-page.cjs");

const URL = "http://dpi.lan:8585/api/status.json";
const cells = (li) => li.children.map((c) => c.textContent);
const last = { series: "Frieren", label: "Tome 3", page: 44, pages: 180 };

test("the downloads under way", async () => {
  const downloads = [{ series: "Naruto", pct: 42, state: "downloading" }, { series: "Berserk", pct: 3, state: "error" }];
  const { card, text, part } = page({ id: "ohara", answers: { [URL]: { series: 2, volumes: 31, downloads, last } } });
  await run("ohara.js");
  assert.equal(card.hidden, false);
  assert.equal(text("state"), "2 series");
  assert.equal(text("volumes"), "31");
  assert.equal(text("downloads"), "2");
  assert.equal(text("reading"), "Frieren · vol. 3");
  const rows = part("list").children;
  assert.deepEqual(cells(rows[0]), ["Naruto", "downloading", "", "42 %"]);
  assert.equal(rows[0].children[2].children[0].style.width, "42%");
  assert.deepEqual(cells(rows[1]), ["Berserk", "error", "", "3 %"]);
  assert.equal(rows.length, 2);
});

test("the volume being read when nothing downloads", async () => {
  const { text, part } = page({ id: "ohara", answers: { [URL]: { series: 1, volumes: 14, downloads: [], last } } });
  await run("ohara.js");
  assert.equal(text("state"), "1 series");
  assert.equal(text("downloads"), "none");
  const row = part("list").children[0];
  assert.deepEqual(cells(row), ["Frieren", "Vol. 3", "", "p. 45/180"]);
  assert.equal(row.children[2].children[0].style.width, "25%");
});

test("a volume opened but not measured yet", async () => {
  const { part } = page({ id: "ohara", answers: { [URL]: { series: 1, volumes: 1, downloads: [], last: { ...last, pages: 0 } } } });
  await run("ohara.js");
  assert.deepEqual(cells(part("list").children[0]), ["Frieren", "Vol. 3", "", ""]);
});

test("an empty library says how to start", async () => {
  const { card, text, part } = page({ id: "ohara", answers: { [URL]: { series: 0, volumes: 0, downloads: [], last: null } } });
  await run("ohara.js");
  assert.equal(card.hidden, false);
  assert.equal(text("reading"), "–");
  const hint = part("list").children[0].children[0];
  assert.equal(hint.textContent, "Search a manga in Ohara to start the shelf.");
  assert.equal(hint.style.gridColumn, "1 / -1");
  assert.equal(hint.style.textAlign, "left");
});

test("missing parts are skipped", async () => {
  const { card } = page({ id: "ohara", missing: ["state", "volumes", "downloads", "reading"], answers: { [URL]: { series: 0, volumes: 0, downloads: [], last: null } } });
  await run("ohara.js");
  assert.equal(card.hidden, false);
});

for (const [why, answer] of [["the service is off", 404], ["the page cannot reach it", new Error("offline")]]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "ohara", answers: { [URL]: answer } });
    await run("ohara.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("ohara.js");
});
