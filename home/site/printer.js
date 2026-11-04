// Fills the Anycubic printer card. /printer.json comes from the optional printer
// service (through Caddy), read again every 20 s: the card shows while the printer
// is on the network, with the print going on (file, progress, layers, time left,
// preview), and hides again when the printer is switched off, when the service is
// off (404) or when it has not written for 3 minutes.
(() => {
  const card = document.getElementById("printer");
  if (!card) return;

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
  };
  const paintTime = (job) => {
    const left = job.active ? job.remaining_min : null;
    set("left", left == null ? "–" : duration(left));
    set("end", left == null ? "" : `done at ${clock(new Date(Date.now() + left * 60e3))}`);
  };
  const paintImage = (job) => {
    const img = card.querySelector('[data-pr="image"]');
    img.hidden = !job.image;
    if (job.image && img.src !== job.image) img.src = job.image;
  };

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
    set("note", noteOf(p, job));
  };

  const refresh = async () => {
    const p = await read();
    card.hidden = !shown(p);
    if (!card.hidden) paint(p);
  };
  refresh();
  setInterval(refresh, 20000);
})();
