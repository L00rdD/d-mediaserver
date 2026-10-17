// Fills the list behind "Online": every container of the machine, its state and
// its published ports as links. /services.json comes from the services container
// (through Caddy) and is read again each time the list is opened. Without it the
// list stays empty and hidden, and the badge is a plain "Online".
(() => {
  const box = document.getElementById("services");
  if (!box) return;
  const list = box.querySelector('[data-sv="list"]');
  const count = box.querySelector('[data-sv="count"]');

  // "0.0.0.0:8096->8096/tcp, [::]:8096->8096/tcp, 51413/udp" -> [8096]
  // Only TCP ports published on the host: those are the ones a browser can open.
  const ports = (s) => {
    const out = new Set();
    for (const m of (s || "").matchAll(/:(\d+)(?:-(\d+))?->\d+(?:-\d+)?\/tcp/g)) {
      const from = +m[1], to = +(m[2] || m[1]);
      for (let p = from; p <= to && p - from < 10; p++) out.add(p);
    }
    return [...out].sort((a, b) => a - b);
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const load = async () => {
    let all;
    try {
      const r = await fetch("/services.json", { cache: "no-store" });
      if (!r.ok) return;
      all = await r.json();
    } catch {
      return;
    }
    all.sort((a, b) => (a.state === "running") - (b.state === "running") || a.name.localeCompare(b.name));
    const up = all.filter((c) => c.state === "running").length;
    count.textContent = `${up}/${all.length}`;
    box.classList.toggle("degraded", up < all.length);

    list.replaceChildren(
      ...all.map((c) => {
        const row = el("li", c.state === "running" ? "up" : "down");
        row.append(el("span", "sv-name", c.name), el("span", "sv-state", c.status));
        const links = el("span", "sv-ports");
        for (const p of ports(c.ports)) {
          const a = el("a", null, ":" + p);
          a.href = `http://${location.hostname}:${p}`;
          a.target = "_blank";
          a.rel = "noopener";
          links.append(a);
        }
        row.append(links);
        return row;
      })
    );
  };

  load();
  box.addEventListener("toggle", () => box.open && load());
  // Closes on a click outside or on Escape, like a menu
  document.addEventListener("click", (e) => box.open && !box.contains(e.target) && (box.open = false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && (box.open = false));
})();
