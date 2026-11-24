// Fills the Kirby card and shows it. Kirby (the optional video games library) serves
// its state on port 8587 of the same host (CORS open); when it does not answer, the
// card stays hidden. The list shows the downloads under way, or else the latest games.
(async () => {
  const card = document.getElementById("kirby");
  if (!card) return;

  let s;
  try {
    const r = await fetch(`http://${location.hostname}:8587/api/status.json`, { cache: "no-store" });
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
    const e = card.querySelector(`[data-kb="${key}"]`);
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
  const gb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

  set("state", s.games === 1 ? "1 game" : s.games + " games");
  set("games", s.games);
  set("size", gb(s.size));
  set("downloads", s.downloads.length || "none");

  const list = card.querySelector('[data-kb="list"]');
  list.textContent = "";
  for (const d of s.downloads) list.append(row(el("span", d.name), el("span", d.state === "error" ? "error" : "downloading"), bar(d.pct), el("span", d.pct + " %")));
  if (!s.downloads.length) for (const g of s.recent) list.append(row(el("span", g.name), el("span", g.console || "ready"), el("span"), el("span", gb(g.size))));
  if (!s.games && !s.downloads.length) {
    const hint = el("span", "Search a game in Kirby's catalogue to start the library.");
    hint.style.gridColumn = "1 / -1";
    hint.style.textAlign = "left";
    list.append(row(hint));
  }
  card.hidden = false;
})();
