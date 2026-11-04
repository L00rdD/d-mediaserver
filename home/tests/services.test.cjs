// Tests of the "Online" list (home/site/services.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, settle } = require("./cards-page.cjs");

const containers = [
  { name: "transmission", state: "running", status: "Up 2 days", ports: "0.0.0.0:9091->9091/tcp, [::]:9091->9091/tcp, 51413/udp" },
  { name: "jellyfin", state: "running", status: "Up 3 days", ports: "0.0.0.0:8096->8096/tcp, 0.0.0.0:7000-7020->7000-7020/tcp" },
  { name: "bazarr", state: "exited", status: "Exited (1)", ports: "" },
  { name: "gluetun", state: "running", status: "Up 1 day" },
];

test("lists the containers, stopped first, with their TCP ports as links", async () => {
  const { card, text, part } = page({ id: "services", answers: { "/services.json": () => structuredClone(containers) } });
  await run("services.js");
  assert.equal(text("count"), "3/4");
  assert.equal(card.classList.contains("degraded"), true);
  const rows = part("list").children;
  assert.deepEqual(rows.map((r) => r.children[0].textContent), ["bazarr", "gluetun", "jellyfin", "transmission"]);
  assert.deepEqual(rows.map((r) => r.className), ["down", "up", "up", "up"]);
  assert.equal(rows[0].children[1].className, "sv-state");
  assert.equal(rows[0].children[1].textContent, "Exited (1)");
  assert.deepEqual(rows[0].children[2].children, []);
  // a range is cut at ten ports
  const jellyfin = rows[2].children[2].children;
  assert.deepEqual(jellyfin.map((a) => a.textContent), [":7000", ":7001", ":7002", ":7003", ":7004", ":7005", ":7006", ":7007", ":7008", ":7009", ":8096"]);
  const link = rows[3].children[2].children[0];
  assert.deepEqual([link.textContent, link.href, link.target, link.rel, link.className], [":9091", "http://dpi.lan:9091", "_blank", "noopener", ""]);
});

test("all up: not degraded; read again when opened; closes like a menu", async () => {
  const { card, calls, fire } = page({ id: "services", answers: { "/services.json": () => [containers[0]] } });
  await run("services.js");
  assert.equal(card.classList.contains("degraded"), false);
  assert.equal(calls.length, 1);
  card.open = false;
  await card.fire("toggle");
  assert.equal(calls.length, 1);
  card.open = true;
  await card.fire("toggle");
  await settle();
  assert.equal(calls.length, 2);
  // a click inside keeps it open, outside closes it
  await fire("click", { target: card });
  assert.equal(card.open, true);
  await fire("click", { target: {} });
  assert.equal(card.open, false);
  await fire("click", { target: {} });
  card.open = true;
  await fire("keydown", { key: "a" });
  assert.equal(card.open, true);
  await fire("keydown", { key: "Escape" });
  assert.equal(card.open, false);
});

for (const [why, answer] of [["the service is off", 404], ["the page cannot reach it", new Error("offline")]]) {
  test(`stays empty when ${why}`, async () => {
    const { text, part } = page({ id: "services", answers: { "/services.json": answer } });
    await run("services.js");
    assert.equal(text("count"), "");
    assert.deepEqual(part("list").children, []);
  });
}

test("does nothing on a page without the list", async () => {
  page({});
  await run("services.js");
});
