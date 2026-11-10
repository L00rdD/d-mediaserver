"""Ohara: a manga library on the Pi. Finds volumes through Prowlarr, downloads them
with Transmission, files them in /manga/<Series>/, follows the series for their new
volumes and serves them to the reader. Covers and series facts come from AniList.

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
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from names import (LANG_ORDER, guess_series, language, natural, norm, safe_name,  # noqa: E402
                   speed, tome_range, volume_label, volume_number)

MANGA = Path(os.environ.get("OHARA_MANGA", "/manga"))
STATE_DIR = MANGA / ".ohara"
INCOMING = MANGA / ".incoming"
# the same folder as Transmission sees it
TRANSMISSION_INCOMING = os.environ.get("OHARA_TRANSMISSION_DIR", "/data/manga/.incoming")
TRANSMISSION_URL = os.environ.get("OHARA_TRANSMISSION_URL", "http://transmission:9091/transmission/rpc")
PROWLARR_URL = os.environ.get("OHARA_PROWLARR_URL", "http://prowlarr:9696")
PROWLARR_CONFIG = os.environ.get("OHARA_PROWLARR_CONFIG", "/config/prowlarr/config.xml")
INDEXERS = [n.strip() for n in os.environ.get("OHARA_INDEXERS", "YggReborn,Nyaa.si,Knaben").split(",") if n.strip()]
ANILIST = "https://graphql.anilist.co"
FOLLOW_EVERY = float(os.environ.get("OHARA_FOLLOW_HOURS", "12")) * 3600
NEW_FOR = 7 * 86400  # a volume stays "new" a week, until it is opened
WEB = Path(__file__).with_name("web")
PORT = int(os.environ.get("OHARA_PORT", "8585"))

IMAGE = re.compile(r"\.(jpe?g|png|webp|gif|avif)$", re.I)
READABLE = (".cbz", ".zip")
KEPT = (".cbz", ".zip", ".pdf", ".epub")
ARCHIVES = (".cbr", ".rar", ".cb7", ".7z")
VIDEO = re.compile(r"(?i)\b(1080p|720p|2160p|x26[45]|hevc|web-?dl|webrip|bluray|s\d\d(e\d\d)?)\b|\.(mkv|mp4|avi)\b")
BOOKISH = re.compile(r"(?i)\b(cbz|cbr|cb7|tomes?|t\d{1,3}|vol(ume)?s?\.?\s*\d+|v\d{1,3}|scans?)\b")

lock = threading.Lock()


# ---------- state: downloads, reading progress, followed series, AniList answers ----------

def load_state():
    try:
        state = json.loads((STATE_DIR / "state.json").read_text())
    except (OSError, ValueError):
        state = {}
    for key in ("downloads", "progress", "series", "lookups"):
        state.setdefault(key, {})
    return state


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


def series_entry(state, name):
    return state["series"].setdefault(name, {"follow": False, "query": name})


# ---------- AniList: cover, colour, status and number of volumes of a series ----------

ANILIST_QUERY = """query($s: String) { Page(perPage: 1) { media(search: $s, type: MANGA, sort: SEARCH_MATCH) {
  id title { romaji english } coverImage { extraLarge large color } volumes status startDate { year } } } }"""
STATUS = {"RELEASING": "En cours", "FINISHED": "Terminé", "HIATUS": "En pause", "CANCELLED": "Arrêté", "NOT_YET_RELEASED": "À paraître"}


def anilist_fetch(name):
    body = json.dumps({"query": ANILIST_QUERY, "variables": {"s": name}}).encode()
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Ohara/1.0"}
    found = http_json(ANILIST, data=body, headers=headers, timeout=15)["data"]["Page"]["media"]
    if not found:
        return {}
    m = found[0]
    return {
        "id": m["id"],
        "title": m["title"]["english"] or m["title"]["romaji"],
        "cover": m["coverImage"]["extraLarge"] or m["coverImage"]["large"],
        "color": m["coverImage"]["color"],
        "status": STATUS.get(m["status"], ""),
        "volumes": m["volumes"],
        "year": (m.get("startDate") or {}).get("year"),
    }


def lookup(name):
    """The AniList facts of a series name, asked once and kept (an empty dict when
    AniList does not know it; nothing kept when it does not answer)."""
    key = norm(name)
    cached = load_state()["lookups"].get(key)
    if cached is not None:
        return cached
    try:
        found = anilist_fetch(name)
    except Exception:
        return {}

    def keep(state):
        state["lookups"][key] = found
    update_state(keep)
    return found


def lookups(names):
    with ThreadPoolExecutor(6) as pool:
        return dict(zip(names, pool.map(lookup, names)))


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
    seeders = result.get("seeders", 0)
    return {
        "token": token,
        "title": result["title"],
        "series": guess_series(result["title"]),
        "lang": language(result["title"], result.get("indexer", "")),
        "range": tome_range(result["title"]),
        "size": result.get("size", 0),
        "seeders": seeders,
        "speed": speed(seeders),
        "indexer": result.get("indexer", ""),
        "_url": result.get("magnetUrl") or result.get("downloadUrl"),
    }


found_releases = {}


def find_releases(query):
    """Every manga release Prowlarr finds for query, remembered for a grab."""
    key = prowlarr_key()
    # the Books category on the indexers' side: their manga are there, not drowned in videos
    params = [("query", query), ("type", "search"), ("categories", 7000)] + [("indexerIds", i) for i in indexer_ids(key)]
    url = f"{PROWLARR_URL}/api/v1/search?" + urllib.parse.urlencode(params)
    results = [release(r) for r in http_json(url, headers={"X-Api-Key": key}, timeout=150) if is_manga(r)]
    for r in results:
        found_releases[r["token"]] = r
    return results


def coverage(r):
    return r["range"][1] - r["range"][0] + 1 if r["range"] else 0


def best_first(r):
    """French, then a release that will come, then the most tomes, then the most seeders."""
    return (LANG_ORDER[r["lang"]], r["seeders"] == 0, -coverage(r), -r["seeders"])


def public(r):
    return {k: v for k, v in r.items() if not k.startswith("_")}


def group_releases(results):
    """{AniList id or name: [releases]}: one group per series, whatever the release calls it."""
    names = sorted({r["series"] for r in results})
    facts = lookups(names)
    groups = {}
    for r in results:
        meta = facts.get(r["series"]) or {}
        groups.setdefault(meta.get("id") or norm(r["series"]), []).append(r)
    return groups, facts


def search(query):
    """The series found for query, each with its releases, the best one first."""
    results = find_releases(query)
    groups, facts = group_releases(results)
    have = {norm(n): n for n in library_names()}
    out = []
    for releases in groups.values():
        releases.sort(key=best_first)
        meta = facts.get(releases[0]["series"]) or {}
        name = owned_name(releases, meta, have)
        out.append({"name": name, "meta": meta, "owned": name in have.values(), "releases": [public(r) for r in releases]})
    out.sort(key=lambda g: (LANG_ORDER[g["releases"][0]["lang"]], -sum(r["seeders"] for r in g["releases"])))
    return out


def owned_name(releases, meta, have):
    """The folder a group goes to: the series already in the library under one of its
    names, or else the name the best release gives it."""
    for r in releases:
        if norm(r["series"]) in have:
            return have[norm(r["series"])]
    for state_name, entry in load_state()["series"].items():
        if meta.get("id") and entry.get("anilist") == meta.get("id"):
            return state_name
    return safe_name(releases[0]["series"])


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


def grab(token, series, follow=False, query=""):
    r = found_releases.get(token)
    if not r:
        raise KeyError("search again: this result is no longer known")
    series = safe_name(series or r["series"])
    folder = hashlib.sha1(token.encode()).hexdigest()[:10]
    args = torrent_source(r["_url"])
    args["download-dir"] = f"{TRANSMISSION_INCOMING}/{folder}"
    added = rpc("torrent-add", args)
    t = added.get("torrent-added") or added.get("torrent-duplicate")
    meta = lookup(series)

    def note(state):
        state["downloads"][t["hashString"]] = {"series": series, "title": r["title"], "folder": folder, "range": r["range"], "at": time.time()}
        entry = series_entry(state, series)
        entry["anilist"] = meta.get("id") or entry.get("anilist")
        if follow:
            entry.update(follow=True, query=query or entry.get("query") or series)
    update_state(note)
    if follow:
        complete_later(series)
    return {"series": series, "hash": t["hashString"]}


def set_follow(series, on):
    def change(state):
        series_entry(state, series)["follow"] = bool(on)
    update_state(change)
    if on:
        complete_later(series)


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


def owned_numbers(dest):
    return {volume_number(p.name) for p in dest.iterdir() if p.is_file()} - {None} if dest.exists() else set()


def import_download(source, series):
    """Moves every volume found under source into MANGA/series, leaving out the tomes
    already there (a pack often repeats them). Returns how many came in."""
    dest = MANGA / series
    owned = owned_numbers(dest)
    dest.mkdir(parents=True, exist_ok=True)
    count = 0
    files = sorted((p for p in source.rglob("*") if p.is_file()), key=lambda p: natural(str(p)))
    for p in files:
        ext = p.suffix.lower()
        if ext not in KEPT + ARCHIVES or volume_number(p.name) in owned:
            continue
        name = p.name if ext in (".cbz", ".pdf", ".epub") else p.stem + ".cbz"
        if ext in ARCHIVES:
            unpack_archive(p, free_name(dest, name))
        else:
            shutil.move(str(p), free_name(dest, name))
        count += 1
    if not count and not any(p.suffix.lower() in KEPT + ARCHIVES for p in files):
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


# ---------- following: new volumes of a series, fetched by themselves ----------

def tomes_of(r):
    lo, hi = r["range"] or (0, -1)
    return set(range(lo, hi + 1))


def coming_tomes(series, state):
    """The tomes of a series already on their way."""
    coming = set()
    for d in state["downloads"].values():
        if d["series"] == series and d.get("range"):
            coming |= set(range(d["range"][0], d["range"][1] + 1))
    return coming


def cost(r, need):
    """What one missing tome costs through release r: its share of the size, plus a
    fixed price per torrent (fewer, bigger packs) and more for slow ones."""
    per_tome = (r["size"] + 300e6) / len(tomes_of(r) & need)
    return per_tome * (1.5 if r["seeders"] < 3 else 1)


def plan(series, releases, state, total=None):
    """The releases to download so that the series has every tome from 1 to the last
    one out (the most AniList counts or a French release holds): each pick is the
    cheapest per missing tome (see cost), until nothing more helps.
    Returns (releases, tomes still nowhere to be found)."""
    french = [r for r in releases if r["lang"] == "FR" and r["range"]]
    usable = [r for r in french if r["seeders"] > 0]
    # a tome out with nobody sharing it yet still counts as out
    last = max([total or 0] + [r["range"][1] for r in french])
    have = {int(n) for n in owned_numbers(MANGA / series)} | coming_tomes(series, state)
    need = set(range(1, last + 1)) - have
    picks = []
    while need:
        helpful = [r for r in usable if tomes_of(r) & need]
        if not helpful:
            break
        best = min(helpful, key=lambda r: cost(r, need))
        picks.append(best)
        need -= tomes_of(best)
        usable.remove(best)
    return prune(picks, set(range(1, last + 1)) - have), sorted(need)


def prune(picks, wanted):
    """Drops the picks whose missing tomes the others bring anyway, the heaviest
    first: a cheap first pick can be made useless by a bigger later one."""
    kept = list(picks)
    for p in sorted(picks, key=lambda r: -r["size"]):
        others = set().union(*(tomes_of(r) for r in kept if r is not p))
        if tomes_of(p) & wanted <= others:
            kept.remove(p)
    return kept


COLOUR = re.compile(r"(?i)\b(en )?couleurs?\b|\bcolou?r(ed)?\b|カラー")


def same_series(r, series, entry, facts):
    """Whether a release belongs to a series: same name, or same AniList entry but
    not a colour edition of it (unless the series is the colour one)."""
    if norm(r["series"]) == norm(series):
        return True
    meta = facts.get(r["series"]) or {}
    if not entry.get("anilist") or meta.get("id") != entry.get("anilist"):
        return False
    return bool(COLOUR.search(series)) or not COLOUR.search(r["title"])


def complete(series):
    """Downloads every missing tome of a series that can be found. Returns the
    releases sent and the tomes nobody has."""
    state = load_state()
    entry = state["series"].get(series, {})
    releases = find_releases(entry.get("query") or series)
    facts = lookups(sorted({r["series"] for r in releases}))
    mine = [r for r in releases if same_series(r, series, entry, facts)]
    total = (state["lookups"].get(norm(series)) or {}).get("volumes")
    picks, nowhere = plan(series, mine, state, total)
    for r in picks:
        print(f"complete: {series} ← {r['title']}", flush=True)
        grab(r["token"], series)
    return {"sent": [{"title": r["title"], "range": r["range"]} for r in picks], "nowhere": nowhere}


def complete_later(series):
    threading.Thread(target=safe_complete, args=(series,), daemon=True).start()


def safe_complete(series):
    try:
        complete(series)
    except Exception as e:
        print(f"complete {series}:", e, flush=True)


def check_follows():
    """Keeps every followed series complete: missing tomes and new ones."""
    for series, entry in load_state()["series"].items():
        if entry.get("follow"):
            safe_complete(series)

    def stamp(s):
        s["followed_at"] = time.time()
    update_state(stamp)


def follows_due():
    return time.time() - load_state().get("followed_at", 0) >= FOLLOW_EVERY


def tick():
    check_downloads()
    if follows_due():
        check_follows()


def watch():
    while True:
        try:
            tick()
        except Exception as e:  # Transmission restarting, a disk hiccup: try again later
            print("watch:", e, flush=True)
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


def library_names():
    if not MANGA.exists():
        return []
    return [d.name for d in MANGA.iterdir() if d.is_dir() and not d.name.startswith(".") and volumes(d)]


def series_info(d, state):
    vols = [volume_info(v, state["progress"]) for v in volumes(d)]
    entry = state["series"].get(d.name, {})
    meta = state["lookups"].get(norm(d.name)) or {}
    numbers = {int(v["number"]) for v in vols if v["number"]}
    last = max([meta.get("volumes") or 0] + list(numbers))
    coming = coming_tomes(d.name, state)
    return {
        "name": d.name,
        "volumes": vols,
        "read": sum(v["done"] for v in vols),
        "new": sum(v["new"] for v in vols),
        "follow": entry.get("follow", False),
        "meta": meta,
        "missing": [n for n in range(1, last + 1) if n not in numbers and n not in coming],
        "coming": sorted(coming),
    }


def series_list(state):
    dirs = sorted((MANGA / n for n in library_names()), key=lambda d: natural(d.name))
    return [series_info(d, state) for d in dirs]


def volume_info(path, progress):
    vid = volume_id(path)
    p = progress.get(vid, {})
    readable = path.suffix.lower() in READABLE
    return {
        "id": vid,
        "label": volume_label(path.name),
        "number": volume_number(path.name),
        "file": path.name,
        "readable": readable,
        "page": p.get("page", 0),
        "pages": p.get("pages", 0),
        "done": bool(p.get("pages")) and p.get("page", 0) >= p["pages"] - 1,
        "new": not p and time.time() - path.stat().st_mtime < NEW_FOR,
        "at": p.get("at", 0),
    }


def library():
    state = load_state()
    series = series_list(state)
    live = {t["hashString"]: t for t in safe_torrents(list(state["downloads"]))}
    downloads = [download_info(h, d, live.get(h)) for h, d in state["downloads"].items()]
    for d in downloads:
        d["cover"] = (state["lookups"].get(norm(d["series"])) or {}).get("cover")
    return {"series": series, "downloads": downloads, "last": last_read(series)}


def safe_torrents(hashes):
    try:
        return torrents(hashes)
    except Exception:
        return []


def download_info(torrent_hash, d, t):
    info = {"hash": torrent_hash, "series": d["series"], "title": d["title"], "range": d.get("range"), "pct": 0, "state": "unknown"}
    if t:
        info["pct"] = round(t["percentDone"] * 100)
        info["eta"] = t.get("eta", -1)
        info["state"] = "error" if t.get("error") else "done" if t["percentDone"] >= 1 else "downloading"
        info["error"] = t.get("errorString", "")
    return info


def last_read(series):
    vols = [dict(v, series=s["name"], meta=s["meta"]) for s in series for v in s["volumes"] if v["at"]]
    return max(vols, key=lambda v: v["at"]) if vols else None


def refresh_meta():
    """Asks AniList about the series of the library it has not been asked about yet."""
    state = load_state()
    names = set(library_names()) | {d["series"] for d in state["downloads"].values()}
    missing = sorted(n for n in names if norm(n) not in state["lookups"])
    found = lookups(missing)

    def keep(state):
        for name, meta in found.items():
            if meta.get("id"):
                series_entry(state, name).setdefault("anilist", meta["id"])
    update_state(keep)


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
    new = sum(s["new"] for s in lib["series"])
    return {"series": len(lib["series"]), "volumes": vols, "new": new, "downloads": lib["downloads"], "last": lib["last"]}


# ---------- HTTP ----------

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
         ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
         ".avif": "image/avif", ".pdf": "application/pdf", ".epub": "application/epub+zip", ".woff2": "font/woff2"}


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
    h.send(200, grab(b["token"], b.get("series", ""), b.get("follow", False), b.get("query", "")))


def post_follow(h):
    b = h.body()
    set_follow(b["series"], b["follow"])
    h.send(200, {"ok": True})


def post_progress(h):
    b = h.body()
    save_progress(b["vol"], b["page"], b["count"])
    h.send(200, {"ok": True})


def post_complete(h):
    h.send(200, complete(h.body()["series"]))


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
POST_ROUTES = {"/api/grab": post_grab, "/api/follow": post_follow, "/api/complete": post_complete, "/api/progress": post_progress, "/api/cancel": post_cancel}


def main():
    MANGA.mkdir(parents=True, exist_ok=True)
    INCOMING.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=refresh_meta, daemon=True).start()
    threading.Thread(target=watch, daemon=True).start()
    print(f"Ohara on port {PORT}, library in {MANGA}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
