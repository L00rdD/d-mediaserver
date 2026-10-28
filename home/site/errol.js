// Fills the Errol card: what the living-room screen shows now, and the remote
// control of the screens (their look, or "follow this page"). The settings live
// in the screen service (/screen/settings, through Caddy); Errol and Pensieve,
// the projector's home screen, apply them within a few seconds. When the
// service does not answer, the card stays hidden.
(async () => {
  const card = document.getElementById("errol");
  if (!card) return;

  const LOOK_OF_PAGE = { reactor: "friday", cyberpunk: "cyberpunk", hogwarts: "hogwarts" };
  const pageLook = LOOK_OF_PAGE[document.documentElement.dataset.theme] || "friday";
  const LABELS = { light: "Lamp", cover: "Projection screen", projector: "Projector", download: "Download", import: "New in the library", scan: "One Piece" };

  const get = async (url) => {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };
  const save = async (changes) => {
    const r = await fetch("/screen/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  };

  let settings;
  try {
    settings = await get("/screen/settings");
  } catch {
    return;
  }
  // "follow this page": opening the home page in a look sets the screen to it
  if (settings.follow_hub && settings.look !== pageLook) {
    try {
      settings = await save({ look: pageLook });
    } catch {}
  }

  const buttons = card.querySelectorAll("[data-errol-look]");
  const follow = card.querySelector('[data-errol="follow"]');
  const paint = () => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.errolLook === settings.look));
    follow.checked = settings.follow_hub;
  };
  for (const b of buttons) {
    b.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        settings = await save({ look: b.dataset.errolLook, follow_hub: false });
      } catch {}
      paint();
    });
  }
  follow.addEventListener("change", async () => {
    try {
      settings = await save(follow.checked ? { follow_hub: true, look: pageLook } : { follow_hub: false });
    } catch {}
    paint();
  });
  paint();

  // what the screen shows now, from the feed it reads
  const now = card.querySelector('[data-errol="now"]');
  const show = async () => {
    try {
      const d = await get("/screen.json");
      const playing = (d.playing || [])[0];
      const last = (d.events || []).filter((e) => e.kind !== "play").at(-1);
      const fresh = last && Date.now() - new Date(last.at) < 120000;
      if (playing) now.textContent = `Cinema · ${playing.series || playing.title}`;
      else if (fresh) now.textContent = `${LABELS[last.kind] || last.kind} · ${last.name || last.title || last.scan || ""}`;
      else now.textContent = "Idle · clock and cards";
    } catch {
      now.textContent = "–";
    }
  };
  show();
  setInterval(show, 10000);
  card.hidden = false;
})();
