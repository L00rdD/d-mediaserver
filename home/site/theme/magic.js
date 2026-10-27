// Hub theme kit: inside Newt Scamander's case, the Hogwarts look.
//
// theme.js loads this file only while the look is "hogwarts", starts it, and stops it when
// the look changes. A page that sets <html data-theme="hogwarts"> by itself (the hub) can
// load it directly: it starts on its own.
//
// Behind the page it puts the vivarium (.t-hall, styled in theme.css): a night sky with stars,
// mist of ancient magic, the light of the open lid far above and a great circle of runes. A
// page can provide its own <div class="t-hall"> and put more in it; its children with
// data-depth="<px>" move with the mouse. The hall is there even for a still page (reduced
// motion, <body data-t-calm>): it just does not move. Everything else only runs when the page
// may move.
//
// One canvas, fixed over the page and transparent to the mouse, draws fireflies, ribbons of
// ancient magic winding through the air, a wand trail of sparks behind the cursor, a Lumos
// burst with a circle of runes on each click, and the Golden Snitch (click it). Now and then:
// a shooting star, the owl post flying through with a letter, an Occamy coiling across, a
// Revelio wave lighting up every panel it passes, a silver Patronus. <body data-t-hall="rich">
// makes all of that come more often; <body data-t-air="off"> leaves out the fireflies, the ribbons and
// the Occamy and the Patronus, for a page that draws its own (the hub, in 3D, with Hedwig). The hall moves with the mouse and the scroll,
// near things more than far ones.
// On the page (CSS in theme.css, under html.t-magic): each .t-panel gathers out of light as it
// comes into view, its gilt corners drawing themselves; liquid-gold .t-title, pulsing .t-heading
// diamonds and .t-bar gauges with light flowing through.
//
// window.Magic, for pages that want more:
//   Magic.start() / Magic.stop(), Magic.running
//   Magic.emit(x, y, { n, color: "gold" | "silver" | "white" | "blue", speed, life, size, spread, gravity, dir })
//   Magic.burst(x, y, color)          a Lumos burst
//   Magic.circle(x, y, { r, life, color: "gold" | "blue" })   a circle of runes, forming then fading
//   Magic.revelio(x, y)               the Revelio wave, from that point (default: the middle)
//   Magic.snitch(), Magic.owl(), Magic.occamy(), Magic.patronus(), Magic.shootingStar()
//   Magic.runePath(i, x, y, h)        SVG path data of rune i (0..23), h tall, its top left at x, y
//   Magic.release()                   lets the panels in after <html class="t-hold"> held them back
//                                     (the hub's intro plays over them)
//   Magic.onFrame(fn)                 fn(time, dt, pointer, view) runs in the same animation frame;
//                                     view = { px, py, scroll }: the smoothed mouse (-0.5..0.5) and scrollY
//   document "magic:revelio" event    the wave went out ({ detail: { x, y } })
(() => {
  if (window.Magic) return;
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(pointer: fine)");
  const frameFns = [];
  const pointer = { x: -1, y: -1, active: false, moved: 0 };
  const view = { px: 0, py: 0, scroll: 0 };
  let canvas = null, ctx = null, raf = 0, running = false, last = 0, dpr = 1, W = 0, H = 0;
  let flies = [], wisps = [], sparks = [], rings = [], circles = [], waves = [], snitch = null, occ = null;
  let io = null, mo = null, startedAt = 0;
  let hall = null, layers = [], flyers = [];
  const next = {}; // when each ambient event comes next (seconds)
  const panels = new Map(); // .t-panel -> its added decoration

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rich = () => document.body?.dataset.tHall === "rich";
  const air = () => document.body?.dataset.tAir !== "off"; // a page drawing its own air (the hub's 3D) turns this off
  const TAU = Math.PI * 2;

  // ---------- runes: the Elder Futhark as strokes in a box 0.6 wide and 1 tall ----------
  const RUNES = [
    [[0, 0, 0, 1], [0, 0.3, 0.5, 0.05], [0, 0.55, 0.5, 0.3]], // fehu
    [[0, 1, 0, 0], [0, 0, 0.5, 0.35], [0.5, 0.35, 0.5, 1]], // uruz
    [[0, 0, 0, 1], [0, 0.25, 0.42, 0.5], [0.42, 0.5, 0, 0.75]], // thurisaz
    [[0, 0, 0, 1], [0, 0.05, 0.45, 0.3], [0, 0.35, 0.45, 0.6]], // ansuz
    [[0, 0, 0, 1], [0, 0, 0.42, 0.25], [0.42, 0.25, 0, 0.5], [0, 0.5, 0.45, 1]], // raido
    [[0.45, 0.2, 0, 0.5], [0, 0.5, 0.45, 0.8]], // kaunan
    [[0, 0.1, 0.55, 0.9], [0.55, 0.1, 0, 0.9]], // gebo
    [[0, 0, 0, 1], [0, 0, 0.42, 0.2], [0.42, 0.2, 0, 0.45]], // wunjo
    [[0, 0, 0, 1], [0.5, 0, 0.5, 1], [0, 0.35, 0.5, 0.6]], // hagalaz
    [[0.25, 0, 0.25, 1], [0, 0.35, 0.5, 0.6]], // naudiz
    [[0.25, 0, 0.25, 1]], // isa
    [[0.2, 0.12, 0, 0.32], [0, 0.32, 0.2, 0.52], [0.36, 0.48, 0.56, 0.68], [0.56, 0.68, 0.36, 0.88]], // jera
    [[0.25, 0, 0.25, 1], [0.25, 0, 0.5, 0.2], [0.25, 1, 0, 0.8]], // eihwaz
    [[0, 0, 0, 1], [0, 0, 0.4, 0.2], [0, 1, 0.4, 0.8], [0.4, 0.2, 0.4, 0.8]], // perth
    [[0.3, 0, 0.3, 1], [0.3, 0.38, 0, 0], [0.3, 0.38, 0.6, 0]], // algiz
    [[0.5, 0, 0, 0.4], [0, 0.4, 0.5, 0.6], [0.5, 0.6, 0, 1]], // sowilo
    [[0.3, 0, 0.3, 1], [0.3, 0, 0, 0.3], [0.3, 0, 0.6, 0.3]], // tiwaz
    [[0, 0, 0, 1], [0, 0, 0.42, 0.25], [0.42, 0.25, 0, 0.5], [0, 0.5, 0.42, 0.75], [0.42, 0.75, 0, 1]], // berkanan
    [[0, 0, 0, 1], [0.5, 0, 0.5, 1], [0, 0, 0.25, 0.3], [0.25, 0.3, 0.5, 0]], // ehwaz
    [[0, 0, 0, 1], [0.5, 0, 0.5, 1], [0, 0, 0.5, 0.4], [0.5, 0, 0, 0.4]], // mannaz
    [[0, 0, 0, 1], [0, 0, 0.42, 0.3]], // laguz
    [[0.3, 0.2, 0.05, 0.5], [0.05, 0.5, 0.3, 0.8], [0.3, 0.8, 0.55, 0.5], [0.55, 0.5, 0.3, 0.2]], // ingwaz
    [[0, 0, 0, 1], [0.6, 0, 0.6, 1], [0, 0, 0.6, 1], [0.6, 0, 0, 1]], // dagaz
    [[0.3, 0, 0.02, 0.3], [0.02, 0.3, 0.3, 0.6], [0.3, 0.6, 0.58, 0.3], [0.58, 0.3, 0.3, 0], [0.3, 0.6, 0, 1], [0.3, 0.6, 0.6, 1]], // othala
  ];
  const runePath = (i, x, y, h) => RUNES[((i % RUNES.length) + RUNES.length) % RUNES.length]
    .map(([a, b, c, d]) => `M${(x + a * h).toFixed(1)} ${(y + b * h).toFixed(1)}L${(x + c * h).toFixed(1)} ${(y + d * h).toFixed(1)}`).join("");
  const drawRune = (i, h) => { // centred on 0, 0 in the canvas
    ctx.beginPath();
    for (const [a, b, c, d] of RUNES[i % RUNES.length]) { ctx.moveTo((a - 0.3) * h, (b - 0.5) * h); ctx.lineTo((c - 0.3) * h, (d - 0.5) * h); }
    ctx.stroke();
  };

  // ---------- the vivarium: sky, mist, the lid's light, the circle of runes; built once ----------
  // A ring of runes for an SVG of viewBox 0 0 1000 1000: n runes h tall on radius r
  const runeRing = (r, n, h, offset = 0) => {
    let d = "";
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const x = 500 + Math.sin(a) * r, y = 500 - Math.cos(a) * r;
      d += `<path transform="rotate(${((a * 180) / Math.PI).toFixed(2)} ${x.toFixed(1)} ${y.toFixed(1)})" d="${runePath(k * 7 + offset, x - 0.3 * h, y - 0.5 * h, h)}"/>`;
    }
    return d;
  };
  const ticks = (r1, r2, n) => {
    let d = "";
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU, s = Math.sin(a), c = Math.cos(a);
      d += `M${(500 + s * r1).toFixed(1)} ${(500 - c * r1).toFixed(1)}L${(500 + s * r2).toFixed(1)} ${(500 - c * r2).toFixed(1)}`;
    }
    return `<path d="${d}"/>`;
  };
  const GREAT_CIRCLE = () => `<svg viewBox="0 0 1000 1000" aria-hidden="true">
    <g class="t-ring" stroke-width="2"><circle cx="500" cy="500" r="490"/><circle cx="500" cy="500" r="470" stroke-width="1"/>${ticks(470, 455, 120)}${runeRing(430, 36, 34)}<circle cx="500" cy="500" r="388"/></g>
    <g class="t-ring t-rev" stroke-width="1.5"><circle cx="500" cy="500" r="360" stroke-dasharray="2 10"/><path d="M500 140L812 680H188Z"/><path d="M500 860L188 320H812Z"/>${runeRing(300, 24, 30, 5)}<circle cx="500" cy="500" r="262"/></g>
    <g class="t-ring" stroke-width="1"><circle cx="500" cy="500" r="200" stroke-dasharray="40 8 4 8"/>${ticks(200, 185, 48)}<circle cx="500" cy="500" r="120"/></g>
  </svg>`;
  const buildHall = () => {
    if (hall && hall.isConnected) return;
    hall = document.querySelector(".t-hall");
    if (!hall) {
      hall = document.createElement("div");
      hall.className = "t-hall";
      document.body.prepend(hall);
    }
    hall.setAttribute("aria-hidden", "true");
    const add = (cls, html) => {
      let el = hall.querySelector(":scope > ." + cls);
      if (!el) { el = document.createElement("div"); el.className = cls; el.innerHTML = html; hall.prepend(el); }
      return el;
    };
    // prepended in reverse: the sky at the back
    const runes = add("t-runes", GREAT_CIRCLE());
    const rays = add("t-rays", "");
    const mist = add("t-mist", "<i></i><i></i><i></i>");
    const sky = add("t-sky", '<i class="t-stars"></i><i class="t-stars t-b"></i>');
    layers = [
      { el: sky, depth: 4, scroll: 0.03 },
      { el: mist, depth: 12, scroll: 0.06 },
      { el: rays, depth: 3, scroll: 0.04 },
      { el: runes, depth: 8, scroll: 0.08 },
    ];
    for (const el of hall.querySelectorAll("[data-depth]")) layers.push({ el, depth: +el.dataset.depth || 0, scroll: +el.dataset.scroll || 0 });
  };

  // ---------- sprites: a soft glow per colour, drawn once ----------
  const sprite = (inner, mid) => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.18, inner);
    grad.addColorStop(0.45, mid);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return c;
  };
  let SPRITES = null;
  const sprites = () => SPRITES || (SPRITES = {
    gold: sprite("rgba(255, 226, 150, 0.95)", "rgba(212, 150, 50, 0.32)"),
    silver: sprite("rgba(225, 238, 255, 0.95)", "rgba(150, 185, 235, 0.3)"),
    white: sprite("rgba(255, 250, 235, 0.95)", "rgba(255, 220, 160, 0.25)"),
    blue: sprite("rgba(150, 240, 255, 0.95)", "rgba(40, 170, 220, 0.34)"),
    violet: sprite("rgba(214, 190, 255, 0.95)", "rgba(130, 90, 230, 0.3)"),
  });
  const STROKE = { gold: "255, 222, 150", blue: "150, 236, 255", silver: "215, 230, 255", white: "255, 244, 220" };

  // ---------- canvas ----------
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); // phones: plenty sharp for glows, a third of the pixels
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const want = Math.round(Math.min(90, Math.max(16, (W * H) / 20000)));
    if (!air()) { flies = []; wisps = []; return; }
    while (flies.length < want) flies.push(firefly());
    flies.length = want;
    const nw = (rich() ? 5 : 3) - (W < 600 ? 2 : 0);
    while (wisps.length < nw) wisps.push(wisp(true));
    wisps.length = nw;
  };

  // a firefly: wanders, and its light comes and goes
  const firefly = () => ({
    x: rand(0, W), y: rand(0, H), vx: 0, vy: 0,
    ph: rand(0, TAU), f1: rand(0.1, 0.3), f2: rand(0.1, 0.3), blink: rand(0.6, 1.6),
    r: rand(0.6, 1.8), a: rand(0.35, 0.8), img: Math.random() < 0.35 ? "blue" : Math.random() < 0.15 ? "violet" : "gold",
  });

  // a ribbon of ancient magic: a bright head winding through the air, now and then looping,
  // its trail fading behind it
  const wisp = (anywhere) => {
    const side = Math.floor(rand(0, 4));
    const x = anywhere ? rand(0, W) : side === 0 ? -60 : side === 1 ? W + 60 : rand(0, W);
    const y = anywhere ? rand(0, H) : side === 2 ? -60 : side === 3 ? H + 60 : rand(0, H);
    return {
      x, y, ang: Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.8, 0.8), sp: rand(55, 95), turn: 0,
      loop: 0, loopDir: 1, nextLoop: rand(2, 7), trail: [], ph: rand(0, TAU),
      color: Math.random() < 0.6 ? "blue" : "gold", len: Math.round(rand(38, 60)),
    };
  };

  const emit = (x, y, o = {}) => {
    const n = o.n ?? 8;
    for (let i = 0; i < n && sparks.length < 360; i++) {
      const ang = o.dir !== undefined ? o.dir + rand(-(o.spread ?? 0.6), o.spread ?? 0.6) : rand(0, TAU);
      const sp = rand(0.3, 1) * (o.speed ?? 60);
      const life = rand(0.55, 1) * (o.life ?? 0.9);
      sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, size: rand(0.6, 1) * (o.size ?? 7), g: o.gravity ?? 24, img: o.color || "gold" });
    }
  };

  const circle = (x, y, o = {}) => {
    if (circles.length > 6) circles.shift();
    circles.push({ x, y, t: 0, r: o.r ?? 40, life: o.life ?? 1.1, color: o.color || "gold", rot: rand(0, TAU), spin: rand(0.6, 1.1) * (Math.random() < 0.5 ? -1 : 1), seed: Math.floor(rand(0, 24)) });
  };

  const burst = (x, y, color = "white") => {
    rings.push({ x, y, t: 0, color });
    circle(x, y, { r: 30, life: 0.9, color: color === "silver" ? "blue" : "gold" });
    emit(x, y, { n: 18, speed: 150, life: 0.8, size: 9, gravity: 10, color: color === "white" ? "gold" : color });
    emit(x, y, { n: 6, speed: 40, life: 0.5, size: 18, gravity: 0, color });
  };

  // ---------- Revelio: a wave from a point to the edges; every panel it passes lights up ----------
  const revelio = (x = W / 2, y = H * 0.45) => {
    if (!running) return;
    const targets = [...document.querySelectorAll(".t-panel, [data-reveal]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { el, d: Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y), r, on: r.bottom > 0 && r.top < H };
    }).filter((t) => t.on);
    waves.push({ x, y, t: 0, max: Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) + 80, targets });
    document.dispatchEvent(new CustomEvent("magic:revelio", { detail: { x, y } }));
  };
  const WAVE_SPEED = 900; // px/s

  // ---------- the Golden Snitch ----------
  const launchSnitch = () => {
    if (snitch) return;
    const fromLeft = Math.random() < 0.5;
    const pts = [{ x: fromLeft ? -40 : W + 40, y: rand(H * 0.1, H * 0.6) }];
    for (let i = 0; i < 4; i++) pts.push({ x: rand(W * 0.12, W * 0.88), y: rand(H * 0.08, H * 0.75) });
    pts.push({ x: fromLeft ? W + 40 : -40, y: rand(H * 0.05, H * 0.5) });
    snitch = { pts, t: 0, dur: rand(3.6, 5), x: pts[0].x, y: pts[0].y, ang: 0 };
  };
  // Catmull-Rom through the points: smooth, but with sharp darts between them
  const along = (pts, t, smooth) => {
    const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const u = t * (pts.length - 1) - seg;
    const e = smooth ? u : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // dart, hover, dart
    const p0 = pts[Math.max(0, seg - 1)], p1 = pts[seg], p2 = pts[seg + 1], p3 = pts[Math.min(pts.length - 1, seg + 2)];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * e + (2 * a - 5 * b + 4 * c - d) * e * e + (-a + 3 * b - 3 * c + d) * e * e * e);
    return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) };
  };
  const drawSnitch = (s, time) => {
    const flap = Math.sin(time * 70);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.globalCompositeOperation = "source-over";
    // wings: thin silver veined blades, beating very fast
    ctx.rotate(s.ang * 0.3);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(-0.5 + flap * 0.55);
      ctx.beginPath();
      ctx.ellipse(10, -3, 11, 3.2, -0.25, 0, TAU);
      ctx.fillStyle = "rgba(240, 236, 220, 0.75)";
      ctx.fill();
      ctx.strokeStyle = "rgba(170, 150, 110, 0.8)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.restore();
    }
    // the ball
    const g = ctx.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, 5);
    g.addColorStop(0, "#fff6cf");
    g.addColorStop(0.45, "#e8b830");
    g.addColorStop(1, "#8a5d10");
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.6;
    ctx.drawImage(sprites().gold, s.x - 16, s.y - 16, 32, 32);
  };

  // ---------- the Occamy: a feathered serpent, blue and gold, coiling across the sky ----------
  const occamy = () => {
    if (!running || occ) return;
    const ltr = Math.random() < 0.5;
    const pts = [{ x: ltr ? -120 : W + 120, y: rand(H * 0.1, H * 0.4) }];
    const n = W < 600 ? 3 : 5;
    for (let i = 1; i <= n; i++) {
      const k = i / (n + 1);
      pts.push({ x: (ltr ? k : 1 - k) * W + rand(-60, 60), y: rand(H * 0.08, H * 0.55) });
    }
    pts.push({ x: ltr ? W + 200 : -200, y: rand(H * 0.05, H * 0.35) });
    const s = W < 600 ? 0.65 : rand(0.85, 1.1);
    occ = { pts, t: 0, dur: rand(9, 12) * (W < 600 ? 0.75 : 1), body: [], s, x: pts[0].x, y: pts[0].y, loop: null, flap: 0 };
  };
  const stepOccamy = (o, dt, time) => {
    // during a loop the head circles, the rest of the path waits
    if (o.loop) {
      o.loop.a += o.loop.dir * dt * 3.6;
      o.x = o.loop.cx + Math.cos(o.loop.a) * o.loop.r;
      o.y = o.loop.cy + Math.sin(o.loop.a) * o.loop.r;
      if (Math.abs(o.loop.a - o.loop.a0) >= TAU) o.loop = null;
    } else {
      o.t += dt / o.dur;
      if (o.t >= 1) return false;
      const p = along(o.pts, o.t, true);
      const vx = p.x - o.x, vy = p.y - o.y;
      o.x = p.x;
      o.y = p.y;
      // now and then it coils once in the air
      if (!o.looped && o.t > 0.35 && o.t < 0.6 && Math.random() < dt * 0.9) {
        o.looped = true;
        const ang = Math.atan2(vy, vx), dir = Math.random() < 0.5 ? 1 : -1, r = 46 * o.s;
        const a0 = ang - (dir * Math.PI) / 2 + Math.PI;
        o.loop = { cx: o.x - Math.cos(a0) * r, cy: o.y - Math.sin(a0) * r, r, a: a0, a0, dir };
      }
    }
    // the body follows the head's path, one point every 4 px
    const b = o.body;
    if (!b.length || Math.hypot(o.x - b[0].x, o.y - b[0].y) > 4 * o.s) b.unshift({ x: o.x, y: o.y });
    const N = Math.round(64 * (W < 600 ? 0.8 : 1));
    if (b.length > N) b.length = N;
    o.flap += dt * 7;
    if (Math.random() < 0.6) { const q = pick(b); emit(q.x, q.y, { n: 1, color: Math.random() < 0.5 ? "blue" : "gold", speed: 14, life: 1.1, size: 6, gravity: 8 }); }
    return true;
  };
  const drawOccamy = (o) => {
    const b = o.body;
    if (b.length < 4) return;
    const s = o.s;
    ctx.globalCompositeOperation = "lighter";
    // the glow around the body
    for (let i = 0; i < b.length; i += 3) {
      const u = i / b.length;
      ctx.globalAlpha = 0.28 * (1 - u);
      const r = 42 * s * (1 - u * 0.7);
      ctx.drawImage(sprites().blue, b[i].x - r / 2, b[i].y - r / 2, r, r);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // the body, tail first: scales shading from violet at the tail to blue, the belly gold
    for (let i = b.length - 1; i >= 0; i--) {
      const u = i / (b.length - 1);
      const r = s * (1.2 + 6.6 * Math.pow(1 - u, 0.7) * Math.min(1, (1 - u) * 6 + 0.25));
      const hue = 190 + u * 70, light = 58 - u * 14;
      ctx.beginPath();
      ctx.arc(b[i].x, b[i].y, r, 0, TAU);
      ctx.fillStyle = `hsl(${hue}, 85%, ${light}%)`;
      ctx.fill();
      if (i % 2 === 0 && u < 0.85) {
        ctx.beginPath();
        ctx.arc(b[i].x, b[i].y + r * 0.35, r * 0.45, 0, TAU);
        ctx.fillStyle = "rgba(255, 214, 120, 0.55)";
        ctx.fill();
      }
    }
    // wings, a little behind the head: fans of feathers, beating
    const wi = Math.min(b.length - 2, 9);
    const p = b[wi], q = b[wi + 1];
    const ang = Math.atan2(p.y - q.y, p.x - q.x);
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      ctx.scale(1, side * (0.55 + 0.45 * Math.sin(o.flap)));
      for (let f = 0; f < 6; f++) {
        const a = -0.5 - f * 0.28, L = s * (34 - f * 3.2);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(Math.cos(a + 0.35) * L * 0.6, Math.sin(a + 0.35) * L * 0.6 - 4 * s, Math.cos(a) * L, Math.sin(a) * L);
        ctx.quadraticCurveTo(Math.cos(a - 0.15) * L * 0.5, Math.sin(a - 0.15) * L * 0.5, 0, 0);
        const g = ctx.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L);
        g.addColorStop(0, "rgba(90, 200, 240, 0.95)");
        g.addColorStop(0.6, "rgba(120, 140, 255, 0.85)");
        g.addColorStop(1, "rgba(255, 220, 140, 0.9)");
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.restore();
    }
    // the head: a bird's, with a crest of gold feathers and a beak
    const h = b[0], hn = b[2];
    const ha = Math.atan2(h.y - hn.y, h.x - hn.x);
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(ha);
    ctx.beginPath();
    ctx.ellipse(1 * s, 0, 9 * s, 7 * s, 0, 0, TAU);
    ctx.fillStyle = "hsl(192, 85%, 60%)";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8 * s, -2.5 * s);
    ctx.lineTo(17 * s, 1 * s);
    ctx.lineTo(8 * s, 3 * s);
    ctx.fillStyle = "#f1c860";
    ctx.fill();
    for (let f = 0; f < 4; f++) {
      ctx.beginPath();
      ctx.moveTo(-2 * s, -4 * s);
      ctx.quadraticCurveTo(-8 * s, (-10 - f * 2) * s, (-16 - f * 3) * s, (-6 - f * 3.5) * s);
      ctx.strokeStyle = `rgba(255, ${210 - f * 15}, ${120 + f * 20}, 0.9)`;
      ctx.lineWidth = 1.6 * s;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(4 * s, -2 * s, 1.6 * s, 0, TAU);
    ctx.fillStyle = "#1a1006";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(4.5 * s, -2.5 * s, 0.6 * s, 0, TAU);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
  };

  // ---------- things that fly through: DOM sprites moved in the frame loop ----------
  const OWL = `<svg viewBox="0 0 110 80" aria-hidden="true">
    <defs><radialGradient id="t-owl-b" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fbf7ec"/><stop offset=".7" stop-color="#e2d6bf"/><stop offset="1" stop-color="#b9a98c"/></radialGradient></defs>
    <g class="t-wing t-bw"><path d="M52 34C44 20 30 9 10 6 18 12 22 16 25 21 18 19 13 19 8 21 17 24 24 28 30 33 25 33 20 35 17 38 28 40 40 40 50 40Z" fill="#cdbfa4"/><path d="M14 9L22 17M12 20L25 24M20 36L33 37" stroke="#9c8a6c" stroke-width=".8" fill="none"/></g>
    <path d="M30 44C24 45 19 48 15 52 22 52 28 51 34 49Z" fill="#d9ccb2"/><path d="M17 51L24 49M20 52L27 50" stroke="#a8977a" stroke-width=".6"/>
    <path d="M30 46C33 35 44 30 57 31 70 32 78 38 78 46 78 54 68 58 55 58 42 58 32 54 30 46Z" fill="url(#t-owl-b)"/>
    <g fill="#a08a64" opacity=".7"><path d="M45 40l1.6 1.6M52 44l1.6 1.6M59 40l1.6 1.6M48 50l1.6 1.6M56 51l1.6 1.6M64 46l1.6 1.6" stroke="#9a845e" stroke-width="1.1" stroke-linecap="round"/></g>
    <circle cx="80" cy="36" r="12.5" fill="url(#t-owl-b)"/>
    <path d="M80 26C86 26 91 31 91 37 91 43 86 47 80 47 76 45 74 41 74 36 74 31 76 27 80 26Z" fill="#fffdf6"/>
    <path d="M80 26C86 26 91 31 91 37 91 43 86 47 80 47" fill="none" stroke="#c4a87a" stroke-width="1.2"/>
    <circle cx="85" cy="34.5" r="3.1" fill="#1a1006"/><circle cx="85.9" cy="33.6" r=".9" fill="#fff"/>
    <path d="M88.6 38.4L92.4 40.6 88.4 42Z" fill="#5c4630"/>
    <path d="M60 57L58 63M64 57L64 63" stroke="#7a6248" stroke-width="1.6" stroke-linecap="round"/>
    <g class="t-owl-letter" transform="rotate(-10 62 66)"><rect x="50" y="60" width="24" height="16" rx="1" fill="#f1e2bb" stroke="#b09358" stroke-width=".6"/><path d="M50 60L62 69 74 60" fill="none" stroke="#b09358" stroke-width=".6"/><circle cx="62" cy="69" r="2.8" fill="#a3211f"/></g>
    <g class="t-wing t-fw"><path d="M56 35C50 18 37 4 14 0 23 7 27 12 30 18 22 16 15 16 9 19 20 22 28 27 34 33 28 33 22 35 18 39 31 41 44 41 56 40Z" fill="#fbf8f0"/><path d="M19 3L28 13M14 18L29 22M22 37L36 38M33 27L44 33" stroke="#b6a586" stroke-width=".8" fill="none"/></g>
  </svg>`;
  const LETTER = `<svg viewBox="0 0 30 21" aria-hidden="true"><rect x=".5" y=".5" width="29" height="20" rx="1" fill="#f1e2bb" stroke="#a88a50" stroke-width=".7"/><path d="M.5 .5L15 12 29.5 .5" fill="none" stroke="#a88a50" stroke-width=".7"/><circle cx="15" cy="12" r="3.2" fill="#a3211f"/><circle cx="14.2" cy="11.2" r="1" fill="#d4544c"/></svg>`;
  // a stag, all silver light
  const STAG = `<svg viewBox="0 -14 200 184" aria-hidden="true">
    <defs><linearGradient id="t-ps" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#cfe0ff"/><stop offset="1" stop-color="#9fbfff"/></linearGradient>
    <filter id="t-pf" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g filter="url(#t-pf)" fill="url(#t-ps)" stroke="#eef5ff" stroke-width="1" opacity=".92">
      <path d="M30 92C34 78 52 72 76 74 98 76 118 72 132 64 140 52 146 40 152 30 156 24 164 22 170 26L188 34C191 37 189 41 184 41L168 40C160 46 154 56 150 70 148 84 146 94 140 100L146 128 158 152 152 154 138 130 132 106 124 108 116 140 120 158 113 159 107 140 112 106C96 110 76 110 62 106L56 130 36 150 31 146 46 126 46 104 40 100 24 124 10 134 7 129 20 118 30 98C26 96 24 92 30 92Z"/>
      <path d="M158 28L150 21 156 33Z"/>
      <path d="M162 24C158 12 152 4 140 0M157 15C150 12 146 14 142 18M152 8C150 2 152 -2 156 -6M168 24C172 10 178 2 190 -4M173 13C180 12 186 14 190 18M178 6C178 0 176 -4 172 -9" fill="none" stroke-width="3" stroke-linecap="round"/>
      <path d="M30 90C24 86 19 88 17 93" fill="none" stroke-width="2.5" stroke-linecap="round"/>
    </g>
  </svg>`;
  const flyer = (cls, svg) => {
    const el = document.createElement("div");
    el.className = "t-flyer " + cls;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = svg;
    document.body.append(el);
    return el;
  };
  const place = (el, x, y, extra = "") => { el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)${extra}`; };

  // the owl post: swoops in from one side, lets a letter go, climbs out the other side
  const owl = () => {
    if (!running || flyers.some((f) => f.kind === "owl")) return;
    const el = flyer("t-owl", OWL);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y0 = rand(0.06, 0.22) * H, dip = rand(0.18, 0.32) * H, drop = rand(0.35, 0.6);
    const scale = W < 600 ? 0.7 : rand(0.85, 1.1);
    flyers.push({ kind: "owl", el, t: 0, dur: rand(7, 10) * (W < 600 ? 0.7 : 1), step(f, dt) {
      f.t += dt / f.dur;
      const k = f.t;
      const x = dir > 0 ? -130 + (W + 260) * k : W + 130 - (W + 260) * k;
      const y = y0 + Math.sin(k * Math.PI) * dip - k * 40 + Math.sin(k * 18) * 4;
      el.classList.toggle("t-glide", k > 0.3 && k < 0.42);
      const tilt = Math.cos(k * Math.PI) * -12 * dir;
      place(el, x - 55, y, ` scale(${(dir * scale).toFixed(2)}, ${scale.toFixed(2)}) rotate(${tilt.toFixed(1)}deg)`);
      if (!f.dropped && k > drop) {
        f.dropped = true;
        el.querySelector(".t-owl-letter").style.display = "none";
        letter(x + 8 * dir, y + 62 * scale, dir);
      }
      return k < 1;
    } });
  };
  // the letter falls like a leaf, rocking and turning, then fades
  const letter = (x, y, dir) => {
    const el = flyer("t-letter", LETTER);
    flyers.push({ kind: "letter", el, x, y, vx: dir * 40, vy: 10, t: 0, rot: 0, step(f, dt) {
      f.t += dt;
      f.vy = Math.min(70, f.vy + 60 * dt);
      f.vx *= 1 - 0.8 * dt;
      f.x += (f.vx + Math.sin(f.t * 2.6) * 38) * dt;
      f.y += f.vy * dt;
      f.rot = Math.sin(f.t * 2.6) * 32;
      el.style.opacity = Math.min(1, (4.5 - f.t) / 1.2).toFixed(2);
      place(el, f.x - 15, f.y - 10, ` rotate(${f.rot.toFixed(1)}deg)`);
      if (Math.random() < 0.15) emit(f.x, f.y, { n: 1, speed: 8, life: 0.7, size: 5, gravity: -6 });
      return f.t < 4.5 && f.y < H + 30;
    } });
  };
  // a Patronus gallops across, shedding silver
  const patronus = () => {
    if (!running || flyers.some((f) => f.kind === "patronus")) return false;
    const el = flyer("t-patronus", STAG);
    const size = W < 600 ? 150 : 210, y0 = H * rand(0.3, 0.5) - size / 2;
    el.style.width = el.style.height = size + "px";
    flyers.push({ kind: "patronus", el, t: 0, dur: W < 600 ? 4.5 : 6.5, step(f, dt) {
      f.t += dt / f.dur;
      const k = f.t;
      const x = -size - 20 + (W + size + 60) * k, y = y0 - Math.abs(Math.sin(k * Math.PI * 7)) * 22;
      place(el, x, y, ` rotate(${(Math.sin(k * Math.PI * 14) * 3).toFixed(2)}deg)`);
      el.style.opacity = Math.max(0, Math.min(1, k / 0.1, (1 - k) / 0.18)).toFixed(2);
      emit(x + rand(0.1, 0.7) * size, y + rand(0.3, 0.85) * size, { n: 2, color: "silver", speed: 26, life: 1.4, size: 10, gravity: -10 });
      return k < 1;
    } });
    return true;
  };
  const shootingStar = () => {
    const sky = hall?.querySelector(".t-sky");
    if (!running || !sky) return;
    const s = document.createElement("i");
    s.className = "t-shoot";
    const ltr = Math.random() < 0.5;
    s.style.cssText = `left:${rand(10, 80).toFixed(0)}%;top:${rand(3, 30).toFixed(0)}%;--a:${(ltr ? rand(8, 30) : rand(150, 172)).toFixed(0)}deg;--l:${rand(260, 520).toFixed(0)}px`;
    sky.append(s);
    setTimeout(() => s.remove(), 1400);
  };

  // how often each thing happens: [first, then between], in seconds; the hub asks for more
  const CADENCE = {
    rich: { owl: [9, 25, 50], snitch: [16, 30, 60], star: [2, 7, 16], occamy: [5, 28, 55], revelio: [4.5, 30, 55], patronus: [60, 160, 280] },
    light: { owl: [25, 60, 120], snitch: [20, 50, 100], star: [5, 14, 30], occamy: [40, 90, 180], revelio: [30, 90, 180], patronus: [200, 300, 500] },
  };
  const EVENTS = { owl, snitch: launchSnitch, star: shootingStar, occamy: () => air() && occamy(), revelio: () => revelio(), patronus: () => air() && patronus() };
  const schedule = (time, first) => {
    const c = CADENCE[rich() ? "rich" : "light"];
    for (const k in c) if (first || next[k] === undefined) next[k] = time + (first ? rand(c[k][0], c[k][0] * 1.4) : rand(c[k][1], c[k][2]));
  };

  // ---------- the loop ----------
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const time = now / 1000;
    const dt = Math.min(0.05, last ? time - last : 0.016);
    last = time;

    // ambient life
    if (next.owl === undefined) schedule(time, true);
    const c = CADENCE[rich() ? "rich" : "light"];
    for (const k in next) if (time > next[k]) { EVENTS[k](); next[k] = time + rand(c[k][1], c[k][2]); }

    // parallax: the mouse (fine pointers only) and the scroll; near things move more than far ones
    if (fine.matches && pointer.active) {
      view.px += ((pointer.x / W - 0.5) - view.px) * Math.min(1, dt * 2.5);
      view.py += ((pointer.y / H - 0.5) - view.py) * Math.min(1, dt * 2.5);
    }
    view.scroll = scrollY;
    const sc = Math.min(view.scroll, H * 1.5);
    for (const l of layers) {
      const x = -view.px * l.depth, y = -view.py * l.depth * 0.6 - sc * l.scroll;
      if (Math.abs(x - (l.x || 0)) + Math.abs(y - (l.y || 0)) < 0.05) continue;
      l.x = x;
      l.y = y;
      l.el.style.translate = `${x.toFixed(2)}px ${y.toFixed(2)}px`;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const S = sprites();

    // fireflies wandering, their light coming and going
    for (const f of flies) {
      f.vx += (Math.sin(time * f.f1 + f.ph) * 9 - f.vx) * dt;
      f.vy += (Math.cos(time * f.f2 + f.ph * 1.7) * 7 - 2 - f.vy) * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -20) f.x = W + 20; else if (f.x > W + 20) f.x = -20;
      if (f.y < -20) f.y = H + 20; else if (f.y > H + 20) f.y = -20;
      const b = Math.max(0, Math.sin(time * f.blink + f.ph));
      ctx.globalAlpha = f.a * (0.15 + 0.85 * b * b * b);
      const s = f.r * 7 * (0.8 + 0.4 * b);
      ctx.drawImage(S[f.img], f.x - s / 2, f.y - s / 2, s, s);
    }

    // ribbons of ancient magic
    for (let i = 0; i < wisps.length; i++) {
      const w = wisps[i];
      w.nextLoop -= dt;
      if (w.loop > 0) {
        w.loop -= dt;
        w.ang += w.loopDir * 4.2 * dt;
      } else {
        // a gentle meander, drawn back towards the middle of the screen when far out
        const home = Math.atan2(H / 2 - w.y, W / 2 - w.x);
        let diff = home - w.ang;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const out = Math.max(0, Math.hypot(w.x - W / 2, w.y - H / 2) / Math.hypot(W / 2, H / 2) - 0.55);
        w.ang += (Math.sin(time * 0.9 + w.ph) * 1.1 + diff * out * 2.5) * dt;
        if (w.nextLoop < 0) { w.loop = TAU / 4.2; w.loopDir = Math.random() < 0.5 ? 1 : -1; w.nextLoop = rand(4, 9); }
      }
      w.x += Math.cos(w.ang) * w.sp * dt;
      w.y += Math.sin(w.ang) * w.sp * dt;
      w.trail.unshift({ x: w.x, y: w.y });
      if (w.trail.length > w.len) w.trail.length = w.len;
      const t = w.trail;
      // a soft band, then a bright thread, then the head
      for (let k = 0; k < t.length; k += 2) {
        const u = 1 - k / t.length;
        ctx.globalAlpha = 0.22 * u * u;
        const s = 26 * u + 4;
        ctx.drawImage(S[w.color], t[k].x - s / 2, t[k].y - s / 2, s, s);
      }
      if (t.length > 3) {
        ctx.globalAlpha = 0.55;
        ctx.lineCap = "round";
        for (let k = 1; k < t.length; k++) {
          const u = 1 - k / t.length;
          ctx.beginPath();
          ctx.moveTo(t[k - 1].x, t[k - 1].y);
          ctx.lineTo(t[k].x, t[k].y);
          ctx.strokeStyle = `rgba(${STROKE[w.color]}, ${(u * 0.9).toFixed(2)})`;
          ctx.lineWidth = 2.2 * u + 0.3;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.9;
      ctx.drawImage(S[w.color], w.x - 9, w.y - 9, 18, 18);
      if (Math.random() < dt * 8) emit(w.x, w.y, { n: 1, color: w.color, speed: 10, life: 1, size: 5, gravity: 6 });
      if (w.x < -200 || w.x > W + 200 || w.y < -200 || w.y > H + 200) wisps[i] = wisp(false);
    }

    // sparks: the wand trail, bursts, whatever the page emits
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= dt;
      if (p.life <= 0) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue; }
      p.vx *= 1 - 2.2 * dt;
      p.vy = p.vy * (1 - 2.2 * dt) + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.4);
      const s = p.size * (0.4 + 0.6 * k);
      ctx.drawImage(S[p.img], p.x - s / 2, p.y - s / 2, s, s);
    }

    // Lumos: a ring of light spreading from the click
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.t += dt;
      if (r.t > 0.7) { rings.splice(i, 1); continue; }
      const k = r.t / 0.7;
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + k * 70, 0, TAU);
      ctx.strokeStyle = r.color === "silver" ? "rgba(215, 230, 255, 1)" : "rgba(255, 226, 150, 1)";
      ctx.lineWidth = 1.5 * (1 - k) + 0.3;
      ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.9;
      const s = 60 * (1 - k * 0.5);
      ctx.drawImage(S[r.color] || S.white, r.x - s / 2, r.y - s / 2, s, s);
    }

    // circles of runes: drawn in, turning, then fading
    for (let i = circles.length - 1; i >= 0; i--) {
      const o = circles[i];
      o.t += dt;
      if (o.t > o.life) { circles.splice(i, 1); continue; }
      const k = o.t / o.life;
      const grow = 1 - Math.pow(1 - Math.min(1, k * 2.5), 3);
      const r = o.r * (0.55 + 0.45 * grow);
      const col = STROKE[o.color] || STROKE.gold;
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot + o.spin * o.t);
      ctx.globalAlpha = Math.min(1, k * 6) * (1 - Math.pow(k, 2));
      ctx.strokeStyle = `rgb(${col})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU * grow);
      ctx.stroke();
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, 0, TAU * grow);
      ctx.stroke();
      const n = 10, h = r * 0.2;
      for (let j = 0; j < n * grow; j++) {
        ctx.save();
        ctx.rotate((j / n) * TAU);
        ctx.translate(0, -r * 0.85);
        drawRune(o.seed + j * 5, h);
        ctx.restore();
      }
      ctx.restore();
    }

    // Revelio: a wide soft band and a bright edge, sweeping out; panels light up as it passes
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.t += dt;
      const r = w.t * WAVE_SPEED;
      if (r > w.max) { waves.splice(i, 1); continue; }
      const fade = (1 - r / w.max) * Math.min(1, r / 160); // born thin at the middle, not as a blot
      ctx.globalAlpha = 0.16 * fade;
      ctx.lineWidth = Math.min(46, r * 0.5 + 1);
      ctx.strokeStyle = "rgba(95, 216, 236, 1)";
      ctx.beginPath();
      ctx.arc(w.x, w.y, Math.max(1, r - 20), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.75 * fade;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "rgba(200, 248, 255, 1)";
      ctx.beginPath();
      ctx.arc(w.x, w.y, r, 0, TAU);
      ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const a = rand(0, TAU);
        emit(w.x + Math.cos(a) * r, w.y + Math.sin(a) * r, { n: 1, color: "blue", speed: 10, life: 0.8, size: 7, gravity: 0 });
      }
      for (const t of w.targets) {
        if (t.done || t.d > r) continue;
        t.done = true;
        t.el.classList.remove("t-revealed");
        void t.el.offsetWidth; // restart the animation
        t.el.classList.add("t-revealed");
        setTimeout(() => t.el.classList.remove("t-revealed"), 1700);
        emit(t.r.left, t.r.top, { n: 4, color: "blue", speed: 30, life: 0.8, size: 8, gravity: 0 });
        emit(t.r.right, t.r.bottom, { n: 4, color: "blue", speed: 30, life: 0.8, size: 8, gravity: 0 });
      }
    }

    // the Snitch
    if (snitch) {
      snitch.t += dt / snitch.dur;
      if (snitch.t >= 1) snitch = null;
      else {
        const p = along(snitch.pts, snitch.t);
        snitch.ang = Math.atan2(p.y - snitch.y, p.x - snitch.x);
        snitch.x = p.x;
        snitch.y = p.y;
        if (Math.random() < 0.5) emit(p.x, p.y, { n: 1, speed: 12, life: 0.6, size: 5, gravity: 6 });
        drawSnitch(snitch, time);
      }
    }

    // the Occamy
    if (occ) {
      if (stepOccamy(occ, dt, time)) drawOccamy(occ);
      else occ = null;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    // owls, letters, Patronuses
    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      if (!f.step(f, dt)) { f.el.remove(); flyers.splice(i, 1); }
    }

    for (const fn of frameFns) {
      try { fn(time, dt, pointer, view); } catch (e) { console.error(e); }
    }
    pointer.moved = 0;
  };

  // ---------- pointer ----------
  const onMove = (e) => {
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    const dist = pointer.active ? Math.hypot(dx, dy) : 0;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    pointer.moved += dist;
    if (e.pointerType === "touch") return; // a finger scrolling is not a wand
    // more sparks the faster the wand moves, a few at most
    const n = Math.min(3, Math.floor(dist / 9));
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      emit(pointer.x - dx * (1 - k), pointer.y - dy * (1 - k), { n: 1, speed: 25, life: 0.7, size: rand(5, 8), gravity: 30 });
    }
  };
  const onDown = (e) => {
    if (e.button > 0) return;
    if (snitch && Math.hypot(e.clientX - snitch.x, e.clientY - snitch.y) < 34) {
      // Caught it!
      emit(snitch.x, snitch.y, { n: 40, speed: 220, life: 1.2, size: 10, gravity: 40 });
      rings.push({ x: snitch.x, y: snitch.y, t: 0, color: "gold" });
      circle(snitch.x, snitch.y, { r: 60, life: 1.4 });
      snitch = null;
      return;
    }
    burst(e.clientX, e.clientY);
  };
  const onLeave = () => { pointer.active = false; };

  // ---------- panels: gilt corners, gathering out of light as they come into view ----------
  const CORNER = '<svg viewBox="0 0 34 34" aria-hidden="true"><path pathLength="1" d="M1 30V9Q1 1 9 1H30"/><path pathLength="1" d="M5 22V11Q5 5 11 5H22"/><path pathLength="1" d="M30 1c2.5 0 3 3 1 3.6M1 30c0 2.5 3 3 3.6 1"/><path pathLength="1" d="M9 13q0-4 4-4"/><path class="t-gem" d="M1 -3.2L5.2 1 1 5.2-3.2 1Z"/></svg>';
  const dress = (p) => {
    if (panels.has(p) || !p.isConnected) return;
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) { panels.set(p, null); return; } // a scroll box: leave it alone
    const deco = document.createElement("span");
    deco.className = "t-frame";
    deco.setAttribute("aria-hidden", "true");
    deco.innerHTML = '<i class="t-sweep"></i>' + ["tl", "tr", "bl", "br"].map((c) => `<b class="t-corner t-${c}">${CORNER}</b>`).join("");
    const wasStatic = cs.position === "static";
    if (wasStatic) p.style.position = "relative";
    p.append(deco);
    panels.set(p, { deco, wasStatic });
    const r = p.getBoundingClientRect();
    if (!held() && r.bottom > 0 && r.top < innerHeight) {
      // In view: bring it in, unless the page is redrawing its panels long after load (no flicker then)
      const late = performance.now() - startedAt > 2500;
      requestAnimationFrame(() => appear(p, late));
    } else { p.classList.add("t-wait"); io.observe(p); }
  };
  // light gathers along the edges, and the panel takes shape
  const appear = (p, now) => {
    p.classList.remove("t-wait");
    p.classList.add("t-in", ...(now ? ["t-in-now"] : []));
    if (now) return;
    const r = p.getBoundingClientRect();
    const n = Math.min(26, Math.round((r.width + r.height) / 40));
    for (let i = 0; i < n; i++) {
      const u = Math.random(), side = Math.floor(rand(0, 4));
      const x = side < 2 ? r.left + u * r.width : side === 2 ? r.left : r.right;
      const y = side < 2 ? (side ? r.bottom : r.top) : r.top + u * r.height;
      const out = side === 0 ? -Math.PI / 2 : side === 1 ? Math.PI / 2 : side === 2 ? Math.PI : 0;
      // start a little outside, fly in towards the edge
      const d = rand(18, 40);
      emit(x + Math.cos(out) * d, y + Math.sin(out) * d, { n: 1, dir: out + Math.PI, spread: 0.2, speed: d * 3.2, life: 0.55, size: 7, gravity: 0, color: Math.random() < 0.5 ? "blue" : "gold" });
    }
  };
  const held = () => root.classList.contains("t-hold");
  // the intro is over: in-view panels gather now, the others when they scroll in
  const release = () => {
    root.classList.remove("t-hold");
    if (!running) return;
    for (const p of panels.keys()) if (p.classList.contains("t-wait")) { io.unobserve(p); io.observe(p); }
  };
  const scan = () => { for (const p of document.querySelectorAll(".t-panel")) dress(p); };
  let scanQueued = false;
  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => { scanQueued = false; if (running) scan(); });
  };
  const undress = () => {
    for (const [p, d] of panels) {
      p.classList.remove("t-in", "t-wait", "t-in-now", "t-revealed");
      if (!d) continue;
      d.deco.remove();
      if (d.wasStatic) p.style.position = "";
    }
    panels.clear();
  };

  // ---------- start / stop ----------
  const calm = () => reduce.matches || (document.body && document.body.hasAttribute("data-t-calm"));
  const onVisibility = () => {
    if (!running) return;
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  };

  const start = () => {
    if (running) return;
    if (!document.body) { document.addEventListener("DOMContentLoaded", start, { once: true }); return; }
    if (root.dataset.theme !== "hogwarts") return;
    buildHall(); // the hall is there even when nothing may move
    if (calm()) return;
    running = true;
    root.classList.add("t-magic");
    canvas = document.createElement("canvas");
    canvas.className = "t-magic-layer";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:999";
    document.body.append(canvas);
    ctx = canvas.getContext("2d");
    resize();
    addEventListener("resize", resize);
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting && !held()) { appear(e.target, false); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    // panels drawn later by the page get dressed too (text updates and flyers are ignored)
    mo = new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && !/t-frame|t-flyer|t-shoot/.test(n.className)) return queueScan();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    startedAt = performance.now();
    scan();
    last = 0;
    for (const k in next) delete next[k];
    if (!document.hidden) raf = requestAnimationFrame(frame);
  };

  const stop = () => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    raf = 0;
    removeEventListener("resize", resize);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerdown", onDown);
    document.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", onVisibility);
    io.disconnect();
    mo.disconnect();
    undress();
    canvas.remove();
    canvas = ctx = null;
    for (const f of flyers) f.el.remove();
    flyers = [];
    sparks = [];
    rings = [];
    circles = [];
    waves = [];
    flies = [];
    wisps = [];
    snitch = occ = null;
    for (const l of layers) { l.el.style.translate = ""; l.x = l.y = 0; }
    root.classList.remove("t-magic");
  };

  // Turning reduced motion on (or off) while the page is open
  reduce.addEventListener?.("change", () => { if (reduce.matches) stop(); else if (root.dataset.theme === "hogwarts") start(); });

  window.Magic = {
    start,
    stop,
    get running() { return running; },
    emit: (x, y, o) => running && emit(x, y, o),
    burst: (x, y, c) => running && burst(x, y, c),
    circle: (x, y, o) => running && circle(x, y, o),
    revelio: (x, y) => running && revelio(x, y),
    snitch: () => running && launchSnitch(),
    owl,
    occamy,
    patronus: () => running && patronus(),
    shootingStar,
    runePath,
    release,
    onFrame: (fn) => { frameFns.push(fn); return () => frameFns.splice(frameFns.indexOf(fn), 1); },
  };
  if (root.dataset.theme === "hogwarts") start();
})();
