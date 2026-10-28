// Fills the Cerebro card: the Claude Code sessions running on the Mac, as Cerebro (its
// tray app) shows them, from the screen feed (/screen.json, then pushed as it changes on
// /screen/events). The card opens Cerebro's phone page. While the Mac sleeps or is away,
// or without CEREBRO_URL in .env, the feed has no "cerebro" and the card stays hidden.
(async () => {
  const card = document.getElementById("cerebro");
  if (!card) return;

  const STATUS = { waiting: ["Needs you", "down"], busy: ["Working", "up"] };
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const since = (iso) => {
    if (!iso) return "";
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    return min < 1 ? "just now" : min < 60 ? min + " min" : Math.floor(min / 60) + " h " + String(min % 60).padStart(2, "0");
  };
  const row = (s) => {
    const [label, cls] = STATUS[s.status] || ["Idle", ""];
    const where = [s.room, s.agents ? `+${s.agents} agent${s.agents > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
    const li = el("li");
    li.title = s.project || "";
    li.append(el("span", "", s.name), el("span", cls, label), el("span", "", where), el("span", "", s.status === "idle" ? "" : since(s.since)));
    return li;
  };

  const show = (d) => {
    const c = d && d.cerebro;
    card.hidden = !c;
    if (!c) return;
    if (c.link) card.href = c.link;
    const sessions = c.sessions || [];
    card.querySelector('[data-cb="list"]').replaceChildren(...(sessions.length ? sessions.map(row) : [el("li", "", "No session")]));
    card.querySelector('[data-cb="state"]').textContent = `${sessions.length} session${sessions.length === 1 ? "" : "s"}`;
    card.querySelector('[data-cb="counts"]').textContent = c.waiting
      ? `${c.waiting} waiting for you`
      : c.busy ? `${c.busy} working` : "all idle";
  };
  const read = async () => {
    try {
      const r = await fetch("/screen.json", { cache: "no-store" });
      if (r.ok) show(await r.json());
    } catch {}
  };

  // the feed pushes the document as it changes (/screen/events); without the
  // stream, ask every 10 s
  let poll = null;
  await read();
  if (!("EventSource" in window)) {
    poll = setInterval(read, 10000);
    return;
  }
  const source = new EventSource("/screen/events");
  source.onmessage = (message) => {
    if (poll) { clearInterval(poll); poll = null; }
    show(JSON.parse(message.data));
  };
  source.onerror = () => {
    if (!poll) poll = setInterval(read, 10000);
  };
})();
