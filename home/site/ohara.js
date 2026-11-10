// Fills the Ohara card and shows it. Ohara (the optional manga library) serves its
// state on port 8585 of the same host (CORS open); when it does not answer, the card
// stays hidden. The list shows the downloads under way, or else the volume being read.
(async () => {
  const card = document.getElementById("ohara");
  if (!card) return;

  let s;
  try {
    const r = await fetch(`http://${location.hostname}:8585/api/status.json`, { cache: "no-store" });
    if (!r.ok) return;
    s = await r.json();
  } catch {
    return;
  }

  const el = (tag, text) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const set = (key, text) => {
    const e = card.querySelector(`[data-oh="${key}"]`);
    if (e) e.textContent = text;
  };
  const row = (...cells) => {
    const li = el("li");
    li.append(...cells);
    return li;
  };
  const bar = (pct) => {
    const b = el("span");
    b.className = "ss-bar";
    const fill = el("i");
    fill.style.width = pct + "%";
    b.append(fill);
    return b;
  };

  set("state", s.series === 1 ? "1 series" : s.series + " series");
  set("volumes", s.volumes);
  set("downloads", s.downloads.length || "none");
  const l = s.last;
  set("reading", l ? `${l.series} · ${l.label.replace("Tome", "vol.")}` : "–");

  const list = card.querySelector('[data-oh="list"]');
  list.textContent = "";
  for (const d of s.downloads) list.append(row(el("span", d.series), el("span", d.state === "error" ? "error" : "downloading"), bar(d.pct), el("span", d.pct + " %")));
  if (!s.downloads.length && l) list.append(row(el("span", l.series), el("span", l.label.replace("Tome", "Vol.")), bar(l.pages ? Math.round(((l.page + 1) / l.pages) * 100) : 0), el("span", l.pages ? `p. ${l.page + 1}/${l.pages}` : "")));
  if (!s.series && !s.downloads.length) {
    const hint = el("span", "Search a manga in Ohara to start the shelf.");
    hint.style.gridColumn = "1 / -1";
    hint.style.textAlign = "left";
    list.append(row(hint));
  }
  card.hidden = false;
})();
