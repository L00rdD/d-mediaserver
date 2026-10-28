// Fills the Cerebro card: the Claude Code sessions running on the Mac, drawn as Cerebro
// (its tray app) draws them, its X-Mansion rooms and X-Men, inside the card of the look.
// The sessions come from the screen feed (/screen.json, then pushed as it changes on
// /screen/events), the drawing from Cerebro's own scene engine (cerebro-scene.js, built
// from its source by home/cerebro/build.sh), its pictures from /cerebro/ (home/Caddyfile).
// The card opens Cerebro's phone page. While the Mac sleeps or is away, or without
// CEREBRO_URL in .env, the feed has no "cerebro" and the card stays hidden.
(async () => {
  const card = document.getElementById("cerebro");
  if (!card) return;
  const scene = await new Promise((resolve) => {
    if (window.CerebroScene) return resolve(window.CerebroScene);
    const script = document.createElement("script");
    script.src = "/cerebro-scene.js";
    script.onload = () => resolve(window.CerebroScene);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  if (!scene) return;
  const { drawScene, onFrame, setAnimating, STATUS_LABELS, humanizeDuration } = scene;

  // Cerebro's session card, as its phone page shows it (SessionCard.svelte, styles.css)
  const style = document.createElement("style");
  style.textContent = `
    .cb-cards { --card: #1f1f26; --card-border: rgba(255, 255, 255, 0.08); --text: #ececf1; --muted: #9a9aa8;
      --busy: #3fd07f; --idle: #8e8e99; --waiting: #ffd23f; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 12px 0 0; }
    .cb-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; color: var(--text); font: 14px var(--mono);
      text-align: left; text-transform: none; letter-spacing: normal; font-style: normal;
      background: var(--card); border: 1px solid var(--card-border); border-radius: 12px; }
    .cb-card.busy { border-color: color-mix(in srgb, var(--busy) 70%, transparent); }
    .cb-card.waiting { border-color: color-mix(in srgb, var(--waiting) 70%, transparent); }
    .cb-title { display: flex; align-items: center; gap: 6px; font-size: 15px; overflow: hidden; }
    .cb-title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cb-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--idle); flex-shrink: 0; }
    .busy .cb-dot { background: var(--busy); }
    .waiting .cb-dot { background: var(--waiting); }
    .cb-card canvas { display: block; width: 100%; height: auto; border-radius: 5px; image-rendering: pixelated; }
    .cb-cast { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cb-muted { color: var(--muted); font-weight: 400; }
    .cb-meta { display: flex; justify-content: space-between; gap: 4px; font-size: 12px; color: var(--muted); }
    .cb-cwd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;
  document.head.append(style);

  const list = card.querySelector('[data-cb="list"]');
  const SCALE = 2;
  // Cerebro's pictures, loaded once; null until there (and after a failure)
  const pictures = new Map();
  const picture = (src) => {
    if (!pictures.has(src)) {
      pictures.set(src, null);
      const img = new Image();
      img.src = src;
      img.decode().then(() => pictures.set(src, img), () => setTimeout(() => pictures.delete(src), 30000));
    }
    return pictures.get(src);
  };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // one card per session, kept across pushes so its animation runs on
  const shown = new Map();
  let doc = null;
  const build = (s) => {
    const root = el("div", "cb-card");
    const title = el("div", "cb-title");
    const name = el("strong");
    title.append(el("i", "cb-dot"), name);
    const canvas = document.createElement("canvas");
    const cast = el("div", "cb-cast");
    const meta = el("div", "cb-meta");
    const cwd = el("span", "cb-cwd");
    const status = el("span");
    meta.append(cwd, status);
    root.append(title, canvas, cast, meta);
    return { root, name, canvas, cast, cwd, status, session: s, stop: null };
  };
  const fill = (entry, s, room) => {
    entry.session = s;
    entry.root.className = `cb-card ${s.status}`;
    entry.name.textContent = s.name;
    const names = (s.scene?.actors || []).map((a) => a.name);
    entry.cast.replaceChildren(el("span", "cb-muted", `${s.room || ""} —`), ` ${names.join(" · ")}`);
    entry.cwd.textContent = s.project || "";
    entry.root.title = s.project || "";
    if (entry.stop) return;
    const [width, height] = room;
    const dpr = window.devicePixelRatio || 1;
    entry.canvas.width = width * SCALE * dpr;
    entry.canvas.height = height * SCALE * dpr;
    const ctx = entry.canvas.getContext("2d");
    ctx.setTransform(SCALE * dpr, 0, 0, SCALE * dpr, 0, 0);
    // Cerebro draws the room ten times a second, from the session as last pushed
    entry.stop = onFrame((seconds) => {
      const now = entry.session.scene;
      const image = now && picture(now.room.sprite);
      const emotes = picture(doc.emotes || "/cerebro/ui/emotes.png");
      if (!image || !emotes) return;
      const [cw, ch] = doc.character_size || [24, 24];
      const characters = new Map();
      for (const a of now.actors) {
        const sprite = picture(a.sprite);
        if (sprite) characters.set(a.id, { id: a.id, name: a.name, aura: a.aura || undefined, move: a.move, power: a.power, powerColor: a.color, image: sprite });
      }
      const catalog = { characterSize: { width: cw, height: ch }, roomSize: { width, height }, characters, rooms: new Map(), emotes };
      const r = now.room;
      const actors = now.actors.filter((a) => characters.has(a.id)).map((a) => ({ id: a.id, character: a.id, state: a.state }));
      drawScene(ctx, catalog, { frames: r.frames, fps: r.fps, walkArea: r.walk, image }, actors, seconds);
    });
  };
  const since = () => {
    for (const entry of shown.values()) {
      const s = entry.session;
      const ms = s.since ? Date.now() - new Date(s.since) : 0;
      entry.status.textContent = `${STATUS_LABELS[s.status] ?? s.status} ${humanizeDuration(ms)}`;
    }
  };
  setInterval(since, 1000);

  const show = (d) => {
    const c = d && d.cerebro;
    card.hidden = !c;
    if (!c) return;
    doc = c;
    if (c.link) card.href = c.link;
    const sessions = c.sessions || [];
    const ids = new Set(sessions.map((s) => s.id));
    for (const [id, entry] of shown) {
      if (!ids.has(id)) { entry.stop?.(); entry.root.remove(); shown.delete(id); }
    }
    for (const s of sessions) {
      let entry = shown.get(s.id);
      if (!entry) { entry = build(s); shown.set(s.id, entry); }
      fill(entry, s, c.room_size || [192, 120]);
    }
    list.replaceChildren(...sessions.map((s) => shown.get(s.id).root));
    if (!sessions.length) list.replaceChildren(el("p", "", "No session"));
    since();
    card.querySelector('[data-cb="state"]').textContent = `${sessions.length} session${sessions.length === 1 ? "" : "s"}`;
    card.querySelector('[data-cb="counts"]').textContent = c.waiting
      ? `${c.waiting} waiting for you`
      : c.busy ? `${c.busy} working` : "all idle";
  };
  document.addEventListener("visibilitychange", () => setAnimating(!document.hidden));

  const read = async () => {
    try {
      const r = await fetch("/screen.json", { cache: "no-store" });
      if (r.ok) show(await r.json());
    } catch {}
  };
  // the feed pushes the document as it changes (/screen/events); without the
  // stream, ask every 10 s
  let poll = null;
  await read();
  if (!("EventSource" in window)) {
    poll = setInterval(read, 10000);
    return;
  }
  const source = new EventSource("/screen/events");
  source.onmessage = (message) => {
    if (poll) { clearInterval(poll); poll = null; }
    show(JSON.parse(message.data));
  };
  source.onerror = () => {
    if (!poll) poll = setInterval(read, 10000);
  };
})();
