// Fills the Anycubic printer card, and the full view of printer.html (same fields,
// marked data-page). /printer.json comes from the optional printer service (through
// Caddy), read again every 20 s: the card shows while the printer is on the
// network, with the print going on (file, progress, layers, time left, resin), the
// printer in 3D (printer-scene.js, loaded once the card shows) and the slicer's
// picture of the part, dimmed where it is still to print. It hides again when the printer is switched off,
// when the service is off (404) or when it has not written for 3 minutes; the full
// view stays and says the printer is off.
(() => {
  const card = document.getElementById("printer");
  if (!card) return;
  const page = "page" in card.dataset;

  const STATES = {
    printing: "Printing", done: "Done", cancelled: "Cancelled", downloading: "Receiving the file",
    checking: "Checking", preheating: "Preheating", levelling: "Levelling", slicing: "Slicing",
  };
  const CLOUD = {
    "no token": "Set ANYCUBIC_TOKEN to follow the print",
    "token rejected": "Anycubic token expired: set a new one",
    unreachable: "Anycubic cloud unreachable",
    "no printer on the account": "No printer on the Anycubic account",
  };

  const set = (key, text) => {
    const e = card.querySelector(`[data-pr="${key}"]`);
    if (e) e.textContent = text;
  };
  const clock = (date) => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const duration = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m` : `${Math.round(min)}m`);

  const read = async () => {
    try {
      const r = await fetch("/printer.json", { cache: "no-store" });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const shown = (p) => p && p.online && Date.now() - new Date(p.checked_at) < 180e3;

  // the cloud's progress, else the share of layers done
  const percent = (job) => job.progress ?? (job.layers ? (100 * job.layer) / job.layers : null);
  const paintProgress = (job) => {
    const pct = percent(job);
    set("pct", pct == null ? "–" : `${Math.round(pct)}%`);
    set("layers", job.layers ? `layer ${job.layer ?? "?"} / ${job.layers}` : "");
    card.querySelector('[data-pr="fill"]').style.width = `${pct ?? 0}%`;
    card.querySelector('[data-pr="ghost"]').style.height = `${100 - (pct ?? 0)}%`;
  };
  const paintTime = (job) => {
    const left = job.active ? job.remaining_min : null;
    set("left", left == null ? "–" : duration(left));
    set("end", left == null ? "" : `done at ${clock(new Date(Date.now() + left * 60e3))}`);
  };
  // the slicer's picture, the part still to print dimmed from the top: once the 3D
  // view has loaded it, without its background and cropped to the part
  let cropped = { for: null, url: null };
  const pictureOf = (job) => (job.preview && cropped.for === job.preview ? cropped.url : job.preview || job.image);
  const paintImage = (job) => {
    const img = card.querySelector('[data-pr="image"]');
    const src = pictureOf(job);
    img.hidden = !src;
    if (src && !img.src.endsWith(src)) img.src = src;
  };
  const onPicture = (from, url) => {
    cropped = { for: from, url };
    card.querySelector('[data-pr="image"]').src = url;
  };

  // The 3D view, loaded the first time the card shows. A drag on it turns the
  // printer and must not open the card's link
  let scene = null, loading = null;
  const view = card.querySelector('[data-pr="view"]');
  const mount = () => {
    loading = import("/printer-scene.js")
      .then((m) => m.mountPrinter(view, { accent: card.dataset.accent, distance: page ? 980 : 560, onPicture }))
      .then((s) => { scene = s; view.hidden = false; })
      .catch(() => {});
    return loading;
  };
  card.addEventListener("click", (e) => scene && scene.dragged() && e.preventDefault());

  // "Printing" while a job runs, else "Ready", with how the last print ended
  const stateOf = (job) => {
    const word = STATES[job.state] || job.state;
    if (job.active) return word;
    return word ? `Ready · last print ${word.toLowerCase()}` : "Ready";
  };
  const noteOf = (p, job) => CLOUD[p.cloud] || (job.started_at ? `started ${clock(new Date(job.started_at))}` : "");

  const paint = (p) => {
    const job = p.job || {};
    set("name", p.name || "Anycubic");
    set("state", stateOf(job));
    set("file", job.name || "–");
    paintProgress(job);
    paintTime(job);
    paintImage(job);
    set("resin", job.resin_ml ? `${Math.round(job.resin_ml)} ml of resin` : "");
    set("note", noteOf(p, job));
  };

  const refresh = async () => {
    const p = await read();
    const on = shown(p);
    card.hidden = !on && !page;
    card.classList.toggle("off", !on);
    if (!on) return set("state", "Switched off");
    if (view && !loading && window.WebGLRenderingContext) await mount();
    paint(p);
    if (scene) scene.update(p);
  };
  refresh();
  setInterval(refresh, 20000);
})();
