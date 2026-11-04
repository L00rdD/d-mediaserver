// A fake page for the Hogwarts theme kit (home/site/theme/magic.js), used by magic.test.cjs:
// elements with classes, data-* and boxes, canvases that record what they draw, and the
// animation frames, timers, observers and Math.random driven by the test.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SCRIPT = path.join(__dirname, "../site/theme/magic.js");

// mulberry32: the same "random" numbers on every run
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// A 2D context writing every call and every property set into log
const context = (log) => {
  const state = { globalAlpha: 1, globalCompositeOperation: "source-over" };
  return new Proxy(state, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (String(k).startsWith("create")) return (...a) => (log.push([k, ...a]), { addColorStop: (...s) => log.push(["stop", ...s]) });
      return (...a) => { log.push([k, ...a]); };
    },
    set: (t, k, v) => { t[k] = v; log.push(["=" + String(k), v]); return true; },
  });
};

// ".a", "[data-x]", ":scope > .a", and lists of them
const matches = (el, sel, scope) => sel.split(",").some((one) => {
  one = one.trim();
  if (one.startsWith(":scope > ")) return el.parent === scope && matches(el, one.slice(9), scope);
  if (one.startsWith(".")) return el.classList.contains(one.slice(1));
  if (one.startsWith("[data-")) return one.slice(6, -1).replace(/-(\w)/g, (_, c) => c.toUpperCase()) in el.dataset;
  return el.tagName === one.toUpperCase();
});

class FakeElement {
  constructor(page, tag) {
    this.page = page;
    this.n = page.made = (page.made || 0) + 1; // drawn sprites show as their canvas, by birth order
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.className = "";
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.html = "";
    this.listeners = {};
    this.rect = { left: 0, top: 0, width: 0, height: 0 };
    const names = () => this.className.split(/\s+/).filter(Boolean);
    this.classList = {
      add: (...c) => { this.className = [...new Set([...names(), ...c])].join(" "); },
      remove: (...c) => { this.className = names().filter((n) => !c.includes(n)).join(" "); },
      contains: (c) => names().includes(c),
      toggle: (c, on) => (on ?? !names().includes(c)) ? this.classList.add(c) : this.classList.remove(c),
    };
  }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e === this.page.root; }
  get innerHTML() { return this.html; }
  set innerHTML(v) { this.html = v; }
  get offsetWidth() { return this.rect.width; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  hasAttribute(k) { return k in this.attributes; }
  append(...els) { for (const e of els) { e.remove(); e.parent = this; this.children.push(e); } this.page.added(els); }
  prepend(...els) { for (const e of els.reverse()) { e.remove(); e.parent = this; this.children.unshift(e); } this.page.added(els); }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => matches(e, sel, this)); }
  querySelector(sel) {
    const found = this.querySelectorAll(sel)[0];
    if (found) return found;
    // a part written in innerHTML (the owl's letter)
    const cls = sel.startsWith(".") && sel.slice(1);
    if (cls && this.html.includes(`class="${cls}"`)) return (this.parts ||= {})[cls] ||= new FakeElement(this.page, "g");
    return null;
  }
  getBoundingClientRect() { const r = this.rect; return { ...r, right: r.left + r.width, bottom: r.top + r.height }; }
  getContext() { return (this.ctx ||= context(this === this.page.canvas() ? this.page.log : [])); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners[type] || []; if (l.includes(fn)) l.splice(l.indexOf(fn), 1); }
  toJSON() { return this.tagName + this.n; }
  fire(type, e = {}) { for (const fn of [...(this.listeners[type] || [])]) fn(e); }
}

