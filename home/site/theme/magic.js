// Hub theme kit: the Great Hall of the Hogwarts look.
//
// theme.js loads this file only while the look is "hogwarts", starts it, and stops it when
// the look changes. A page that sets <html data-theme="hogwarts"> by itself (the hub) can
// load it directly: it starts on its own.
//
// Behind the page it puts the hall (.t-hall, styled in theme.css): the enchanted ceiling, a
// night sky with stars and clouds, and floating candles at several depths. A page can provide
// its own <div class="t-hall" data-candles="40"> to choose how many candles; else one is added.
// The hall is there even for a still page (reduced motion, <body data-t-calm>): it just does
// not move. Everything else below only runs when the page may move.
//
// One canvas, fixed over the page and transparent to the mouse, draws golden dust drifting in
// the candlelight, a wand trail of sparks behind the cursor, a Lumos burst on each click, and
// the Golden Snitch (click it). Now and then: a shooting star, a candle guttering, a draught
// bending the flames, the owl post flying through with a letter, a ghost gliding across and a
// silver Patronus. <body data-t-hall="rich"> makes all of that come more often (the hub).
// The hall moves with the mouse and the scroll, near things more than far ones.
// On the page (CSS in theme.css, under html.t-magic): an ink flourish drawn in the corners of
// each .t-panel as it comes into view, liquid-gold .t-title, twinkling .t-heading stars and
// .t-bar gauges that move like molten gold.
//
// window.Magic, for pages that want more:
//   Magic.start() / Magic.stop(), Magic.running
//   Magic.emit(x, y, { n, color: "gold" | "silver" | "white", speed, life, size, spread, gravity, dir })
//   Magic.burst(x, y, color)       a Lumos burst
//   Magic.snitch(), Magic.owl(), Magic.ghost(), Magic.patronus(), Magic.gust(), Magic.shootingStar()
//   Magic.onFrame(fn)              fn(time, dt, pointer, view) runs in the same animation frame;
//                                  view = { px, py, scroll }: the smoothed mouse (-0.5..0.5) and scrollY
//   document "magic:gust" event    a draught goes through the hall (banners may stir)
(() => {
  if (window.Magic) return;
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(pointer: fine)");
  const frameFns = [];
  const pointer = { x: -1, y: -1, active: false, moved: 0 };
  const view = { px: 0, py: 0, scroll: 0 };
  let canvas = null, ctx = null, raf = 0, running = false, last = 0, dpr = 1, W = 0, H = 0;
  let motes = [], sparks = [], rings = [], snitch = null;
  let io = null, mo = null, startedAt = 0;
  let hall = null, layers = [], flyers = [];
  const next = {}; // when each ambient event comes next (seconds)
  const panels = new Map(); // .t-panel -> its added decoration

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rich = () => document.body?.dataset.tHall === "rich";
  const svgNS = "http://www.w3.org/2000/svg";

  // ---------- the hall: sky and candles, built once, even for a still page ----------
  const DEPTHS = [
    // name, share of the candles, width (px), opacity, bob (px), parallax (px), scroll factor
    ["far", 0.45, [6, 8.5], [0.42, 0.6], [4, 7], 7, 0.05],
    ["mid", 0.35, [10, 13], [0.75, 0.9], [6, 10], 15, 0.1],
    ["near", 0.2, [15, 20], [0.95, 1], [8, 13], 28, 0.18],
  ];
  const buildHall = () => {
    if (hall && hall.isConnected) return;
    hall = document.querySelector(".t-hall");
    if (!hall) {
      hall = document.createElement("div");
      hall.className = "t-hall";
      document.body.prepend(hall);
    }
    hall.setAttribute("aria-hidden", "true");
    layers = [];
    if (!hall.querySelector(".t-sky")) {
      const sky = document.createElement("div");
      sky.className = "t-sky";
      sky.innerHTML = '<i class="t-stars"></i><i class="t-stars t-b"></i><i class="t-clouds"></i><i class="t-clouds t-b"></i>';
      hall.prepend(sky);
    }
    layers.push({ el: hall.querySelector(".t-sky"), depth: 4, scroll: 0.03 });
    const w = innerWidth;
    const wanted = +hall.dataset.candles || Math.round(Math.min(12, Math.max(5, w / 130)));
    const n = w < 600 ? Math.min(wanted, Math.round(wanted * 0.4)) : w < 1000 ? Math.round(wanted * 0.7) : wanted;
    const spread = hall.dataset.spread === "hall"; // the hub: candles over the whole hall
    for (const [name, share, cw, co, cb, depth, scroll] of DEPTHS) {
      const layer = document.createElement("div");
      layer.className = "t-depth t-" + name;
      const count = Math.max(1, Math.round(n * share));
      for (let i = 0; i < count; i++) {
        const c = document.createElement("i");
        c.className = "t-candle " + pick(["t-ca", "t-ca", "t-cb", "t-cc"]);
        // the hub spreads them over the hall on a jittered grid, so they never bunch up; a project
        // keeps them in the margins, clear of its text
        const edge = w < 700 ? 5 : 14; // on a phone the margins are thin: hug the very edges
        const x = spread ? ((i + rand(0.15, 0.85)) / count) * 100 : i % 2 ? rand(100 - edge, 99) : rand(0, edge);
        let y = spread ? rand(3, name === "far" ? 52 : 68) : rand(5, name === "near" ? 50 : 40);
        if (spread && y < 20 && x > 26 && x < 74) y += 18; // not across the page title
        c.style.cssText = `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--w:${rand(...cw).toFixed(1)};--o:${rand(...co).toFixed(2)};` +
          `--by:${(-rand(...cb)).toFixed(1)}px;--bd:${rand(5, 9).toFixed(1)}s;--bl:${(-rand(0, 9)).toFixed(1)}s;` +
          `--fd:${rand(1.3, 2.6).toFixed(2)}s;--fl:${(-rand(0, 3)).toFixed(2)}s;--hd:${rand(1.8, 3.4).toFixed(2)}s`;
        c.append(document.createElement("b"));
        layer.append(c);
      }
      hall.append(layer);
      layers.push({ el: layer, depth, scroll });
    }
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
  });

  // ---------- canvas ----------
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); // phones: plenty sharp for glows, a third of the pixels
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const want = Math.round(Math.min(80, Math.max(14, (W * H) / 24000)));
    while (motes.length < want) motes.push(mote(true));
    motes.length = want;
  };

  const mote = (anywhere) => ({
    x: rand(0, W),
    y: anywhere ? rand(0, H) : H + 10,
    r: rand(0.5, 1.9),
    vy: rand(-9, -3),
    sway: rand(6, 18),
    freq: rand(0.15, 0.4),
    phase: rand(0, 6.3),
    a: rand(0.18, 0.55),
  });

  const emit = (x, y, o = {}) => {
    const n = o.n ?? 8;
    for (let i = 0; i < n && sparks.length < 320; i++) {
      const ang = o.dir !== undefined ? o.dir + rand(-(o.spread ?? 0.6), o.spread ?? 0.6) : rand(0, Math.PI * 2);
      const sp = rand(0.3, 1) * (o.speed ?? 60);
      const life = rand(0.55, 1) * (o.life ?? 0.9);
      sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life, max: life, size: rand(0.6, 1) * (o.size ?? 7), g: o.gravity ?? 24, img: o.color || "gold" });
    }
  };

  const burst = (x, y, color = "white") => {
    rings.push({ x, y, t: 0, color });
    emit(x, y, { n: 18, speed: 150, life: 0.8, size: 9, gravity: 10, color: color === "white" ? "gold" : color });
    emit(x, y, { n: 6, speed: 40, life: 0.5, size: 18, gravity: 0, color });
  };

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
  const along = (pts, t) => {
    const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
    const u = t * (pts.length - 1) - seg;
    const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; // dart, hover, dart
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
      ctx.ellipse(10, -3, 11, 3.2, -0.25, 0, Math.PI * 2);
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
    ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.6;
    ctx.drawImage(sprites().gold, s.x - 16, s.y - 16, 32, 32);
  };

  // ---------- things that fly through the hall: DOM sprites moved in the frame loop ----------
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
  // Nearly Headless Nick: ruff, doublet and plumed hat, his head not quite on straight
  const GHOST = `<svg viewBox="0 0 120 160" aria-hidden="true">
    <defs><linearGradient id="t-gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef6ff" stop-opacity=".95"/><stop offset=".55" stop-color="#cfe0f6" stop-opacity=".7"/><stop offset="1" stop-color="#b8d0f0" stop-opacity="0"/></linearGradient>
    <radialGradient id="t-gg" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#d8e8ff" stop-opacity=".5"/><stop offset="1" stop-color="#d8e8ff" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="60" cy="70" rx="58" ry="70" fill="url(#t-gg)"/>
    <path d="M38 64C30 70 24 84 22 100 20 118 26 136 18 158 34 150 42 156 52 148 62 158 70 150 80 156 90 148 100 154 104 146 96 128 100 112 98 96 96 82 90 70 82 64Z" fill="url(#t-gh)"/>
    <path d="M30 76C22 84 16 94 14 104 20 104 26 100 30 92ZM90 76C98 84 104 94 106 104 100 104 94 100 90 92Z" fill="url(#t-gh)"/>
    <path d="M44 66L60 120 76 66" fill="none" stroke="#f4f9ff" stroke-width="1" opacity=".7"/>
    <path d="M52 78h16M51 90h18M50 102h20" stroke="#f4f9ff" stroke-width=".8" opacity=".5"/>
    <g transform="rotate(-18 60 52)">
      <ellipse cx="60" cy="58" rx="24" ry="7" fill="#f6faff" opacity=".9"/>
      <path d="M37 58c3 4 7 4 10 0 3 4 7 4 10 0 3 4 7 4 10 0 3 4 7 4 10 0" fill="none" stroke="#c6d8f0" stroke-width="1"/>
      <ellipse cx="60" cy="40" rx="10.5" ry="13" fill="#eef5ff" opacity=".95"/>
      <path d="M50 46C52 54 56 56 60 56 64 56 68 54 70 46 66 50 63 50 60 50 57 50 54 50 50 46Z" fill="#d6e4f6"/>
      <path d="M55 39.5h3M62 39.5h3" stroke="#7d93b8" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M57 47q3 1.6 6 0" stroke="#7d93b8" stroke-width=".9" fill="none"/>
      <path d="M46 31C46 23 74 23 74 31 70 29 50 29 46 31Z" fill="#e4eefc"/><ellipse cx="60" cy="31" rx="18" ry="3.4" fill="#f2f7ff"/>
      <path d="M70 28C78 22 86 22 92 16 86 26 80 28 72 30" fill="#f8fbff" opacity=".9"/>
    </g>
  </svg>`;
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
  // a ghost glides through one wall and out through the other, bobbing gently
  const ghost = () => {
    if (!running || flyers.some((f) => f.kind === "ghost")) return;
    const el = flyer("t-ghost", GHOST);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y0 = rand(0.25, 0.6) * H, scale = W < 600 ? 0.7 : rand(0.9, 1.15);
    flyers.push({ kind: "ghost", el, t: 0, dur: rand(16, 22) * (W < 600 ? 0.6 : 1), step(f, dt) {
      f.t += dt / f.dur;
      const k = f.t;
      const x = dir > 0 ? -140 + (W + 280) * k : W + 140 - (W + 280) * k;
      const y = y0 + Math.sin(k * Math.PI * 5) * 10;
      el.style.opacity = (0.5 * Math.min(1, k / 0.12, (1 - k) / 0.12)).toFixed(2);
      place(el, x - 60, y - 80, ` scale(${(-dir * scale).toFixed(2)}, ${scale.toFixed(2)}) rotate(${(Math.sin(k * 20) * 3).toFixed(1)}deg)`);
      return k < 1;
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
  const gutter = () => {
    const all = hall ? hall.querySelectorAll(".t-candle:not(.t-gutter)") : [];
    if (!all.length) return;
    const c = pick(all);
    c.classList.add("t-gutter");
    setTimeout(() => c.classList.remove("t-gutter"), 2000);
  };
  let gustTimer = 0;
  const gust = () => {
    if (!running || root.classList.contains("t-gust")) return;
    root.classList.add("t-gust");
    document.dispatchEvent(new CustomEvent("magic:gust"));
    clearTimeout(gustTimer);
    gustTimer = setTimeout(() => root.classList.remove("t-gust"), 2900);
  };

  // how often each thing happens: [first, then between], in seconds; the hub asks for more
  const CADENCE = {
    rich: { owl: [6, 20, 40], ghost: [16, 35, 70], snitch: [10, 25, 50], star: [2, 7, 16], gutter: [3, 4, 9], patronus: [45, 150, 260], gust: [9, 16, 30] },
    light: { owl: [25, 50, 110], ghost: [60, 90, 180], snitch: [12, 45, 90], star: [5, 14, 30], gutter: [6, 8, 16], patronus: [200, 300, 500], gust: [30, 30, 60] },
  };
  const EVENTS = { owl, ghost, snitch: launchSnitch, star: shootingStar, gutter, patronus, gust };
  const schedule = (time, first) => {
    const c = CADENCE[rich() ? "rich" : "light"];
    for (const k in c) if (first || next[k] === undefined) next[k] = time + (first ? rand(c[k][0], c[k][0] * 1.6) : rand(c[k][1], c[k][2]));
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
      l.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const S = sprites();

    // dust motes rising slowly through the candlelight
    for (const m of motes) {
      m.y += m.vy * dt;
      if (m.y < -10) Object.assign(m, mote(false));
      const x = m.x + Math.sin(time * m.freq + m.phase) * m.sway;
      const tw = 0.55 + 0.45 * Math.sin(time * 1.7 + m.phase * 3);
      ctx.globalAlpha = m.a * tw;
      const s = m.r * 6;
      ctx.drawImage(S.gold, x - s / 2, m.y - s / 2, s, s);
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
      ctx.arc(r.x, r.y, 6 + k * 70, 0, Math.PI * 2);
      ctx.strokeStyle = r.color === "silver" ? "rgba(215, 230, 255, 1)" : "rgba(255, 226, 150, 1)";
      ctx.lineWidth = 1.5 * (1 - k) + 0.3;
      ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.9;
      const s = 60 * (1 - k * 0.5);
      ctx.drawImage(S[r.color] || S.white, r.x - s / 2, r.y - s / 2, s, s);
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
    ctx.globalAlpha = 1;

    // owls, letters, ghosts, Patronuses
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
      snitch = null;
      return;
    }
    burst(e.clientX, e.clientY);
  };
  const onLeave = () => { pointer.active = false; };

  // ---------- panels: an ink flourish in the corners, laid down as they come into view ----------
  const CORNER = '<svg viewBox="0 0 34 34" aria-hidden="true"><path pathLength="1" d="M1.5 27V9.5C1.5 5 5 1.5 9.5 1.5H27"/><path pathLength="1" d="M27 1.5c3.2 0 4.6 3 2.6 4.6-1.5 1.2-3.4-.2-2.6-1.6M1.5 27c0 3.2 3 4.6 4.6 2.6 1.2-1.5-.2-3.4-1.6-2.6"/><path pathLength="1" d="M6.5 16c0-5.5 4-9.5 9.5-9.5"/><path class="t-gem" d="M9.5 6.6l2.9 2.9-2.9 2.9-2.9-2.9z"/></svg>';
  const dress = (p) => {
    if (panels.has(p) || !p.isConnected) return;
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) { panels.set(p, null); return; } // a scroll box: leave it alone
    const deco = document.createElement("span");
    deco.className = "t-filigree";
    deco.setAttribute("aria-hidden", "true");
    deco.innerHTML = ["tl", "tr", "bl", "br"].map((c) => `<b class="t-corner t-${c}">${CORNER}</b>`).join("");
    const wasStatic = cs.position === "static";
    if (wasStatic) p.style.position = "relative";
    p.append(deco);
    panels.set(p, { deco, wasStatic });
    const r = p.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) {
      // In view: ink it in, unless the page is redrawing its panels long after load (no flicker then)
      const late = performance.now() - startedAt > 2500;
      requestAnimationFrame(() => p.classList.add("t-ink", ...(late ? ["t-ink-now"] : [])));
    } else { p.classList.add("t-ink-wait"); io.observe(p); }
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
      p.classList.remove("t-ink", "t-ink-wait", "t-ink-now");
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
      for (const e of entries) if (e.isIntersecting) { e.target.classList.replace("t-ink-wait", "t-ink"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    // panels drawn later by the page get dressed too (text updates and flyers are ignored)
    mo = new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && !/t-filigree|t-flyer|t-shoot/.test(n.className)) return queueScan();
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
    motes = [];
    snitch = null;
    for (const l of layers) { l.el.style.transform = ""; l.x = l.y = 0; }
    root.classList.remove("t-magic", "t-gust");
  };

  // Turning reduced motion on (or off) while the page is open
  reduce.addEventListener?.("change", () => { if (reduce.matches) stop(); else if (root.dataset.theme === "hogwarts") start(); });

  window.Magic = {
    start,
    stop,
    get running() { return running; },
    emit: (x, y, o) => running && emit(x, y, o),
    burst: (x, y, c) => running && burst(x, y, c),
    snitch: () => running && launchSnitch(),
    owl,
    ghost,
    patronus: () => running && patronus(),
    gust,
    shootingStar,
    onFrame: (fn) => { frameFns.push(fn); return () => frameFns.splice(frameFns.indexOf(fn), 1); },
  };
  if (root.dataset.theme === "hogwarts") start();
})();
