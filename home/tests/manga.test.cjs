// Tests of the Manga card (home/site/manga.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run } = require("./cards-page.cjs");

const URL = "http://dpi.lan:4567/api/graphql";
const cells = (li) => li.children.map((c) => c.textContent);
const secondsAgo = (min) => String(Math.round(Date.now() / 1000 - min * 60));

const data = (mangas, chapters = [], queue = []) => ({
  data: { mangas: { totalCount: mangas.length, nodes: mangas }, chapters: { nodes: chapters }, downloadStatus: { queue } },
});

test("the series, their chapters and the last ones downloaded", async () => {
  const chapters = [
    { name: "Chapitre 1130", fetchedAt: secondsAgo(12), manga: { title: "One Piece" } },
    { name: "Chapitre 40", fetchedAt: secondsAgo(180), manga: { title: "Frieren" } },
    { name: "Chapitre 39", fetchedAt: secondsAgo(3 * 1440), manga: { title: "Frieren" } },
  ];
  const mangas = [{ unreadCount: 2, downloadCount: 5 }, { unreadCount: 1, downloadCount: 7 }];
  const { card, text, part, calls } = page({ id: "manga", answers: { [URL]: data(mangas, chapters, [{ progress: 0.5 }, { progress: 0 }]) } });
  await run("manga.js");
  assert.equal(card.hidden, false);
  assert.equal(calls[0].options.method, "POST");
  assert.match(JSON.parse(calls[0].options.body).query, /inLibrary: true/);
  assert.equal(text("state"), "2 series");
  assert.equal(text("unread"), "3");
  assert.equal(text("saved"), "12");
  assert.equal(text("queue"), "2 chapters");
  const rows = part("list").children;
  assert.deepEqual(cells(rows[0]), ["One Piece", "Chapitre 1130", "", "12 min ago"]);
  assert.deepEqual(cells(rows[1]), ["Frieren", "Chapitre 40", "", "3 h ago"]);
  assert.deepEqual(cells(rows[2]), ["Frieren", "Chapitre 39", "", "3 d ago"]);
});

test("one series downloading one chapter", async () => {
  const { text } = page({ id: "manga", answers: { [URL]: data([{ unreadCount: 0, downloadCount: 0 }], [], [{ progress: 0.1 }]) } });
  await run("manga.js");
  assert.equal(text("state"), "1 series");
  assert.equal(text("queue"), "1 chapter");
});

test("an empty library says how to start", async () => {
  const { card, text, part } = page({ id: "manga", answers: { [URL]: data([]) } });
  await run("manga.js");
  assert.equal(card.hidden, false);
  assert.equal(text("state"), "0 series");
  assert.equal(text("queue"), "idle");
  const hint = part("list").children[0].children[0];
  assert.equal(hint.textContent, "Add a series in Suwayomi to follow its chapters.");
  assert.equal(hint.style.gridColumn, "1 / -1");
  assert.equal(hint.style.textAlign, "left");
});

test("missing parts are skipped", async () => {
  const { card } = page({ id: "manga", missing: ["state", "unread", "saved", "queue"], answers: { [URL]: data([]) } });
  await run("manga.js");
  assert.equal(card.hidden, false);
});

for (const [why, answer] of [["the service is off", 404], ["the page cannot reach it", new Error("offline")], ["the API returns errors", { errors: [{}] }]]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "manga", answers: { [URL]: answer } });
    await run("manga.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("manga.js");
});
