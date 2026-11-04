// A fake hub page for the Hogwarts look's WebGL world (home/site/vivarium.js), used by the
// vivarium*.test.cjs files: its sections and creatures, canvases, the animation frames and the
// timers driven by the test, Math.random seeded, and three.js swapped for three-fake.mjs (the
// real maths, no GPU). An ES module runs once per process: one import per test file.
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "../site/vivarium.js");
const FAKE = pathToFileURL(path.join(__dirname, "three-fake.mjs")).href;
const tick = setImmediate; // the real one: the page's timers are fakes

registerHooks({
  resolve: (spec, context, next) => (spec.endsWith("/three-r186.min.js") && !context.parentURL.endsWith("three-fake.mjs") ? { url: FAKE, shortCircuit: true } : next(spec, context)),
});

// mulberry32: the same "random" numbers on every run
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// a 2D canvas: draws nothing, keeps the pixels written by putImageData
const canvas2d = () => {
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "putImageData") return (img) => { t.pixels = img.data; };
      if (String(k).startsWith("create")) return () => ({ addColorStop() {} });
      return () => {};
    },
  });
  return { width: 0, height: 0, getContext: () => ctx, ctx };
};

const classes = () => {
  const set = new Set();
  return { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), contains: (c) => set.has(c), set };
};

// An element listening for events, with a box on the page
const element = (dataset = {}, rect = {}) => {
  const listeners = {};
  return {
    dataset,
    rect: { top: 0, height: 0, ...rect },
    getBoundingClientRect() { return { top: this.rect.top - globalThis.scrollY, height: this.rect.height }; },
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    fire: (type, e = {}) => (listeners[type] || []).forEach((fn) => fn(e)),
  };
};

// The page: html.intro on a first visit, sections of the case's worlds and their creatures
function page({ intro = true, reduce = false, width = 1440, height = 900, dpr = 2, seed = 1, magic = true, sections, creatures } = {}) {
  const p = { frames: new Map(), rafId: 0, timers: [], timerId: 0, now: 0, listeners: {}, resized: null };
  p.root = { classList: classes() };
  if (intro) p.root.classList.add("intro");
  p.canvas = { className: "gl" };
  p.skip = element();
  p.sections = (sections || ["night", "cave", "forest", "mist", "shed"]).map((u, i) => element({ universe: u }, { top: i * height, height }));
  p.creatures = (creatures || ["phoenix", "niffler", "bowtruckle", "hippogriff", "owl", "basilisk"]).map((c) => element({ creature: c }));
  const docListeners = {};
  p.document = {
    documentElement: p.root,
    body: {},
    hidden: false,
    fonts: { ready: Promise.resolve() },
    createElement: () => canvas2d(),
    querySelector: (sel) => (sel === "canvas.gl" ? p.canvas : sel === ".intro-skip" ? p.skip : null),
    querySelectorAll: (sel) => (sel === "[data-universe]" ? p.sections : sel === "[data-creature]" ? p.creatures : []),
    addEventListener: (type, fn) => (docListeners[type] ||= []).push(fn),
    fire: (type) => (docListeners[type] || []).forEach((fn) => fn()),
  };
  p.magic = { released: 0, release() { this.released++; }, runePath: (i, x, y, h) => `M${x} ${y}L${x + h * 0.3} ${y + h}` };
  const g = {
    window: globalThis,
    document: p.document,
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    scrollY: 0,
    Magic: magic ? p.magic : undefined,
    matchMedia: () => ({ matches: reduce }),
    Path2D: class { constructor(d) { this.d = d; } },
    ResizeObserver: class { constructor(fn) { p.resized = fn; } observe() {} },
    requestAnimationFrame: (fn) => { p.frames.set(++p.rafId, fn); return p.rafId; },
    cancelAnimationFrame: (id) => p.frames.delete(id),
    setTimeout: (fn, ms) => { p.timers.push({ id: ++p.timerId, fn, at: p.now + ms }); return p.timerId; },
    setInterval: (fn, ms) => { p.timers.push({ id: ++p.timerId, fn, at: p.now + ms, every: ms }); return p.timerId; },
    clearTimeout: (id) => { p.timers = p.timers.filter((t) => t.id !== id); },
    addEventListener: (type, fn) => (p.listeners[type] ||= []).push(fn),
  };
  g.clearInterval = g.clearTimeout;
  for (const k in g) Object.defineProperty(globalThis, k, { value: g[k], configurable: true, writable: true });
  Math.random = seeded(seed);
  p.window = (type, e = {}) => (p.listeners[type] || []).forEach((fn) => fn(e));
  p.three = () => globalThis.__three;
  // lets the promises (models, skies) settle
  p.settle = async () => { for (let i = 0; i < 4; i++) await new Promise(tick); };
  // runs the page for `seconds`: animation frames at 60 a second, the timers when due
  p.run = async (seconds, each) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      p.now += 1000 / 60;
      const due = [...p.frames];
      p.frames.clear();
      for (const [, fn] of due) fn(p.now);
      for (const t of p.timers.filter((t) => t.at <= p.now)) {
        if (t.every) t.at += t.every; else p.timers.splice(p.timers.indexOf(t), 1);
        t.fn();
      }
      await new Promise(tick);
      await each?.(i);
    }
  };
  return p;
}

// Imports the vivarium (once per process); `file` lets a check run another copy of it
const load = (file = SCRIPT) => import(pathToFileURL(file).href);

module.exports = { page, load, seeded, SCRIPT };
