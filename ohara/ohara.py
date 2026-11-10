"""Ohara: a manga library on the Pi. Finds volumes through Prowlarr, downloads them
with Transmission, files them in /manga/<Series>/ and serves them to the reader.

Only the standard library and Pillow (for the covers). Every setting comes from the
environment (see docker-compose.ohara.yml)."""

import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MANGA = Path(os.environ.get("OHARA_MANGA", "/manga"))
STATE_DIR = MANGA / ".ohara"
INCOMING = MANGA / ".incoming"
# the same folder as Transmission sees it
TRANSMISSION_INCOMING = os.environ.get("OHARA_TRANSMISSION_DIR", "/data/manga/.incoming")
TRANSMISSION_URL = os.environ.get("OHARA_TRANSMISSION_URL", "http://transmission:9091/transmission/rpc")
PROWLARR_URL = os.environ.get("OHARA_PROWLARR_URL", "http://prowlarr:9696")
PROWLARR_CONFIG = os.environ.get("OHARA_PROWLARR_CONFIG", "/config/prowlarr/config.xml")
INDEXERS = [n.strip() for n in os.environ.get("OHARA_INDEXERS", "YggReborn,Nyaa.si,Knaben").split(",") if n.strip()]
WEB = Path(__file__).with_name("web")
PORT = int(os.environ.get("OHARA_PORT", "8585"))

IMAGE = re.compile(r"\.(jpe?g|png|webp|gif|avif)$", re.I)
READABLE = (".cbz", ".zip")
KEPT = (".cbz", ".zip", ".pdf", ".epub")
ARCHIVES = (".cbr", ".rar", ".cb7", ".7z")
VIDEO = re.compile(r"(?i)\b(1080p|720p|2160p|x26[45]|hevc|web-?dl|webrip|bluray|s\d\d(e\d\d)?)\b|\.(mkv|mp4|avi)\b")
BOOKISH = re.compile(r"(?i)\b(cbz|cbr|cb7|tomes?|t\d{1,3}|vol(ume)?s?\.?\s*\d+|v\d{1,3}|scans?)\b")
FRENCH = re.compile(r"(?i)\b(fr|vf|vff|french|fran[cç]ais|truefrench)\b")
ENGLISH = re.compile(r"(?i)\b(eng|english|scanlated|digital|viz|yen press)\b")
JAPANESE = re.compile(r"(?i)\b(jp|jap|raw)\b|[\u3040-\u30ff]|巻")
FRENCH_TRACKERS = ("YggReborn", "Torrent9", "World-torrent")
LANG_ORDER = {"FR": 0, "EN": 1, "?": 2, "JP": 3}
VOLUME = re.compile(r"(?i)(?:tome|vol(?:ume)?|\bt|\bv)[\s._-]*0*(\d+(?:\.\d+)?)")
SERIES_END = re.compile(r"(?i)[\s._-]*(\b(tomes?|t\d+|vol(ume)?s?|v\d+|int[ée]grale|cbz|cbr|pdf|epub|ebook|complete|chapitres?)\b|\d+\s*(à|-|to)\s*\d+).*$")

lock = threading.Lock()


# ---------- state: downloads under way and reading progress, in one JSON file ----------

def load_state():
    try:
        return json.loads((STATE_DIR / "state.json").read_text())
    except (OSError, ValueError):
        return {"downloads": {}, "progress": {}}


def save_state(state):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_DIR / "state.tmp"
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1))
    tmp.replace(STATE_DIR / "state.json")


def update_state(change):
    """Applies change(state) under the lock and saves the result."""
    with lock:
        state = load_state()
        result = change(state)
        save_state(state)
        return result


# ---------- names ----------

def natural(text):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", text)]


def guess_series(title):
    """The series name in a release title: "Naruto - T01 à T72 [CBZ] Fr" → "Naruto"."""
    t = re.sub(r"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}", " ", title)
    t = re.sub(r"[._]+", " ", t)
    t = SERIES_END.sub("", t)
    t = re.sub(r"\s+", " ", t).strip(" -–+:,")
    return t or title.strip()


