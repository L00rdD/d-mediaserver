// Fills the Bifrost card and shows it. Bifrost (MQTT broker, Homebridge, 433 MHz bridge)
// serves its state on port 8582 of the same host (CORS open); when it does not answer,
// the card stays hidden.
(async () => {
  const card = document.getElementById("bifrost");
  if (!card) return;

  let s;
  try {
    const r = await fetch(`http://${location.hostname}:8582/api/status.json`, { cache: "no-store" });
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
  const ago = (iso) => {
    if (!iso) return "";
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    return min < 1 ? "just now" : min < 60 ? min + " min ago" : min < 1440 ? Math.round(min / 60) + " h ago" : Math.round(min / 1440) + " d ago";
  };
  const row = (name, up, state, detail) => {
    const li = el("li");
    li.append(el("span", "", name), el("span", up ? "up" : "down", state), el("span", "", detail || ""), el("span", "", ""));
    return li;
  };

  const rows = [
    row("MQTT broker", s.broker, s.broker ? "Online" : "Down", ":1883"),
    row("Homebridge", s.homebridge, s.homebridge ? "Online" : "Down", ":8581"),
    row("RF bridge", s.bridge.online, s.bridge.online ? "Online" : "Offline", s.bridge.last_seen ? "seen " + ago(s.bridge.last_seen) : "never seen"),
  ];
  for (const o of s.outlets) {
    rows.push(row(o.name, o.on !== false, o.on === null ? "Unknown" : o.on ? "On" : "Off", ago(o.at)));
  }
  card.querySelector('[data-bf="list"]').replaceChildren(...rows);

  const up = [s.broker, s.homebridge, s.bridge.online].filter(Boolean).length;
  card.querySelector('[data-bf="state"]').textContent = `${up}/3 online`;
  card.querySelector('[data-bf="last"]').textContent = s.last_code
    ? `last code ${s.last_code.code} (${s.last_code.via}) ${ago(s.last_code.at)}`
    : "no RF code yet";
  card.hidden = false;
})();
