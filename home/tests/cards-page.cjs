// A fake page for the tests of the home page's card scripts (home/site/*.js): just
// enough DOM, fetch and timers for a script to run in node and for a test to read
// what it wrote. Not a test itself (no ".test." in the name).
const path = require("node:path");

// CARDS_SITE: another copy of home/site, to check the tests against an older version
const SITE = process.env.CARDS_SITE || path.join(__dirname, "../site");

// An element: children, text, classes, attributes, listeners. Parts named in
// [data-xx="key"] selectors are made on first use, unless listed as missing.
function element(tag = "div", missing = []) {
  const classes = new Set();
  const e = {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attributes: {},
    listeners: {},
    parts: {},
    hidden: true,
    _text: "",
    get textContent() { return this._text || this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join(""); },
    set textContent(v) { this._text = v; this.children = []; },
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); for (const c of String(v).split(" ").filter(Boolean)) classes.add(c); },
    classList: {
      add: (c) => classes.add(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
    },
    append(...nodes) { this._text = ""; this.children.push(...nodes); for (const n of nodes) if (typeof n === "object") n.parent = this; },
    appendChild(n) { this.append(n); return n; },
    prepend(...nodes) { this.children.unshift(...nodes); },
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); },
    remove() { this.removed = true; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    hasAttribute(k) { return k in this.attributes; },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    fire(type, event = {}) { return Promise.all((this.listeners[type] || []).map((fn) => fn(event))); },
    contains(other) { return other === this; },
    querySelector(sel) {
      const key = (sel.match(/"(.+)"/) || [])[1];
      if (key === undefined || missing.includes(key)) return null;
      return (this.parts[key] ??= element("span"));
    },
    // only "tag": the descendants of that tag
    querySelectorAll(sel) {
      const kids = this.children.filter((c) => typeof c === "object");
      return kids.flatMap((c) => [...(c.tagName === sel.toUpperCase() ? [c] : []), ...c.querySelectorAll(sel)]);
    },
  };
  return e;
}

// Fake fetch: answers[url start] = a JSON value, a status number, an Error, or a
// function of (url, options) returning one of those
function fetcher(answers, calls) {
  return async (url, options) => {
    calls.push({ url, options });
    const key = Object.keys(answers).find((k) => url.startsWith(k));
    let a = answers[key];
    if (typeof a === "function") a = a(url, options);
    if (a === undefined) a = 404;
    if (a instanceof Error) throw a;
    return { ok: typeof a !== "number", status: a, json: async () => a };
  };
}

// Sets up the globals of a page holding one card (id), and returns it.
function page({ id, answers = {}, missing = [], eventSource = false, html = {} } = {}) {
  const card = id ? element("a", missing) : null;
  const calls = [];
  const timers = [];
  const listeners = {};
  globalThis.document = {
    hidden: false,
    cookie: "",
    title: "Page",
    currentScript: null,
    documentElement: element("html"),
    head: element("head"),
    body: null,
    getElementById: (want) => (want === id ? card : null),
    createElement: (tag) => element(tag),
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    ...html,
  };
  globalThis.location = { hostname: "dpi.lan", href: "http://dpi.lan/", origin: "http://dpi.lan", search: "" };
  globalThis.window = eventSource ? { EventSource: true } : {};
  globalThis.fetch = fetcher(answers, calls);
  globalThis.setInterval = (fn, ms) => (timers.push({ fn, ms }), timers.length);
  globalThis.clearInterval = (n) => { if (timers[n - 1]) timers[n - 1].cleared = true; };
  const sources = [];
  globalThis.EventSource = function (url) { this.url = url; sources.push(this); };
  return {
    card,
    calls,
    timers,
    sources,
    fire: (type, event) => Promise.all((listeners[type] || []).map((fn) => fn(event))),
    part: (key) => card.querySelector(`"${key}"`),
    text: (key) => card.querySelector(`"${key}"`).textContent,
  };
}

// Runs a script of home/site afresh, then lets its promises settle
async function run(name) {
  const file = require("node:fs").realpathSync(path.join(SITE, name));
  delete require.cache[file];
  require(file);
  await settle();
}

async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((done) => setImmediate(done));
}

// A date a given number of minutes ago (negative: in the future)
const minutesAgo = (min) => new Date(Date.now() - min * 60000).toISOString();

module.exports = { element, page, run, settle, minutesAgo, SITE };
