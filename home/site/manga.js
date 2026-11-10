// Fills the Manga card and shows it. Suwayomi (the optional manga service) answers
// its GraphQL API on port 4567 of the same host (CORS open); when it does not
// answer, the card stays hidden. The list holds the last chapters downloaded.
(async () => {
  const card = document.getElementById("manga");
  if (!card) return;

  const query = `{
    mangas(condition: { inLibrary: true }) { totalCount nodes { unreadCount downloadCount } }
    chapters(condition: { isDownloaded: true }, order: [{ by: FETCHED_AT, byType: DESC }], first: 3) {
      nodes { name fetchedAt manga { title } }
    }
    downloadStatus { queue { progress } }
  }`;
  let d;
  try {
    const r = await fetch(`http://${location.hostname}:4567/api/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) return;
    d = (await r.json()).data;
  } catch {
    return;
  }
  if (!d) return;

  const el = (tag, text) => {
    const e = document.createElement(tag);
    e.textContent = text;
    return e;
  };
  const set = (key, text) => {
    const e = card.querySelector(`[data-mg="${key}"]`);
    if (e) e.textContent = text;
  };
  const sum = (key) => d.mangas.nodes.reduce((n, m) => n + m[key], 0);
  const ago = (seconds) => {
    const min = Math.round((Date.now() - Number(seconds) * 1000) / 60000);
    return min < 60 ? min + " min ago" : min < 1440 ? Math.round(min / 60) + " h ago" : Math.round(min / 1440) + " d ago";
  };

  const series = d.mangas.totalCount;
  const queue = d.downloadStatus.queue.length;
  set("state", series === 1 ? "1 series" : series + " series");
  set("unread", sum("unreadCount"));
  set("saved", sum("downloadCount"));
  set("queue", queue ? `${queue} chapter${queue > 1 ? "s" : ""}` : "idle");

  const list = card.querySelector('[data-mg="list"]');
  list.textContent = "";
  for (const c of d.chapters.nodes) {
    const row = el("li", "");
    row.append(el("span", c.manga.title), el("span", c.name), el("span", ""), el("span", ago(c.fetchedAt)));
    list.append(row);
  }
  if (!series) list.append(el("li", "Add a series in Suwayomi to follow its chapters."));
  card.hidden = false;
})();