// The page: <html data-theme> with a <body>; options set the look and the browser
function page({ theme = "hogwarts", reduce = false, fine = true, gecko = false, width = 1280, height = 800, dpr = 2, seed = 1, body = true } = {}) {
  const p = { log: [], frames: new Map(), timers: [], observed: new Set(), now: 0, rafId: 0, mutations: null, intersections: null };
  p.root = new FakeElement(p, "html");
  p.root.dataset.theme = theme;
  p.body = new FakeElement(p, "body");
  p.added = (els) => p.mutations?.([{ addedNodes: els }]);
  if (body) { p.root.children.push(p.body); p.body.parent = p.root; }
  p.canvas = () => p.body.children.find((e) => e.classList.contains("t-magic-layer"));
  p.el = (tag, { cls = "", data = {}, rect, style = {}, parent = p.body } = {}) => {
    const e = new FakeElement(p, tag);
    e.className = cls;
    Object.assign(e.dataset, data);
    Object.assign(e.style, style);
    if (rect) e.rect = rect;
    if (parent) { e.parent = parent; parent.children.push(e); }
    return e;
  };
  const listeners = {};
  const media = { reduce: { matches: reduce, addEventListener: (t, fn) => (p.onReduce = fn) }, fine: { matches: fine } };
  const doc = new FakeElement(p, "#document");
  Object.assign(doc, {
    documentElement: p.root,
    hidden: false,
    createElement: (tag) => new FakeElement(p, tag),
    querySelector: (sel) => p.root.querySelector(sel),
    querySelectorAll: (sel) => p.root.querySelectorAll(sel),
    dispatchEvent: (e) => { p.log.push(["event", e.type, e.detail]); doc.fire(e.type, e); },
  });
  Object.defineProperty(doc, "body", { get: () => (p.root.children.includes(p.body) ? p.body : null) });
  p.document = doc;
  const g = {
    window: globalThis,
    document: doc,
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    scrollY: 0,
    matchMedia: (q) => (q.includes("reduce") ? media.reduce : media.fine),
    getComputedStyle: (e) => ({ overflowX: e.style.overflowX || "visible", overflowY: e.style.overflowY || "visible", position: e.style.position || "static" }),
    requestAnimationFrame: (fn) => { p.frames.set(++p.rafId, fn); return p.rafId; },
    cancelAnimationFrame: (id) => p.frames.delete(id),
    setTimeout: (fn, ms) => p.timers.push({ fn, at: p.now + ms }),
    performance: { now: () => p.now },
    addEventListener: (t, fn) => (listeners[t] ||= []).push(fn),
    removeEventListener: (t, fn) => { const l = listeners[t] || []; if (l.includes(fn)) l.splice(l.indexOf(fn), 1); },
    IntersectionObserver: class { constructor(cb) { p.intersections = cb; } observe(e) { p.observed.add(e); } unobserve(e) { p.observed.delete(e); } disconnect() { p.observed.clear(); } },
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() { p.mutations = this.cb; } disconnect() { p.mutations = null; } },
  };
  for (const k in g) Object.defineProperty(globalThis, k, { value: g[k], configurable: true, writable: true });
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: gecko ? "Mozilla/5.0 Gecko/20100101 Firefox/128.0" : "Mozilla/5.0 Chrome/130" }, configurable: true });
  Math.random = seeded(seed);
  p.listeners = listeners;
  p.media = media;
  p.window = (type, e = {}) => { for (const fn of [...(listeners[type] || [])]) fn(e); };
  // runs the animation frames for `seconds`, 60 a second
  p.run = (seconds, each) => {
    for (let i = 0; i < seconds * 60; i++) {
      p.now += 1000 / 60;
      const due = [...p.frames];
      p.frames.clear();
      for (const [, fn] of due) fn(p.now);
      p.timers = p.timers.filter((t) => (t.at <= p.now ? (t.fn(), false) : true));
      each?.(i);
    }
  };
  return p;
}

// Runs the kit; a fresh copy unless told otherwise (window.Magic of an earlier run dropped first)
function load(file = SCRIPT, fresh = true) {
  if (fresh) delete globalThis.Magic;
  vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
  return globalThis.Magic;
}

module.exports = { page, load, seeded, SCRIPT };
