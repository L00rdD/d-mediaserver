// Tests of the hub theme kit (home/site/theme/theme.js) on a fake page
const test = require("node:test");
const assert = require("node:assert");
const { page, run, element } = require("./cards-page.cjs");

// A page of a project using the kit: its URL, cookie, body and the script's address
function app({ search = "", cookie = "", body = null, src = null } = {}) {
  const p = page({});
  location.search = search;
  document.cookie = cookie;
  document.body = body;
  document.currentScript = src ? { src } : null;
  globalThis.getComputedStyle = (el) => ({ getPropertyValue: (name) => (el === document.documentElement ? `  ${name}-value ` : "") });
  const scripts = () => document.head.children.filter((e) => e.tagName === "SCRIPT");
  return { ...p, root: document.documentElement, scripts };
}

const appBody = (cls = ["t-app"], attrs = {}, dataset = {}) => {
  const b = element("body");
  for (const c of cls) b.classList.add(c);
  Object.assign(b.attributes, attrs);
  Object.assign(b.dataset, dataset);
  return b;
};

test("Reactor by default; the bar waits for the body; no bar outside an app", async () => {
  const { root, fire, scripts } = app();
  await run("theme/theme.js");
  assert.equal(root.dataset.theme, "reactor");
  assert.equal(window.Theme.name, "reactor");
  assert.equal(window.Theme.hub, "http://dpi.lan");
  assert.deepEqual(window.Theme.themes, ["reactor", "cyberpunk", "hogwarts"]);
  assert.equal(scripts().length, 0);
  document.body = appBody([]);
  await fire("DOMContentLoaded");
  assert.deepEqual(document.body.children, []);
});

test("the cookie gives the look, an unknown one is ignored", async () => {
  const { root } = app({ cookie: "a=1; style=cyberpunk" });
  await run("theme/theme.js");
  assert.equal(root.dataset.theme, "cyberpunk");
  const other = app({ cookie: "style=space" });
  await run("theme/theme.js");
  assert.equal(other.root.dataset.theme, "reactor");
});

test("?theme= forces a look over the cookie, unless unknown", async () => {
  const { root } = app({ search: "?theme=hogwarts", cookie: "style=cyberpunk" });
  await run("theme/theme.js");
  assert.equal(root.dataset.theme, "hogwarts");
  const other = app({ search: "?theme=space", cookie: "style=cyberpunk" });
  await run("theme/theme.js");
  assert.equal(other.root.dataset.theme, "cyberpunk");
});

test("Hogwarts loads magic.js once from the hub, starts and stops it", async () => {
  const { scripts } = app({ cookie: "style=hogwarts", src: "/theme/theme.js" });
  location.href = "http://hub.lan:80/x";
  await run("theme/theme.js");
  const [magic] = scripts();
  assert.equal(magic.src, "http://hub.lan/theme/magic.js");
  assert.equal(magic.async, true);
  // switched away before magic.js arrived, then back: still one script
  window.Theme.set("reactor");
  window.Theme.set("hogwarts");
  assert.equal(scripts().length, 1);
  // once there, it is started and stopped
  const calls = [];
  window.Magic = { start: () => calls.push("start"), stop: () => calls.push("stop") };
  window.Theme.set("cyberpunk");
  window.Theme.set("hogwarts");
  assert.deepEqual(calls, ["stop", "start"]);
});

test("the hub is where the script comes from", async () => {
  app({ src: "http://dpi.lan/theme/theme.js" });
  location.origin = "http://dpi.lan:8080";
  await run("theme/theme.js");
  assert.equal(window.Theme.hub, "http://dpi.lan");
});

test("set: stores the cookie, tells the listeners, ignores unknown and unchanged looks", async () => {
  const { root } = app();
  await run("theme/theme.js");
  const heard = [];
  window.Theme.onChange((name) => heard.push(name));
  window.Theme.set("space");
  assert.equal(document.cookie, "");
  window.Theme.set("cyberpunk");
  assert.equal(document.cookie, "style=cyberpunk; Path=/; Max-Age=31536000; SameSite=Lax");
  assert.equal(root.dataset.theme, "cyberpunk");
  window.Theme.set("cyberpunk");
  assert.deepEqual(heard, ["cyberpunk"]);
});

test("coming back to the tab picks up a look switched elsewhere", async () => {
  const { root, fire } = app();
  await run("theme/theme.js");
  document.cookie = "style=hogwarts";
  document.hidden = true;
  await fire("visibilitychange");
  assert.equal(root.dataset.theme, "reactor");
  document.hidden = false;
  await fire("visibilitychange");
  assert.equal(root.dataset.theme, "hogwarts");
});

test("the hub bar of an app: back link, name, theme switch", async () => {
  document.title = "";
  const body = appBody(["t-app"], {}, { tName: "Draupnir" });
  const { root } = app({ body, cookie: "style=cyberpunk", src: "http://dpi.lan/theme/theme.js" });
  await run("theme/theme.js");
  const [bar] = body.children;
  assert.equal(bar.tagName, "NAV");
  assert.equal(bar.className, "t-hubbar");
  assert.equal(bar.attributes["aria-label"], "Hub");
  const [home, name, themes] = bar.children;
  assert.deepEqual([home.tagName, home.className, home.href, home.textContent], ["A", "t-hubbar-home", "http://dpi.lan/", "Hub"]);
  assert.deepEqual([name.className, name.textContent], ["t-hubbar-name", "Draupnir"]);
  assert.deepEqual([themes.className, themes.attributes.role, themes.attributes["aria-label"]], ["t-hubbar-themes", "group", "Style"]);
  const pressed = () => themes.children.map((b) => `${b.type} ${b.value} ${b.textContent} ${b.attributes["aria-pressed"]}`);
  assert.deepEqual(pressed(), ["button reactor Reactor false", "button cyberpunk Cyberpunk true", "button hogwarts Hogwarts false"]);
  await themes.children[0].fire("click");
  assert.equal(root.dataset.theme, "reactor");
  assert.deepEqual(pressed(), ["button reactor Reactor true", "button cyberpunk Cyberpunk false", "button hogwarts Hogwarts false"]);
});

test("the bar takes the page title, and can be left out", async () => {
  const body = appBody();
  app({ body });
  document.title = "Sapling";
  await run("theme/theme.js");
  assert.equal(body.children[0].children[1].textContent, "Sapling");
  const bare = appBody(["t-app"], { "data-t-no-bar": "" });
  app({ body: bare });
  await run("theme/theme.js");
  assert.deepEqual(bare.children, []);
});

test("color reads the look's CSS variables", async () => {
  app();
  await run("theme/theme.js");
  assert.equal(window.Theme.color("accent"), "--t-accent-value");
});
