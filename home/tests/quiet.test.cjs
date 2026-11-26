// Tests of the turtle card (home/site/quiet.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, element } = require("./cards-page.cjs");

// The quiet service: GET answers the status, POST picks the mode, unless refused
function quiet({ status, saves = true }) {
  const saved = [];
  const answers = {
    "/quiet": (url, options) => {
      if (options?.method !== "POST") return typeof status === "function" ? status() : status;
      const { mode } = JSON.parse(options.body);
      saved.push(mode);
      if (!saves) return 502;
      return { ...status, mode, turtle: mode === "on" };
    },
  };
  const p = page({ id: "quiet", answers });
  const buttons = ["auto", "on", "off"].map((mode) => Object.assign(element("button"), { dataset: { qtMode: mode } }));
  p.card.querySelectorAll = () => buttons;
  const pressed = () => buttons.filter((b) => b.attributes["aria-pressed"] === "true").map((b) => b.dataset.qtMode);
  const click = (mode) => buttons.find((b) => b.dataset.qtMode === mode).fire("click", { preventDefault() {} });
  return { ...p, saved, pressed, click };
}

test("hidden when the quiet service does not answer", async () => {
  for (const status of [502, new Error("offline")]) {
    const { card } = quiet({ status });
    await run("quiet.js");
    assert.equal(card.hidden, true);
  }
});

test("auto, on for a console, a film and the others' use", async () => {
  const { card, text, pressed } = quiet({
    status: { turtle: true, mode: "auto", consoles: [{ name: "PS5-399" }], playing: ["Dune"], others_mbps: 8.5 },
  });
  await run("quiet.js");
  assert.equal(card.hidden, false);
  assert.deepEqual(pressed(), ["auto"]);
  assert.equal(card.classList.contains("on"), true);
  assert.equal(text("state"), "Downloads slowed down");
  assert.equal(text("why"), "PS5-399, Dune, 8.5 Mb/s used by the others");
});

test("off, on during the five calm minutes, on in Transmission", async () => {
  let status = { turtle: false, consoles: [], playing: [], others_mbps: null };
  const { text, pressed, timers } = quiet({ status: () => status });
  await run("quiet.js");
  assert.deepEqual(pressed(), ["auto"]);  // an older service, without a mode
  assert.equal(text("state"), "Full speed");
  assert.equal(text("why"), "Nobody uses the network");
  status = { turtle: true, mode: "auto" };
  await timers[0].fn();
  assert.equal(timers[0].ms, 20000);
  assert.equal(text("why"), "The network was used a moment ago");
  status = { turtle: true, mode: "auto", hand: true };
  await timers[0].fn();
  assert.equal(text("why"), "Turned on in Transmission");
});

test("the buttons pick the mode", async () => {
  const { text, pressed, saved, click } = quiet({ status: { turtle: true, mode: "auto", consoles: [{ name: "PS5" }] } });
  await run("quiet.js");
  await click("off");
  assert.deepEqual(pressed(), ["off"]);
  assert.equal(text("state"), "Full speed");
  assert.equal(text("why"), "Kept at full speed by hand until Auto");
  await click("on");
  assert.deepEqual(pressed(), ["on"]);
  assert.equal(text("why"), "Kept on by hand until Auto");
  await click("auto");
  assert.deepEqual(saved, ["off", "on", "auto"]);
  assert.deepEqual(pressed(), ["auto"]);
});

test("a refused pick shows the mode as it was, and a failed refresh keeps it", async () => {
  let status = { turtle: false, mode: "auto" };
  const { pressed, saved, timers, text, click } = quiet({ status: () => status, saves: false });
  await run("quiet.js");
  await click("on");
  assert.deepEqual(saved, ["on"]);
  assert.deepEqual(pressed(), ["auto"]);
  status = new Error("offline");
  await timers[0].fn();
  assert.equal(text("state"), "Full speed");
});