def safe_name(name):
    """A series name usable as a folder name."""
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    return name[:120] or "Sans titre"


def volume_label(filename):
    m = VOLUME.search(Path(filename).stem)
    return f"Tome {m.group(1)}" if m else Path(filename).stem


def language(title, indexer=""):
    """FR, EN, JP or ?; a French tracker's release is French unless it says otherwise."""
    if FRENCH.search(title):
        return "FR"
    if ENGLISH.search(title):
        return "EN"
    if JAPANESE.search(title):
        return "JP"
    return "FR" if indexer in FRENCH_TRACKERS else "?"


# ---------- Prowlarr ----------

def prowlarr_key():
    text = Path(PROWLARR_CONFIG).read_text()
    return re.search(r"<ApiKey>([^<]+)</ApiKey>", text).group(1)


def http_json(url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def indexer_ids(key):
    found = http_json(f"{PROWLARR_URL}/api/v1/indexer", headers={"X-Api-Key": key})
    return [i["id"] for i in found if i["name"] in INDEXERS and i.get("enable")]


def is_manga(result):
    """Books (where YggReborn, Nyaa and Knaben file manga), or a title that says
    CBZ or tomes; never videos, music, games or adult releases."""
    title = result.get("title", "")
    cats = [c.get("id", 0) for c in result.get("categories", [])]
    if VIDEO.search(title) or any(2000 <= c < 7000 for c in cats):
        return False
    return any(7000 <= c < 8000 for c in cats) or bool(BOOKISH.search(title))


def release(result):
    """What the page needs of a Prowlarr result; the token stands for it in a grab."""
    token = hashlib.sha1((result.get("guid") or result["title"]).encode()).hexdigest()[:16]
    return {
        "token": token,
        "title": result["title"],
        "series": guess_series(result["title"]),
        "lang": language(result["title"], result.get("indexer", "")),
        "size": result.get("size", 0),
        "seeders": result.get("seeders", 0),
        "indexer": result.get("indexer", ""),
        "age": result.get("publishDate", ""),
        "_url": result.get("magnetUrl") or result.get("downloadUrl"),
    }


found_releases = {}


def search(query):
    key = prowlarr_key()
    # the Books category on the indexers' side: their manga are there, not drowned in videos
    params = [("query", query), ("type", "search"), ("categories", 7000)] + [("indexerIds", i) for i in indexer_ids(key)]
    url = f"{PROWLARR_URL}/api/v1/search?" + urllib.parse.urlencode(params)
    results = [release(r) for r in http_json(url, headers={"X-Api-Key": key}, timeout=150) if is_manga(r)]
    results.sort(key=lambda r: (LANG_ORDER[r["lang"]], -r["seeders"]))
    for r in results:
        found_releases[r["token"]] = r
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in results]


# ---------- Transmission ----------

session = {"id": ""}


def rpc(method, arguments):
    body = json.dumps({"method": method, "arguments": arguments}).encode()
    for _ in range(2):
        req = urllib.request.Request(TRANSMISSION_URL, data=body, headers={"X-Transmission-Session-Id": session["id"]})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                answer = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 409:
                raise
            session["id"] = e.headers.get("X-Transmission-Session-Id", "")
            continue
        if answer.get("result") != "success":
            raise RuntimeError(answer.get("result"))
        return answer.get("arguments", {})
    raise RuntimeError("Transmission refuses the session")


class KeepRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if newurl.startswith("magnet:"):
            raise MagnetFound(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class MagnetFound(Exception):
    pass


def torrent_source(url):
    """{"filename": magnet} or {"metainfo": base64 .torrent}: Transmission cannot always
    reach Prowlarr from inside the VPN, so Ohara fetches the file itself."""
    if url.startswith("magnet:"):
        return {"filename": url}
    try:
        with urllib.request.build_opener(KeepRedirect).open(url, timeout=60) as r:
            data = r.read()
    except MagnetFound as m:
        return {"filename": str(m)}
    return {"metainfo": base64.b64encode(data).decode()}


def grab(token, series):
    r = found_releases.get(token)
    if not r:
        raise KeyError("search again: this result is no longer known")
    series = safe_name(series or r["series"])
    folder = hashlib.sha1(token.encode()).hexdigest()[:10]
    args = torrent_source(r["_url"])
    args["download-dir"] = f"{TRANSMISSION_INCOMING}/{folder}"
    added = rpc("torrent-add", args)
    t = added.get("torrent-added") or added.get("torrent-duplicate")

    def note(state):
        state["downloads"][t["hashString"]] = {"series": series, "title": r["title"], "folder": folder, "at": time.time()}
    update_state(note)
    return {"series": series, "hash": t["hashString"]}


def cancel(torrent_hash):
    rpc("torrent-remove", {"ids": [torrent_hash], "delete-local-data": True})
    update_state(lambda s: s["downloads"].pop(torrent_hash, None))


def torrents(hashes):
    if not hashes:
        return []
    fields = ["hashString", "percentDone", "status", "error", "errorString", "rateDownload", "eta"]
    return rpc("torrent-get", {"ids": hashes, "fields": fields}).get("torrents", [])


# ---------- import: files a finished download into its series folder ----------

def zip_folder(folder, target):
    """Turns a folder of images into one .cbz."""
    images = sorted((p for p in folder.rglob("*") if IMAGE.search(p.name)), key=lambda p: natural(str(p)))
    with zipfile.ZipFile(target, "w", zipfile.ZIP_STORED) as z:
        for p in images:
            z.write(p, p.relative_to(folder).as_posix())


def unpack_archive(path, target):
    """A .cbr/.cb7 becomes a .cbz (7-Zip reads them); the original is left behind."""
    tmp = path.with_suffix(".unpacked")
    subprocess.run(["7z", "x", "-y", f"-o{tmp}", str(path)], check=True, capture_output=True)
    zip_folder(tmp, target)
    shutil.rmtree(tmp, ignore_errors=True)


def free_name(folder, name):
    target = folder / name
    n = 2
    while target.exists():
        target = folder / f"{Path(name).stem} ({n}){Path(name).suffix}"
        n += 1
    return target


def import_download(source, series):
    """Moves every volume found under source into MANGA/series. Returns how many."""
    dest = MANGA / series
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    files = sorted((p for p in source.rglob("*") if p.is_file()), key=lambda p: natural(str(p)))
    for p in files:
        ext = p.suffix.lower()
        if ext in KEPT:
            shutil.move(str(p), free_name(dest, p.name if ext != ".zip" else p.stem + ".cbz"))
            count += 1
        elif ext in ARCHIVES:
            unpack_archive(p, free_name(dest, p.stem + ".cbz"))
            count += 1
    if not count:
        count = import_image_folders(source, dest)
    return count


def import_image_folders(source, dest):
    """A release of plain images: each folder holding images becomes one volume."""
    folders = sorted({p.parent for p in source.rglob("*") if IMAGE.search(p.name)}, key=lambda p: natural(str(p)))
    for f in folders:
        name = f.name if f != source else source.name
        zip_folder(f, free_name(dest, name + ".cbz"))
    return len(folders)


def check_downloads():
    """Files the finished downloads and forgets them. Runs every 30 s."""
    downloads = load_state()["downloads"]
    for t in torrents(list(downloads)):
        d = downloads.get(t["hashString"])
        if not d or t["percentDone"] < 1:
            continue
        source = INCOMING / d["folder"]
        import_download(source, d["series"])
        rpc("torrent-remove", {"ids": [t["hashString"]], "delete-local-data": True})
        shutil.rmtree(source, ignore_errors=True)
        update_state(lambda s, h=t["hashString"]: s["downloads"].pop(h, None))


def watch():
    while True:
        try:
            check_downloads()
        except Exception as e:  # Transmission restarting, a disk hiccup: try again later
            print("check_downloads:", e, flush=True)
        time.sleep(30)


# ---------- library ----------

def volume_id(path):
    return path.resolve().relative_to(MANGA.resolve()).as_posix()


def volume_path(vid):
    """The file of a volume id, refusing anything outside the library."""
    p = (MANGA / vid).resolve()
    if MANGA.resolve() not in p.parents or not p.is_file() or p.name.startswith("."):
        raise KeyError(vid)
    return p


def volumes(series_dir):
    files = [p for p in series_dir.iterdir() if p.is_file() and p.suffix.lower() in KEPT and not p.name.startswith(".")]
    return sorted(files, key=lambda p: natural(p.name))


def series_list(progress):
    out = []
    dirs = sorted((d for d in MANGA.iterdir() if d.is_dir() and not d.name.startswith(".")), key=lambda d: natural(d.name))
    for d in dirs:
        vols = [volume_info(v, progress) for v in volumes(d)]
        if vols:
            out.append({"name": d.name, "volumes": vols, "read": sum(v["done"] for v in vols)})
    return out


def volume_info(path, progress):
    vid = volume_id(path)
    p = progress.get(vid, {})
    readable = path.suffix.lower() in READABLE
    return {
        "id": vid,
        "label": volume_label(path.name),
        "file": path.name,
        "readable": readable,
        "page": p.get("page", 0),
        "pages": p.get("pages", 0),
        "done": bool(p.get("pages")) and p.get("page", 0) >= p["pages"] - 1,
        "at": p.get("at", 0),
    }


def library():
    state = load_state()
    progress = state["progress"]
    series = series_list(progress) if MANGA.exists() else []
    live = {t["hashString"]: t for t in safe_torrents(list(state["downloads"]))}
    downloads = [download_info(h, d, live.get(h)) for h, d in state["downloads"].items()]
    return {"series": series, "downloads": downloads, "last": last_read(series)}


def safe_torrents(hashes):
    try:
        return torrents(hashes)
    except Exception:
        return []


def download_info(torrent_hash, d, t):
    info = {"hash": torrent_hash, "series": d["series"], "title": d["title"], "pct": 0, "state": "unknown"}
    if t:
        info["pct"] = round(t["percentDone"] * 100)
        info["eta"] = t.get("eta", -1)
        info["state"] = "error" if t.get("error") else "done" if t["percentDone"] >= 1 else "downloading"
        info["error"] = t.get("errorString", "")
    return info


def last_read(series):
    vols = [dict(v, series=s["name"]) for s in series for v in s["volumes"] if v["at"]]
    return max(vols, key=lambda v: v["at"]) if vols else None


# ---------- pages ----------

pages_cache = {}


def pages(path):
    """The image names of a .cbz, in reading order (cached per file and date)."""
    key = (str(path), path.stat().st_mtime)
    if key not in pages_cache:
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if IMAGE.search(n) and "__MACOSX" not in n and not Path(n).name.startswith(".")]
        pages_cache[key] = sorted(names, key=natural)
    return pages_cache[key]


