// Hub theme kit: the moving magic of the Hogwarts look.
//
// theme.js loads this file only while the look is "hogwarts", starts it, and stops it when
// the look changes. A page that sets <html data-theme="hogwarts"> by itself (the hub) can
// load it directly: it starts on its own. It does nothing under prefers-reduced-motion or
// on a <body data-t-calm>.
//
// One canvas, fixed over the page and transparent to the mouse, draws:
//   golden dust drifting in candlelight, a wand trail of sparks behind the cursor, a Lumos
//   burst on each click, and now and then a Golden Snitch darting across (click it).
// And on the page itself (CSS in theme.css, under html.t-magic):
//   gold filigree that draws itself round each .t-panel as it comes into view, a shimmer
//   running along its gilt rule and along .t-title, twinkling .t-heading stars, and .t-bar
//   gauges that move like liquid gold.
//
// window.Magic, for pages that want more:
//   Magic.start() / Magic.stop(), Magic.running
//   Magic.emit(x, y, { n, color: "gold" | "silver" | "white", speed, life, size, spread, gravity, dir })
//   Magic.burst(x, y, color)       a Lumos burst
//   Magic.snitch()                 sends the Snitch now
//   Magic.onFrame(fn)              fn(time, dt, pointer) runs in the same animation frame loop
(() => {
  if (window.Magic) return;
  const root = document.documentElement;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const frameFns = [];
  const pointer = { x: -1, y: -1, active: false, moved: 0 };
  let canvas = null, ctx = null, raf = 0, running = false, last = 0, dpr = 1, W = 0, H = 0;
  let motes = [], sparks = [], rings = [], snitch = null, snitchAt = 0;
  let io = null, mo = null, startedAt = 0;
  const panels = new Map(); // .t-panel -> its added decoration

  const rand = (a, b) => a + Math.random() * (b - a);

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

  // ---------- the loop ----------
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    const time = now / 1000;
    const dt = Math.min(0.05, last ? time - last : 0.016);
    last = time;
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
    if (!snitch && time > snitchAt && snitchAt) launchSnitch();
    if (snitch) {
      snitch.t += dt / snitch.dur;
      if (snitch.t >= 1) { snitch = null; snitchAt = time + rand(35, 80); }
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

    for (const fn of frameFns) {
      try { fn(time, dt, pointer); } catch (e) { console.error(e); }
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
      snitchAt = last + rand(40, 90);
      return;
    }
    burst(e.clientX, e.clientY);
  };
  const onLeave = () => { pointer.active = false; };

  // ---------- panels: filigree, sheen, ink reveal ----------
  const CORNER = '<svg viewBox="0 0 34 34" aria-hidden="true"><path pathLength="1" d="M1.5 27V9.5C1.5 5 5 1.5 9.5 1.5H27"/><path pathLength="1" d="M27 1.5c3.2 0 4.6 3 2.6 4.6-1.5 1.2-3.4-.2-2.6-1.6M1.5 27c0 3.2 3 4.6 4.6 2.6 1.2-1.5-.2-3.4-1.6-2.6"/><path pathLength="1" d="M6.5 16c0-5.5 4-9.5 9.5-9.5"/><path class="t-gem" d="M9.5 6.6l2.9 2.9-2.9 2.9-2.9-2.9z"/></svg>';
  const dress = (p) => {
    if (panels.has(p) || !p.isConnected) return;
    const cs = getComputedStyle(p);
    if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) { panels.set(p, null); return; } // a scroll box: leave it alone
    const deco = document.createElement("span");
    deco.className = "t-filigree";
    deco.setAttribute("aria-hidden", "true");
    deco.innerHTML = `<i class="t-sheen" style="--t-d: ${(-Math.random() * 9).toFixed(1)}s"></i>` + ["tl", "tr", "bl", "br"].map((c) => `<b class="t-corner t-${c}">${CORNER}</b>`).join("");
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
    if (calm() || root.dataset.theme !== "hogwarts") return;
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
    // panels drawn later by the page get dressed too (text updates are ignored)
    mo = new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && n.className !== "t-filigree") return queueScan();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    startedAt = performance.now();
    scan();
    last = 0;
    snitchAt = performance.now() / 1000 + rand(7, 16);
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
    sparks = [];
    rings = [];
    motes = [];
    snitch = null;
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
    snitch: () => running && !snitch && launchSnitch(),
    onFrame: (fn) => { frameFns.push(fn); return () => frameFns.splice(frameFns.indexOf(fn), 1); },
  };
  if (root.dataset.theme === "hogwarts") start();
})();
