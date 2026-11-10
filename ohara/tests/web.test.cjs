// Tests of the pure parts of Ohara's pages (ohara/web/*.js): node --test ohara/tests/
const test = require("node:test");
const assert = require("node:assert");
const Reader = require("../web/reader.js");
const Ohara = require("../web/library.js");

test("single pages, one at a time", () => {
  assert.deepEqual(Reader.spread(3, 10, false), [3]);
  assert.equal(Reader.after(3, 10, false), 4);
  assert.equal(Reader.before(3, 10, false), 2);
  assert.equal(Reader.before(0, 10, false), 0);
  assert.equal(Reader.after(9, 10, false), 10);
});

test("two pages: the cover alone, then pairs", () => {
  assert.deepEqual(Reader.spread(0, 10, true), [0]);
  assert.deepEqual(Reader.spread(1, 10, true), [1, 2]);
  assert.deepEqual(Reader.spread(2, 10, true), [1, 2]);
  assert.deepEqual(Reader.spread(9, 10, true), [9]);
  assert.equal(Reader.after(0, 10, true), 1);
  assert.equal(Reader.after(2, 10, true), 3);
  assert.equal(Reader.after(8, 10, true), 9);
  assert.equal(Reader.after(9, 10, true), 10);
  assert.equal(Reader.before(4, 10, true), 1);
  assert.equal(Reader.before(1, 10, true), 0);
  assert.equal(Reader.before(0, 10, true), 0);
});

test("the right half turns to the next page, the left half back", () => {
  assert.equal(Reader.zone(0.1), "prev");
  assert.equal(Reader.zone(0.49), "prev");
  assert.equal(Reader.zone(0.5), "next");
  assert.equal(Reader.zone(0.9), "next");
});

test("sizes in Mo and Go, French style", () => {
  assert.equal(Ohara.size(7.41e9), "7,4 Go");
  assert.equal(Ohara.size(3.6e8), "360 Mo");
  assert.equal(Ohara.size(1000), "1 Mo");
});

test("tomes in words", () => {
  assert.equal(Ohara.tomes([1, 14]), "Tomes 1 à 14");
  assert.equal(Ohara.tomes([98, 98]), "Tome 98");
  assert.equal(Ohara.tomes(null), "Tomes non précisés");
});

test("a release in one sentence", () => {
  assert.equal(Ohara.describe({ lang: "FR", size: 3.6e9, speed: "rapide" }), "en français, 3,6 Go, téléchargement rapide");
  assert.equal(Ohara.describe({ lang: "?", size: 2e8, speed: "bloqué" }), "langue inconnue, 200 Mo, téléchargement bloqué");
});

test("where a volume is in its reading", () => {
  const v = { readable: true, file: "T1.cbz", pages: 0, page: 0, done: false, new: false };
  assert.equal(Ohara.readingState(v), "Pas commencé");
  assert.equal(Ohara.readingState({ ...v, new: true }), "Nouveau");
  assert.equal(Ohara.readingState({ ...v, pages: 180, page: 41 }), "Page 42 sur 180");
  assert.equal(Ohara.readingState({ ...v, pages: 180, page: 179, done: true }), "Lu");
  assert.equal(Ohara.readingState({ ...v, readable: false }), "S'ouvre dans le navigateur");
});

test("time left", () => {
  assert.equal(Ohara.eta(-1), "");
  assert.equal(Ohara.eta(0), "");
  assert.equal(Ohara.eta(61), "encore 2 min");
  assert.equal(Ohara.eta(7200), "encore 2 h");
});

test("what is known of a series", () => {
  assert.deepEqual(Ohara.seriesFacts({ volumes: [1, 2] }, { status: "En cours", volumes: 14 }), ["En cours", "14 tomes parus", "2 chez toi"]);
  assert.deepEqual(Ohara.seriesFacts(undefined, {}), []);
});

test("a volume opens in the reader, a PDF in the browser", () => {
  assert.equal(Ohara.openUrl({ id: "Naruto/T 1.cbz", readable: true }), "/read?vol=Naruto%2FT%201.cbz");
  assert.equal(Ohara.openUrl({ id: "Naruto/T3.pdf", readable: false }), "/api/file?vol=Naruto%2FT3.pdf");
});

test("a tint for every series, even without AniList", () => {
  assert.equal(Ohara.tint({ color: "#e4ae5d" }), "#e4ae5d");
  assert.equal(Ohara.tint({}), "#3b5a4f");
  assert.equal(Ohara.tint(undefined), "#3b5a4f");
});

test("how far into a volume", () => {
  assert.equal(Ohara.percent({ page: 7, pages: 195 }), 4);
  assert.equal(Ohara.percent({ page: 0, pages: 0 }), 0);
});

test("a download in words", () => {
  assert.equal(Ohara.downloadState({ state: "error", error: "no space" }), "Bloqué : no space");
  assert.equal(Ohara.downloadState({ state: "done" }), "Rangement dans la bibliothèque");
  assert.equal(Ohara.downloadState({ state: "downloading", pct: 42, eta: 600 }), "42 %, encore 10 min");
  assert.equal(Ohara.downloadState({ state: "unknown", pct: 0, eta: -1 }), "0 %");
});

test("the button of a series", () => {
  assert.equal(Ohara.readLabel({ label: "Tome 98", pages: 195 }), "Reprendre le tome 98");
  assert.equal(Ohara.readLabel({ label: "Tome 1", pages: 0 }), "Lire le tome 1");
});

test("a series from the address", () => {
  assert.equal(Ohara.seriesInHash("#serie/One%20Piece"), "One Piece");
  assert.equal(Ohara.seriesInHash(""), null);
});

test("tiles in tome order, unnumbered last", () => {
  assert.equal(Ohara.tomeOrder("Tome 12.5"), 12.5);
  assert.equal(Ohara.tomeOrder("Artbook"), 1e9);
});

test("the look of a volume's tile", () => {
  assert.deepEqual(Ohara.tileLook({ done: true, new: false, pages: 10, file: "T1.cbz" }), { tile: "volume done", line: "line", bar: false, format: "CBZ" });
  assert.deepEqual(Ohara.tileLook({ done: false, new: true, pages: 0, file: "T3.pdf" }), { tile: "volume", line: "line new", bar: false, format: "PDF" });
  assert.equal(Ohara.tileLook({ done: false, pages: 10, file: "a.cbz" }).bar, true);
});