def page_bytes(path, n):
    names = pages(path)
    with zipfile.ZipFile(path) as z:
        return z.read(names[n]), names[n]


def cover(path):
    """A small JPEG of a volume's first page, made once and kept in .ohara/covers."""
    out = STATE_DIR / "covers" / (hashlib.sha1(volume_id(path).encode()).hexdigest() + ".jpg")
    if not out.exists():
        from PIL import Image
        data, _ = page_bytes(path, 0)
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((360, 540))
        out.parent.mkdir(parents=True, exist_ok=True)
        img.save(out, "JPEG", quality=80)
    return out.read_bytes()


def volume_pages(vid):
    path = volume_path(vid)
    series = path.parent
    vols = volumes(series)
    i = vols.index(path)
    nxt = next((v for v in vols[i + 1:] if v.suffix.lower() in READABLE), None)
    saved = load_state()["progress"].get(vid, {})
    return {
        "id": vid,
        "series": series.name,
        "label": volume_label(path.name),
        "count": len(pages(path)),
        "page": saved.get("page", 0),
        "next": volume_id(nxt) if nxt else None,
    }


def save_progress(vid, page, count):
    volume_path(vid)

    def note(state):
        state["progress"][vid] = {"page": int(page), "pages": int(count), "at": time.time()}
    update_state(note)


