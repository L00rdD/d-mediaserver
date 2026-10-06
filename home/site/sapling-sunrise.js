// Fills the Sapling Sunrise card and shows it. The tracker serves its own dashboard and
// state on port 8081 of the same host (CORS open); when it does not answer, the card
// stays hidden.
(async () => {
  const card = document.getElementById("sapling-sunrise");
  if (!card) return;

  let s;
  try {
    const r = await fetch(`http://${location.hostname}:8081/api/status.json`, { cache: "no-store" });
    if (!r.ok) return;
    s = await r.json();
  } catch {
    return;
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const set = (key, text) => {
    const e = card.querySelector(`[data-ss="${key}"]`);
    if (e) e.textContent = text;
  };

  const list = card.querySelector('[data-ss="list"]');
  list.textContent = "";
  for (const p of s.plants) {
    const running = p.state === "running";
    const label = p.state === "not_started" ? "Not started" : p.state === "done" ? "Complete" : p.phase;
    const row = el("li");
    const bar = el("span", "ss-bar");
    const fill = el("i");
    fill.style.width = Math.round(p.progress * 100) + "%";
    bar.append(fill);
    row.append(
      el("span", "", p.count > 1 ? `${p.name} ×${p.count}` : p.name),
      el("span", "", label),
      bar,
      el("span", "", running ? p.days_left + " d left" : "")
    );
    list.append(row);
  }

  const active = s.plants.filter((p) => p.state === "running").length;
  set("state", `${active} of ${s.plants.length} growing`);
  const min = Math.round((Date.now() - new Date(s.updated_at)) / 60000);
  set("updated", "updated " + (min < 1 ? "just now" : min < 60 ? min + " min ago" : Math.round(min / 60) + " h ago"));
  card.hidden = false;
})();
