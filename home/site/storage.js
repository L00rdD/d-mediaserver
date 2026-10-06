// Fills the storage bar and shows it. /disk.json comes from the storage service
// (through Caddy); when it does not answer, the card stays hidden.
(async () => {
  const card = document.getElementById("storage");
  if (!card) return;

  let d;
  try {
    const r = await fetch("/disk.json", { cache: "no-store" });
    if (!r.ok) return;
    d = await r.json();
  } catch {
    return;
  }
  if (!d.total) return;

  const size = (b) => (b >= 1e12 ? (b / 1e12).toFixed(2) + " TB" : Math.round(b / 1e9) + " GB");
  const pct = Math.round((d.used / d.total) * 100);
  const set = (key, text) => {
    const e = card.querySelector(`[data-st="${key}"]`);
    if (e) e.textContent = text;
  };
  set("used", `${size(d.used)} used of ${size(d.total)}`);
  set("free", `${size(d.free)} free`);
  set("pct", pct + " %");
  const fill = card.querySelector('[data-st="fill"]');
  fill.style.width = pct + "%";
  if (pct >= 90) fill.classList.add("full");
  card.hidden = false;
})();