def status():
    """The home page's card."""
    lib = library()
    vols = sum(len(s["volumes"]) for s in lib["series"])
    return {"series": len(lib["series"]), "volumes": vols, "downloads": lib["downloads"], "last": lib["last"]}


# ---------- HTTP ----------

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
         ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
         ".avif": "image/avif", ".pdf": "application/pdf", ".epub": "application/epub+zip"}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code, body, ctype="application/json", extra=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def query(self):
        return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.path).query))

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        self.route(GET_ROUTES)

    def do_POST(self):
        self.route(POST_ROUTES)

    def route(self, routes):
        path = urllib.parse.urlsplit(self.path).path
        action = routes.get(path)
        try:
            if action:
                return action(self)
            return self.static(path)
        except KeyError as e:
            self.send(404, {"error": str(e)})
        except Exception as e:
            self.send(502, {"error": str(e)})

    def static(self, path):
        name = {"/": "index.html", "/read": "read.html"}.get(path, path.lstrip("/"))
        f = (WEB / name).resolve()
        if WEB.resolve() not in f.parents or not f.is_file():
            raise KeyError(path)
        self.send(200, f.read_bytes(), TYPES.get(f.suffix, "application/octet-stream"), {"Cache-Control": "no-cache"})


def get_search(h):
    q = h.query().get("q", "").strip()
    h.send(200, search(q) if q else [])


def get_page(h):
    q = h.query()
    data, name = page_bytes(volume_path(q["vol"]), int(q.get("n", 0)))
    h.send(200, data, TYPES.get(Path(name).suffix.lower(), "image/jpeg"), {"Cache-Control": "max-age=86400"})


def get_file(h):
    """A PDF or EPUB as is, for the browser's own viewer; streamed, they can be big."""
    path = volume_path(h.query()["vol"])
    h.send_response(200)
    h.send_header("Content-Type", TYPES.get(path.suffix.lower(), "application/octet-stream"))
    h.send_header("Content-Length", str(path.stat().st_size))
    h.end_headers()
    with path.open("rb") as f:
        shutil.copyfileobj(f, h.wfile)


def get_cover(h):
    h.send(200, cover(volume_path(h.query()["vol"])), "image/jpeg", {"Cache-Control": "max-age=604800"})


def post_grab(h):
    b = h.body()
    h.send(200, grab(b["token"], b.get("series", "")))


def post_progress(h):
    b = h.body()
    save_progress(b["vol"], b["page"], b["count"])
    h.send(200, {"ok": True})


def post_cancel(h):
    cancel(h.body()["hash"])
    h.send(200, {"ok": True})


GET_ROUTES = {
    "/api/search": get_search,
    "/api/library": lambda h: h.send(200, library()),
    "/api/pages": lambda h: h.send(200, volume_pages(h.query()["vol"])),
    "/api/page": get_page,
    "/api/file": get_file,
    "/api/cover": get_cover,
    "/api/status.json": lambda h: h.send(200, status(), extra={"Access-Control-Allow-Origin": "*"}),
}
POST_ROUTES = {"/api/grab": post_grab, "/api/progress": post_progress, "/api/cancel": post_cancel}


def main():
    MANGA.mkdir(parents=True, exist_ok=True)
    INCOMING.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=watch, daemon=True).start()
    print(f"Ohara on port {PORT}, library in {MANGA}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
