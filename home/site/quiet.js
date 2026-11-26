// Fills the turtle card: whether Transmission is slowed down (its turtle mode), why,
// and a switch to set it by hand. The quiet service answers /quiet (through Caddy):
// GET the state, POST {"turtle": true|false}. Switched on, it stays on until switched
// off; switched off while someone uses the network, it stays off until the network is
// calm, then quiet watches again. When the service does not answer, the card stays hidden.
(async () => {
  const card = document.getElementById("quiet");
  if (!card) return;

  const ask = async (options) => {
    const r = await fetch("/quiet", { cache: "no-store", ...options });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };

  // why the turtle mode is on: the consoles, what Jellyfin plays, the others' use
  const why = (s) => {
    if (s.hand) return s.turtle ? "Switched on by hand" : "Switched off by hand until the network is calm";
    if (!s.turtle) return "Nobody uses the network";
    const names = (s.consoles || []).map((c) => c.name).concat(s.playing || []);
    if (s.others_mbps) names.push(`${s.others_mbps} Mb/s used by the others`);
    return names.join(", ") || "The network was used a moment ago";
  };

  const sw = card.querySelector('[data-qt="switch"]');
  let status;
  const paint = () => {
    sw.checked = Boolean(status.turtle);
    sw.disabled = false;
    card.classList.toggle("on", Boolean(status.turtle));
    card.querySelector('[data-qt="state"]').textContent = status.turtle ? "Downloads slowed down" : "Full speed";
    card.querySelector('[data-qt="why"]').textContent = why(status);
  };

  try {
    status = await ask();
  } catch {
    return;
  }
  sw.addEventListener("change", async () => {
    sw.disabled = true;
    try {
      status = await ask({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turtle: sw.checked }),
      });
    } catch {}
    paint();
  });
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
