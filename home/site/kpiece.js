// Fills the One Piece card and shows it. /kpiece.json comes from the optional kpiece
// service (through Caddy); when it does not answer, or has not been refreshed for a
// day (service switched off), the card stays hidden. The countdown ticks every second.
(async () => {
  const card = document.getElementById("kpiece");
  if (!card) return;

  let k;
  try {
    const r = await fetch("/kpiece.json", { cache: "no-store" });
    if (!r.ok) return;
    k = await r.json();
  } catch {
    return;
  }
  if (!k.latest || Date.now() - new Date(k.checked_at) > 864e5) return;

  const set = (key, text) => {
    const e = card.querySelector(`[data-kp="${key}"]`);
    if (e) e.textContent = text;
  };
  const day = (iso, opts) => new Date(iso).toLocaleDateString(undefined, opts);

  const l = k.latest;
  card.href = l.url;
  set("arc", `Arc ${l.arc}`);
  set("scan", l.scan);
  set("name", l.name);
  set("date", /^\d{4}-/.test(l.date) ? `out ${day(l.date + "T12:00", { day: "numeric", month: "long" })}` : l.date);
  set("pages", l.pages ? `${l.pages} pages` : "");

  const pad = (n) => String(n).padStart(2, "0");
  const at = k.next && new Date(k.next.at);
  if (at) {
    set("next", k.next.scan);
    set("when", day(at, { weekday: "long", day: "numeric", month: "long" }) + " " + at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
  }
  const tick = () => {
    if (!at) return set("timer", "date not announced");
    const s = Math.floor((at - Date.now()) / 1000);
    if (s <= 0) return set("timer", "any minute now");
    set("timer", `${Math.floor(s / 86400)}d ${pad(Math.floor(s / 3600) % 24)}h ${pad(Math.floor(s / 60) % 60)}m ${pad(s % 60)}s`);
  };
  tick();
  setInterval(tick, 1000);
  card.hidden = false;
})();
