// Ohara's library page: what you are reading, the downloads under way, the shelf,
// a series and its volumes, and the search, one result per series.
const Ohara = (() => {
  // ---- words (tested in node) ----
  const LANGS = { FR: "en français", EN: "en anglais", JP: "en japonais", "?": "langue inconnue" };

  const size = (bytes) => (bytes >= 1e9 ? (bytes / 1e9).toFixed(1).replace(".", ",") + " Go" : Math.max(1, Math.round(bytes / 1e6)) + " Mo");

  function tomes(range) {
    if (!range) return "Tomes non précisés";
    return range[0] === range[1] ? `Tome ${range[0]}` : `Tomes ${range[0]} à ${range[1]}`;
  }

  // "Tomes 1 à 14 en français, 3,6 Go, téléchargement rapide"
  const describe = (r) => `${LANGS[r.lang]}, ${size(r.size)}, téléchargement ${r.speed}`;

  function readingState(v) {
    if (!v.readable) return "S'ouvre dans le navigateur";
    if (v.done) return "Lu";
    if (v.pages) return `Page ${v.page + 1} sur ${v.pages}`;
    return v.new ? "Nouveau" : "Pas commencé";
  }

  function eta(seconds) {
    if (!(seconds > 0)) return "";
    const min = Math.ceil(seconds / 60);
    return min < 60 ? `encore ${min} min` : `encore ${Math.round(min / 60)} h`;
  }

  function seriesFacts(s, meta) {
    const facts = [];
    if (meta.status) facts.push(meta.status);
    if (meta.volumes) facts.push(`${meta.volumes} tomes parus`);
    if (s) facts.push(`${s.volumes.length} chez toi`);
    return facts;
  }

  const openUrl = (v) => (v.readable ? "/read?vol=" : "/api/file?vol=") + encodeURIComponent(v.id);
  const coverUrl = (vid) => "/api/cover?vol=" + encodeURIComponent(vid);
  const seriesCover = (s) => s.meta.cover || coverUrl(s.volumes[0].id);
  const tint = (meta) => (meta && meta.color) || "#3b5a4f";

  // how far into a volume, in % of its pages
  const percent = (v) => (v.pages ? Math.round(((v.page + 1) / v.pages) * 100) : 0);

  function downloadState(d) {
    if (d.state === "error") return "Bloqué : " + d.error;
    if (d.state === "done") return "Rangement dans la bibliothèque";
    return [`${d.pct} %`, eta(d.eta)].filter(Boolean).join(", ");
  }

  // the classes and bits of a volume's tile
  const tileLook = (v) => ({
    tile: v.done ? "volume done" : "volume",
    line: v.new ? "line new" : "line",
    bar: Boolean(v.pages) && !v.done,
    format: v.file.split(".").pop().toUpperCase(),
  });

  const readLabel = (v) => `${v.pages ? "Reprendre" : "Lire"} le ${v.label.toLowerCase()}`;

  // the series named by a "#serie/<name>" address, or null
  const seriesInHash = (hash) => (hash.startsWith("#serie/") ? decodeURIComponent(hash.slice(7)) : null);

  // where a tile goes in a series: by its tome number, the unnumbered last
  function tomeOrder(label) {
    const m = label.match(/(\d+(?:\.\d+)?)/);
    return m ? +m[1] : 1e9;
  }

  const helpers = { size, tomes, describe, readingState, eta, seriesFacts, openUrl, tint, percent, downloadState, tileLook, readLabel, seriesInHash, tomeOrder };
  if (typeof document === "undefined") return helpers;

  // ---- the page ----
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function img(src, cls) {
    const i = el("img", cls);
    i.src = src;
    i.alt = "";
    i.loading = "lazy";
    return i;
  }
  function button(text, cls, onclick) {
    const b = el("button", "button " + (cls || ""), text);
    b.type = "button";
    b.onclick = onclick;
    return b;
  }
  function bar(pct) {
    const b = el("span", "bar");
    b.append(el("i"));
    b.firstChild.style.width = pct + "%";
    return b;
  }
  const facts = (list) => {
    const p = el("p", "facts");
    p.append(...list.map((f) => el("span", "", f)));
    return p;
  };

  const api = async (path, body) => {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "le serveur ne répond pas");
    return data;
  };

  let lib = { series: [], downloads: [], last: null };
  const byName = (name) => lib.series.find((s) => s.name === name);

  // ---- what you are reading ----
  function renderResume() {
    const v = lib.last;
    const box = $("resume");
    box.hidden = !v || !!location.hash;
    if (box.hidden) return;
    box.style.setProperty("--tint", tint(v.meta));
    const read = el("a", "button primary", v.done ? "Relire" : "Continuer la lecture");
    read.href = openUrl(v);
    const text = el("div", "resume-text");
    text.append(el("p", "kicker", "Reprendre"), el("h2", "", v.series), el("p", "where", `${v.label}, ${readingState(v).toLowerCase()}`), bar(percent(v)), read);
    const cover = el("a", "resume-cover");
    cover.href = openUrl(v);
    cover.append(img(coverUrl(v.id)));
    box.replaceChildren(cover, text);
  }

  // ---- downloads ----
  function downloadRow(d) {
    const s = byName(d.series);
    const li = el("li");
    const src = d.cover || (s && seriesCover(s));
    const pic = src ? img(src, "thumb") : el("span", "thumb");
    const text = el("div");
    text.append(el("b", "", d.series), el("span", "", d.range ? tomes(d.range) : ""), bar(d.pct), el("small", d.state, downloadState(d)));
    const stop = button("Annuler", "quiet", async () => {
      stop.disabled = true;
      await api("/api/cancel", { hash: d.hash });
      load();
    });
    li.append(pic, text, stop);
    return li;
  }

  function renderDownloads() {
    $("downloads").hidden = !lib.downloads.length || location.hash.startsWith("#serie/");
    $("download-list").replaceChildren(...lib.downloads.map(downloadRow));
  }

  // ---- the shelf ----
  function book(s) {
    const a = el("a", "book");
    a.href = "#serie/" + encodeURIComponent(s.name);
    const cover = el("span", "cover");
    cover.append(img(seriesCover(s)));
    if (s.new) cover.append(el("span", "ribbon", s.new > 1 ? `${s.new} nouveaux` : "Nouveau"));
    cover.append(bar(Math.round((s.read / s.volumes.length) * 100)));
    const line = el("span", "line", s.volumes.length > 1 ? `${s.volumes.length} tomes` : "1 tome");
    if (s.follow) line.append(el("span", "followed", "suivi"));
    a.append(cover, el("span", "title", s.name), line);
    return a;
  }

  function renderShelf() {
    const home = !location.hash;
    $("shelf").hidden = !home;
    $("books").replaceChildren(...lib.series.map(book));
    $("empty").hidden = lib.series.length > 0;
    const n = lib.series.length;
    $("shelf-count").textContent = n ? (n > 1 ? `${n} séries` : "1 série") : "";
  }

  // ---- a series ----
  function volumeTile(v) {
    const look = tileLook(v);
    const a = el("a", look.tile);
    a.href = openUrl(v);
    const cover = el("span", "cover");
    cover.append(v.readable ? img(coverUrl(v.id)) : el("span", "file", look.format));
    if (look.bar) cover.append(bar(percent(v)));
    a.append(cover, el("span", "title", v.label), el("span", look.line, readingState(v)));
    return a;
  }

  function missingTile(n, s) {
    const tile = el("div", "volume missing");
    const cover = el("span", "cover");
    cover.append(el("span", "file", `T${n}`));
    tile.append(cover, el("span", "title", `Tome ${n}`), button("Le chercher", "link", () => runSearch(s.name)));
    return tile;
  }

  function followSwitch(s) {
    const sw = el("button", "switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(s.follow));
    sw.append(el("span", "knob"), el("span", "", "Suivre les nouveaux tomes"));
    sw.onclick = async () => {
      s.follow = !s.follow;
      sw.setAttribute("aria-checked", String(s.follow));
      await api("/api/follow", { series: s.name, follow: s.follow });
    };
    return sw;
  }

  function nextToRead(s) {
    return s.volumes.find((v) => v.readable && v.pages && !v.done) || s.volumes.find((v) => v.readable && !v.done) || s.volumes[0];
  }

  function renderSeries() {
    const s = byName(seriesInHash(location.hash));
    const box = $("series");
    box.hidden = !s;
    if (!s) return;
    $("results").hidden = true;
    box.style.setProperty("--tint", tint(s.meta));
    const back = el("a", "back", "Bibliothèque");
    back.href = "#";
    const v = nextToRead(s);
    const read = el("a", "button primary", readLabel(v));
    read.href = openUrl(v);
    const head = el("div", "series-head");
    const text = el("div");
    text.append(back, el("h2", "", s.name), facts(seriesFacts(s, s.meta)), read, followSwitch(s));
    head.append(img(seriesCover(s), "series-cover"), text);
    const grid = el("div", "volumes");
    const tiles = s.volumes.map(volumeTile).concat(s.missing.map((n) => missingTile(n, s)));
    const order = (tile) => tomeOrder(tile.querySelector(".title").textContent);
    tiles.sort((a, b) => order(a) - order(b));
    grid.append(...tiles);
    box.replaceChildren(head, grid);
  }

  function render() {
    renderResume();
    renderDownloads();
    renderShelf();
    renderSeries();
  }

  let timer = null;
  async function load() {
    lib = await api("/api/library");
    render();
    clearTimeout(timer);
    // follow the downloads while there are some
    if (lib.downloads.length) timer = setTimeout(load, 5000);
  }

  // ---- search: one result per series ----
  let found = [];
  let lastQuery = "";

  function otherRow(r, g) {
    const li = el("li");
    const text = el("div");
    text.append(el("span", "", r.title), el("small", "", `${tomes(r.range)}, ${describe(r)}`));
    li.append(text, button("Récupérer", "quiet", (e) => getIt(r, g, false, e.target)));
    return li;
  }

  async function getIt(r, g, follow, where) {
    const box = where.closest(".actions") || where.parentNode;
    where.disabled = true;
    try {
      await api("/api/grab", { token: r.token, series: g.name, follow, query: lastQuery });
      const done = el("p", "done", follow ? "C'est parti. Les tomes arrivent dans ta bibliothèque, et les prochains suivront tout seuls." : "C'est parti. Les tomes arrivent dans ta bibliothèque.");
      box.replaceWith(done);
      load();
    } catch (err) {
      where.disabled = false;
      box.append(el("p", "error", "Le téléchargement n'a pas pu partir : " + err.message + ". Réessaie dans un instant."));
    }
  }

  function find(g) {
    const best = g.releases[0];
    const art = el("article", "find");
    art.style.setProperty("--tint", tint(g.meta));
    const pic = g.meta.cover ? img(g.meta.cover, "find-cover") : el("span", "find-cover blank", g.name.slice(0, 1));
    const body = el("div", "find-body");
    const owned = byName(g.name);
    body.append(el("h3", "", g.name), facts(seriesFacts(owned, g.meta)));
    const pick = el("p", "pick");
    pick.append(el("strong", "", tomes(best.range)), document.createTextNode(" " + describe(best)));
    body.append(pick);
    const follow = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = true;
    follow.append(box, document.createTextNode(" Suivre les nouveaux tomes"));
    const actions = el("div", "actions");
    actions.append(button(owned ? "Compléter" : "Tout récupérer", "primary", (e) => getIt(best, g, box.checked, e.target)), follow);
    body.append(actions);
    if (g.releases.length > 1) {
      const more = el("details", "others");
      more.append(el("summary", "", `Autres versions (${g.releases.length - 1})`));
      const list = el("ul");
      list.append(...g.releases.slice(1).map((r) => otherRow(r, g)));
      more.append(list);
      body.append(more);
    }
    art.append(pic, body);
    return art;
  }

  function renderFinds() {
    const all = $("all-languages").checked;
    const shown = found
      .map((g) => ({ ...g, releases: g.releases.filter((r) => all || r.lang === "FR") }))
      .filter((g) => g.releases.length);
    $("finds").replaceChildren(...shown.map(find));
    if (!shown.length && $("searching").hidden) {
      const hint = found.length ? "Rien en français pour ce titre. Coche « Afficher aussi l'anglais » pour voir le reste." : "Aucun tome trouvé. Essaie le titre japonais, ou un mot de moins.";
      $("finds").append(el("p", "empty-line", hint));
    }
  }

  async function runSearch(q) {
    lastQuery = q;
    location.hash = "";
    $("search").q.value = q;
    $("results").hidden = false;
    $("results-title").textContent = `Résultats pour « ${q} »`;
    $("searching").hidden = false;
    $("finds").replaceChildren();
    try {
      found = await api("/api/search?q=" + encodeURIComponent(q));
    } catch (err) {
      found = [];
      $("finds").append(el("p", "error", "La recherche n'a pas abouti : " + err.message + ". Vérifie que Prowlarr tourne, puis relance."));
    }
    $("searching").hidden = true;
    renderFinds();
    $("results").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  function start() {
    $("search").onsubmit = (e) => {
      e.preventDefault();
      runSearch(e.target.q.value.trim());
    };
    for (const b of document.querySelectorAll("[data-try]")) b.onclick = () => runSearch(b.dataset.try);
    $("all-languages").onchange = renderFinds;
    $("close-results").onclick = () => ($("results").hidden = true);
    addEventListener("hashchange", () => {
      render();
      scrollTo(0, 0);
    });
    load();
  }

  return { start, ...helpers };
})();

if (typeof module !== "undefined") module.exports = Ohara;
else Ohara.start();
