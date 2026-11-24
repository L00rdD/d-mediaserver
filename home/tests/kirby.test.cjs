// Tests of the Kirby card (home/site/kirby.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run } = require("./cards-page.cjs");

const URL = "http://dpi.lan:8587/api/status.json";
const cells = (li) => li.children.map((c) => c.textContent);
const recent = [{ name: "Mario Kart 8 Deluxe", size: 7.4e9, console: "Switch" }, { name: "Celeste", size: 600e6 }];

test("the downloads under way", async () => {
  const downloads = [{ name: "Zelda", pct: 42, state: "downloading" }, { name: "Metroid", pct: 3, state: "error" }];
  const { card, text, part } = page({ id: "kirby", answers: { [URL]: { games: 2, size: 8e9, downloads, recent } } });
  await run("kirby.js");
  assert.equal(card.hidden, false);
  assert.equal(text("state"), "2 games");
  assert.equal(text("games"), "2");
  assert.equal(text("size"), "8.0 GB");
  assert.equal(text("downloads"), "2");
  const rows = part("list").children;
  assert.deepEqual(cells(rows[0]), ["Zelda", "downloading", "", "42 %"]);
  assert.equal(rows[0].children[2].children[0].style.width, "42%");
  assert.deepEqual(cells(rows[1]), ["Metroid", "error", "", "3 %"]);
  assert.equal(rows.length, 2);
});

test("the latest games when nothing downloads", async () => {
  const { text, part } = page({ id: "kirby", answers: { [URL]: { games: 1, size: 600e6, downloads: [], recent } } });
  await run("kirby.js");
  assert.equal(text("state"), "1 game");
  assert.equal(text("size"), "600 MB");
  assert.equal(text("downloads"), "none");
  assert.deepEqual(cells(part("list").children[0]), ["Mario Kart 8 Deluxe", "Switch", "", "7.4 GB"]);
  assert.deepEqual(cells(part("list").children[1]), ["Celeste", "ready", "", "600 MB"]);
});

test("an empty library says how to start", async () => {
  const { card, part } = page({ id: "kirby", answers: { [URL]: { games: 0, size: 0, downloads: [], recent: [] } } });
  await run("kirby.js");
  assert.equal(card.hidden, false);
  const hint = part("list").children[0].children[0];
  assert.equal(hint.textContent, "Search a game in Kirby's catalogue to start the library.");
  assert.equal(hint.style.gridColumn, "1 / -1");
});

test("missing parts are skipped", async () => {
  const { card } = page({ id: "kirby", missing: ["state", "games", "size", "downloads"], answers: { [URL]: { games: 0, size: 0, downloads: [], recent: [] } } });
  await run("kirby.js");
  assert.equal(card.hidden, false);
});

for (const [why, answer] of [["the service is off", 404], ["the page cannot reach it", new Error("offline")]]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "kirby", answers: { [URL]: answer } });
    await run("kirby.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("kirby.js");
});
