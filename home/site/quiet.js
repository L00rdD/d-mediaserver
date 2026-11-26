// Fills the turtle card: whether Transmission is slowed down (its turtle mode), why,
// and three buttons to pick the mode. The quiet service answers /quiet (through Caddy):
// GET the state, POST {"mode": "auto"|"on"|"off"}. "On" or "off" holds until "auto"
// is picked again, which hands it back to quiet at once. When the service does not
// answer, the card stays hidden.
(async () => {
  const card = document.getElementById("quiet");
  if (!card) return;

  const ask = async (options) => {
    const r = await fetch("/quiet", { cache: "no-store", ...options });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };

  // why the turtle mode is as it is: picked by hand, or the consoles, what Jellyfin
  // plays, the others' use
  const why = (s) => {
    if (s.mode === "on") return "Kept on by hand until Auto";
    if (s.mode === "off") return "Kept at full speed by hand until Auto";
    if (s.hand) return "Turned on in Transmission";
    if (!s.turtle) return "Nobody uses the network";
    const names = (s.consoles || []).map((c) => c.name).concat(s.playing || []);
    if (s.others_mbps) names.push(`${s.others_mbps} Mb/s used by the others`);
    return names.join(", ") || "The network was used a moment ago";
  };

  const buttons = card.querySelectorAll("[data-qt-mode]");
  let status;
  const paint = () => {
    const mode = status.mode || "auto";
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.qtMode === mode));
    card.classList.toggle("on", Boolean(status.turtle));
    card.querySelector('[data-qt="state"]').textContent = status.turtle ? "Downloads slowed down" : "Full speed";
    card.querySelector('[data-qt="why"]').textContent = why(status);
  };

  try {
    status = await ask();
  } catch {
    return;
  }
  for (const b of buttons) {
    b.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        status = await ask({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: b.dataset.qtMode }),
        });
      } catch {}
      paint();
    });
  }
  // quiet looks every 20 s: so does the card
  setInterval(async () => {
    try {
      status = await ask();
      paint();
    } catch {}
  }, 20000);
  paint();
  card.hidden = false;
})();
