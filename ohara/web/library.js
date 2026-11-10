// Ohara's library page: the shelf of series, a series' volumes, the downloads under
// way and the search through the indexers. Everything comes from /api/*.
const Ohara = (() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  const api = async (path, body) => {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    return data;
  };

  const size = (bytes) => (bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " Go" : Math.max(1, Math.round(bytes / 1e6)) + " Mo");

  const progress = (v) => {
    if (!v.readable) return v.file.split(".").pop().toUpperCase();
    if (v.done) return "Lu ✓";
    if (!v.pages) return "Pas commencé";
    return `p. ${v.page + 1} / ${v.pages}`;
  };

  const coverUrl = (vid) => "/api/cover?vol=" + encodeURIComponent(vid);
  const openUrl = (v) => (v.readable ? "/read?vol=" : "/api/file?vol=") + encodeURIComponent(v.id);

  // ---- library ----
  let lib = { series: [], downloads: [], last: null };

  function tile(href, cover, title, sub) {
    const a = el("a", "tile t-panel");
    a.href = href;
    const img = el("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = cover;
    a.append(img, el("b", "", title), el("small", "t-label", sub));
    return a;
  }

  function renderShelf() {
    const grid = $("series-grid");
    grid.replaceChildren(
      ...lib.series.map((s) => tile("#" + encodeURIComponent(s.name), coverUrl(s.volumes[0].id), s.name, `${s.volumes.length} tome${s.volumes.length > 1 ? "s" : ""} · ${s.read} lu${s.read > 1 ? "s" : ""}`))
    );
    $("empty").hidden = lib.series.length > 0;
  }

  function renderSeries(name) {
    const s = lib.series.find((x) => x.name === name);
    $("series").hidden = !s;
    $("shelf").hidden = !!s;
    if (!s) return;
    $("series-name").textContent = s.name;
    $("volume-grid").replaceChildren(...s.volumes.map((v) => tile(openUrl(v), v.readable ? coverUrl(v.id) : "/ohara.svg", v.label, progress(v))));
  }

  function renderLast() {
    const v = lib.last;
    $("last").hidden = !v;
    if (!v) return;
    const a = $("continue");
    a.href = openUrl(v);
    a.replaceChildren(el("img", "", undefined), el("span", "", `${v.series} · ${v.label}`), el("small", "t-label", progress(v)));
    a.firstChild.src = coverUrl(v.id);
    a.firstChild.alt = "";
  }

  function downloadRow(d) {
    const li = el("li", "t-panel");
    const bar = el("span", "t-bar");
    const fill = el("i");
    fill.style.width = d.pct + "%";
    bar.append(fill);
    const state = d.state === "error" ? "Erreur : " + d.error : d.state === "done" ? "Rangement…" : d.pct + " %";
    const stop = el("button", "t-btn", "Annuler");
    stop.type = "button";
    stop.onclick = async () => {
      stop.disabled = true;
      await api("/api/cancel", { hash: d.hash });
      load();
    };
    li.append(el("b", "", d.series), el("small", "t-label", d.title), bar, el("span", "", state), stop);
    return li;
  }

  function renderDownloads() {
    $("downloads").hidden = !lib.downloads.length;
    $("download-list").replaceChildren(...lib.downloads.map(downloadRow));
  }

  function render() {
    renderLast();
    renderDownloads();
    renderShelf();
    renderSeries(decodeURIComponent(location.hash.slice(1)));
  }

  let timer = null;
  async function load() {
    lib = await api("/api/library");
    render();
    clearTimeout(timer);
    // follow the downloads while there are some
    if (lib.downloads.length) timer = setTimeout(load, 5000);
  }

  // ---- search ----
  let found = [];

  function addForm(r, li) {
    const form = el("form", "add");
    const input = el("input");
    input.value = r.series;
    input.required = true;
    input.setAttribute("list", "series-names");
    input.title = "Le nom de la série : les tomes iront dans son dossier";
    const ok = el("button", "t-btn t-main", "Télécharger");
    form.append(el("span", "t-label", "Série"), input, ok);
    form.onsubmit = async (e) => {
      e.preventDefault();
      ok.disabled = true;
      ok.textContent = "…";
      try {
        const done = await api("/api/grab", { token: r.token, series: input.value });
        form.replaceChildren(el("span", "t-up", `Ajouté à « ${done.series} » ✓`));
        load();
      } catch (err) {
        ok.disabled = false;
        ok.textContent = "Réessayer";
        form.append(el("span", "t-down", String(err.message)));
      }
    };
    li.append(form);
    input.focus();
  }

  function resultRow(r) {
    const li = el("li", "t-panel result");
    const badge = el("span", "t-badge lang", r.lang);
    const add = el("button", "t-btn", "Ajouter");
    add.type = "button";
    add.onclick = () => {
      add.remove();
      addForm(r, li);
    };
    li.append(badge, el("b", "", r.title), el("small", "t-label", `${size(r.size)} · ${r.seeders} seeders · ${r.indexer}`), add);
    return li;
  }

  function renderResults() {
    const frOnly = $("fr-only").checked;
    const shown = found.filter((r) => !frOnly || r.lang === "FR");
    const list = $("result-list");
    list.replaceChildren(...shown.map(resultRow));
    if (!shown.length && $("searching").hidden) {
      list.append(el("li", "t-callout", found.length ? "Rien en français : décoche le filtre pour voir le reste." : "Aucun tome trouvé. Essaie un autre nom (le titre japonais, par exemple)."));
    }
  }

  async function runSearch(q) {
    $("results").hidden = false;
    $("searching").hidden = false;
    document.querySelector("[data-results-for]").textContent = q;
    $("result-list").replaceChildren();
    try {
      found = await api("/api/search?q=" + encodeURIComponent(q));
    } catch (err) {
      found = [];
      $("result-list").append(el("li", "t-callout t-down", "La recherche a échoué : " + err.message));
    }
    $("searching").hidden = true;
    renderResults();
  }

  function namesList() {
    let dl = $("series-names");
    if (!dl) {
      dl = el("datalist");
      dl.id = "series-names";
      document.body.append(dl);
    }
    dl.replaceChildren(...lib.series.map((s) => Object.assign(el("option"), { value: s.name })));
  }

  function start() {
    $("search").onsubmit = (e) => {
      e.preventDefault();
      namesList();
      runSearch(e.target.q.value.trim());
    };
    $("fr-only").onchange = renderResults;
    $("close-results").onclick = () => ($("results").hidden = true);
    $("back").onclick = () => (location.hash = "");
    addEventListener("hashchange", render);
    load();
  }

  return { start, size, progress, openUrl };
})();

if (typeof module !== "undefined") module.exports = Ohara;
else Ohara.start();
