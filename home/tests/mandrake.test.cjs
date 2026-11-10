// Tests of the Mandrake card (home/site/mandrake.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, minutesAgo } = require("./cards-page.cjs");

const URL = "http://dpi.lan:8081/api/status.json";
const cells = (li) => li.children.map((c) => c.textContent);

const plants = [
  { name: "Basil", count: 3, state: "running", phase: "Sprouting", progress: 0.42, days_left: 9 },
  { name: "Tomato", count: 1, state: "not_started", phase: "-", progress: 0 },
  { name: "Mint", count: 1, state: "done", phase: "-", progress: 1 },
  { name: "Chili", count: 2, state: "paused", phase: "Resting", progress: 0.5 },
];

for (const [age, words] of [[0, "just now"], [12, "12 min ago"], [180, "3 h ago"]]) {
  test(`one row per plant, updated ${words}`, async () => {
    const { card, text, part } = page({ id: "mandrake", answers: { [URL]: { plants, updated_at: minutesAgo(age) } } });
    await run("mandrake.js");
    assert.equal(card.hidden, false);
    const rows = part("list").children;
    assert.deepEqual(cells(rows[0]), ["Basil ×3", "Sprouting", "", "9 d left"]);
    assert.equal(rows[0].children[2].className, "ss-bar");
    assert.equal(rows[0].children[2].children[0].style.width, "42%");
    assert.deepEqual(cells(rows[1]), ["Tomato", "Not started", "", ""]);
    assert.deepEqual(cells(rows[2]), ["Mint", "Complete", "", ""]);
    assert.deepEqual(cells(rows[3]), ["Chili ×2", "Resting", "", ""]);
    assert.equal(text("state"), "1 of 4 growing");
    assert.equal(text("updated"), `updated ${words}`);
  });
}

test("missing parts are skipped", async () => {
  const { card } = page({ id: "mandrake", missing: ["state", "updated"], answers: { [URL]: { plants: [], updated_at: minutesAgo(0) } } });
  await run("mandrake.js");
  assert.equal(card.hidden, false);
});

for (const [why, answer] of [["the service is off", 404], ["the page cannot reach it", new Error("offline")]]) {
  test(`hidden when ${why}`, async () => {
    const { card } = page({ id: "mandrake", answers: { [URL]: answer } });
    await run("mandrake.js");
    assert.equal(card.hidden, true);
  });
}

test("does nothing on a page without the card", async () => {
  page({});
  await run("mandrake.js");
});
