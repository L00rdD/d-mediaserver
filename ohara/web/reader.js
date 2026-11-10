// Ohara's reader: one volume, page by page or two pages side by side, left to right.
// A click on the right half turns to the next page, on the left half back to the
// previous one. The bars show while the mouse moves, or with the corner button.
// The page reached is saved on the server, so another device picks it up.
const Reader = (() => {
  // ---- pure page arithmetic (tested in node) ----

  // The pages shown together from page p: the cover alone, then pairs 1-2, 3-4…
  function spread(p, count, double) {
    if (!double || p === 0) return [p];
    const first = p % 2 === 1 ? p : p - 1;
    return first + 1 < count ? [first, first + 1] : [first];
  }

  // The first page after the spread holding p; count when it was the last
  function after(p, count, double) {
    const s = spread(p, count, double);
    return Math.min(s[s.length - 1] + 1, count);
  }

  function before(p, count, double) {
    const s = spread(p, count, double);
    return s[0] === 0 ? 0 : spread(s[0] - 1, count, double)[0];
  }

  // Where a click lands, from its place across the screen (0 to 1)
  const zone = (x) => (x < 0.5 ? "prev" : "next");

  if (typeof document === "undefined") return { spread, after, before, zone };

  // ---- the page ----
  const $ = (id) => document.getElementById(id);
  const vid = new URLSearchParams(location.search).get("vol");
  const pref = (key, fallback) => localStorage.getItem("ohara-" + key) || fallback;
  const settings = {
    double: pref("mode", innerWidth > innerHeight * 1.2 ? "double" : "single") === "double",
    fit: pref("fit", "height"),
  };
  let info = null;
  let page = 0;
  let saveTimer = null;

  const src = (n) => `/api/page?vol=${encodeURIComponent(vid)}&n=${n}`;

  function draw() {
    const stage = $("stage");
    stage.dataset.fit = settings.fit;
    const shown = spread(page, info.count, settings.double);
    stage.replaceChildren(...shown.map((n) => Object.assign(document.createElement("img"), { src: src(n), alt: `Page ${n + 1}` })));
    stage.scrollTo(0, 0);
    $("count").textContent = `${shown.map((n) => n + 1).join("-")} / ${info.count}`;
    $("slider").value = page + 1;
    $("mode").textContent = settings.double ? "2 pages" : "1 page";
    $("fit").textContent = settings.fit === "height" ? "Ajuster : hauteur" : "Ajuster : largeur";
    preload(after(page, info.count, settings.double));
    save();
  }

  function preload(from) {
    for (let n = from; n < Math.min(from + 4, info.count); n++) new Image().src = src(n);
  }

  function save(done) {
    clearTimeout(saveTimer);
    const at = done ? info.count - 1 : page;
    saveTimer = setTimeout(() => {
      fetch("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vol: vid, page: at, count: info.count }) });
    }, done ? 0 : 800);
  }

  function go(n) {
    $("end").hidden = true;
    page = Math.max(0, Math.min(n, info.count - 1));
    draw();
  }

  function next() {
    const n = after(page, info.count, settings.double);
    if (n >= info.count) return end();
    go(n);
  }

  const prev = () => ($("end").hidden ? go(before(page, info.count, settings.double)) : go(page));

  function end() {
    save(true);
    const nv = $("next-volume");
    nv.hidden = !info.next;
    if (info.next) nv.href = "/read?vol=" + encodeURIComponent(info.next);
    $("end").hidden = false;
  }

  // the bars: shown by the corner button, or for a few seconds while the mouse moves
  let barsTimer = null;
  const toggleBars = () => document.body.classList.toggle("bars");
  function peekBars(e) {
    if (e.pointerType !== "mouse") return;
    document.body.classList.add("bars");
    clearTimeout(barsTimer);
    if (!e.target.closest(".bar")) barsTimer = setTimeout(() => document.body.classList.remove("bars"), 2500);
  }

  function setting(key, value) {
    settings[key] = value;
    localStorage.setItem("ohara-" + (key === "double" ? "mode" : key), key === "double" ? (value ? "double" : "single") : value);
    go(page);
  }

  function keys(e) {
    const k = { ArrowLeft: prev, ArrowRight: next, " ": next, PageDown: next, PageUp: prev, Escape: () => (location.href = $("back").href) }[e.key];
    if (!k) return;
    e.preventDefault();
    k();
  }

  async function start() {
    info = await (await fetch("/api/pages?vol=" + encodeURIComponent(vid))).json();
    document.title = `${info.series} · ${info.label}`;
    $("title").textContent = document.title;
    $("back").href = $("end-back").href = "/#" + encodeURIComponent(info.series);
    $("slider").max = info.count;
    $("slider").oninput = (e) => go(+e.target.value - 1);
    $("stage").onclick = (e) => (zone(e.clientX / innerWidth) === "next" ? next() : prev());
    $("menu").onclick = toggleBars;
    addEventListener("pointermove", peekBars);
    $("mode").onclick = () => setting("double", !settings.double);
    $("fit").onclick = () => setting("fit", settings.fit === "height" ? "width" : "height");
    $("end-stay").onclick = () => go(page);
    addEventListener("keydown", keys);
    go(info.page >= info.count - 1 ? 0 : info.page);
  }

  start();
  return { spread, after, before, zone };
})();

if (typeof module !== "undefined") module.exports = Reader;
