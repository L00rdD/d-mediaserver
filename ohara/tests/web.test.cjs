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

test("sizes in Mo and Go", () => {
  assert.equal(Ohara.size(7.41e9), "7.4 Go");
  assert.equal(Ohara.size(3.6e8), "360 Mo");
  assert.equal(Ohara.size(1000), "1 Mo");
});

test("where a volume is in its reading", () => {
  const v = { readable: true, file: "T1.cbz", pages: 0, page: 0, done: false };
  assert.equal(Ohara.progress(v), "Pas commencé");
  assert.equal(Ohara.progress({ ...v, pages: 180, page: 41 }), "p. 42 / 180");
  assert.equal(Ohara.progress({ ...v, pages: 180, page: 179, done: true }), "Lu ✓");
  assert.equal(Ohara.progress({ ...v, readable: false, file: "T3.pdf" }), "PDF");
});

test("a volume opens in the reader, a PDF in the browser", () => {
  assert.equal(Ohara.openUrl({ id: "Naruto/T 1.cbz", readable: true }), "/read?vol=Naruto%2FT%201.cbz");
  assert.equal(Ohara.openUrl({ id: "Naruto/T3.pdf", readable: false }), "/api/file?vol=Naruto%2FT3.pdf");
});
