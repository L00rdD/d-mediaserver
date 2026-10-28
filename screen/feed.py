"""Feed of the living-room screen: what plays on Jellyfin, what the house does
(Bifrost: lamps, projection screen, projector), what finished downloading, the
latest One Piece scan, Draupnir, the disks. Written to /status/screen.json every
few seconds; Errol (https://github.com/L00rdD/errol), the screen's renderer,
reads it through the home page (/screen.json) and turns every change into a scene. Python standard
library only.

Changes become events: a lamp switched, the projection screen moving, the
projector turned on or switching app, a torrent finished, Radarr or Sonarr
importing a film or an episode, a new scan. The first pass only records the
state, so a restart does not replay the past.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = os.environ.get("OUT", "/status/screen.json")
JELLYFIN = os.environ.get("JELLYFIN_URL", "http://jellyfin:8096")
JELLYFIN_KEY = os.environ.get("JELLYFIN_API_KEY", "")
JELLYFIN_USER = os.environ.get("JELLYFIN_USER", "")   # whose items to resume; the first user when empty
BIFROST = os.environ.get("BIFROST_URL", "http://host.docker.internal:8582/api/status.json")
DRAUPNIR = os.environ.get("DRAUPNIR_URL", "http://host.docker.internal:8080/api/status.json")
TRANSMISSION = os.environ.get("TRANSMISSION_URL", "http://gluetun:9091/transmission/rpc")
RADARR = os.environ.get("RADARR_URL", "http://radarr:7878")
SONARR = os.environ.get("SONARR_URL", "http://sonarr:8989")
STATUS = os.environ.get("STATUS_DIR", "/status")
SETTINGS = os.path.join(STATUS, "screen-settings.json")
SETTINGS_PORT = int(os.environ.get("SETTINGS_PORT", "8584"))
LOOKS = {"friday", "cyberpunk", "hogwarts"}
TICK = 3                 # seconds between two passes
SLOW = 30                # seconds between two passes on the slow sources
KEEP_EVENTS = 30


def now():
    return datetime.now(timezone.utc).astimezone()


def get(url, headers=None, data=None, timeout=5):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def api_key(app):
    try:
        with open(f"/config/{app}/config.xml") as f:
            m = re.search(r"<ApiKey>([^<]+)</ApiKey>", f.read())
            return m.group(1) if m else ""
    except OSError:
        return ""


def read_status(name):
    try:
        with open(os.path.join(STATUS, name)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# ---------- sources ----------

def video(it, position_ticks):
    """A Jellyfin video as the screens show it."""
    episode = it.get("Type") == "Episode"
    backdrop = it["Id"] if it.get("BackdropImageTags") else it.get("ParentBackdropItemId") or it.get("SeriesId")
    return {
        "id": it["Id"],
        "type": "episode" if episode else "movie",
        "title": it.get("Name"),
        "series": it.get("SeriesName") if episode else None,
        "season": it.get("ParentIndexNumber") if episode else None,
        "episode": it.get("IndexNumber") if episode else None,
        "year": it.get("ProductionYear"),
        "overview": (it.get("Overview") or "")[:400],
        "genres": it.get("Genres", [])[:3],
        "runtime": round((it.get("RunTimeTicks") or 0) / 1e7),
        "position": round((position_ticks or 0) / 1e7),
        "poster": f"/Items/{it.get('SeriesId') if episode and it.get('SeriesId') else it['Id']}/Images/Primary",
        "backdrop": f"/Items/{backdrop}/Images/Backdrop" if backdrop else None,
    }


def jellyfin():
    """Videos playing now, one entry per session."""
    if not JELLYFIN_KEY:
        return []
    out = []
    for s in get(f"{JELLYFIN}/Sessions?ActiveWithinSeconds=120", {"X-Emby-Token": JELLYFIN_KEY}):
        it = s.get("NowPlayingItem")
        if not it or it.get("MediaType") != "Video":
            continue
        ps = s.get("PlayState") or {}
        out.append({
            **video(it, ps.get("PositionTicks")),
            "paused": bool(ps.get("IsPaused")),
            "device": s.get("DeviceName"),
            "client": s.get("Client"),
            "user": s.get("UserName"),
        })
    return out


def jellyfin_resume():
    """Videos left halfway, the most recent first: the projector's home screen offers to resume them."""
    if not JELLYFIN_KEY:
        return []
    headers = {"X-Emby-Token": JELLYFIN_KEY}
    users = get(f"{JELLYFIN}/Users", headers)
    user = next((u for u in users if u.get("Name") == JELLYFIN_USER), users[0] if users else None)
    if not user:
        return []
    items = get(f"{JELLYFIN}/Users/{user['Id']}/Items/Resume?Limit=5&MediaTypes=Video&Fields=Overview,Genres", headers)
    return [video(it, (it.get("UserData") or {}).get("PlaybackPositionTicks")) for it in items.get("Items", [])]


_tr_session = ""


def transmission():
    global _tr_session
    body = json.dumps({"method": "torrent-get", "arguments": {
        "fields": ["id", "name", "percentDone", "status", "rateDownload", "eta", "totalSize", "doneDate"]}}).encode()
    for _ in range(2):
        try:
            return get(TRANSMISSION, {"X-Transmission-Session-Id": _tr_session, "Content-Type": "application/json"}, body)["arguments"]["torrents"]
        except urllib.error.HTTPError as e:
            if e.code != 409:
                raise
            _tr_session = e.headers.get("X-Transmission-Session-Id", "")
    return []


def imports(app, key, url):
    """Last films (Radarr) or episodes (Sonarr) imported into the library."""
    if not key:
        return []
    extra = "includeMovie=true" if app == "radarr" else "includeSeries=true&includeEpisode=true"
    recs = get(f"{url}/api/v3/history?pageSize=10&sortKey=date&sortDirection=descending&eventType=3&{extra}", {"X-Api-Key": key})["records"]
    out = []
    for r in recs:
        media = r.get("movie") or r.get("series") or {}
        poster = next((i.get("remoteUrl") for i in media.get("images", []) if i.get("coverType") == "poster"), None)
        fanart = next((i.get("remoteUrl") for i in media.get("images", []) if i.get("coverType") == "fanart"), None)
        e = r.get("episode") or {}
        out.append({
            "id": f"{app}-{r['id']}",
            "media": "movie" if app == "radarr" else "episode",
            "title": media.get("title"),
            "year": media.get("year"),
            "season": e.get("seasonNumber"),
            "episode": e.get("episodeNumber"),
            "episode_title": e.get("title"),
            "quality": ((r.get("quality") or {}).get("quality") or {}).get("name"),
            "poster": poster.replace("/original/", "/w342/") if poster else None,
            "fanart": fanart.replace("/original/", "/w780/") if fanart else None,
            "at": r.get("date"),
        })
    return out


def draupnir():
    d = get(DRAUPNIR)
    eq, init = d.get("equity") or 0, d.get("initial_cash") or 0
    return {
        "name": "Draupnir",
        "mode": d.get("mode"),
        "equity": round(eq, 2),
        "initial": init,
        "change": round((eq - init) / init * 100, 2) if init else None,
        "trades": d.get("trades"),
        "positions": [{"pair": p, "amount": v.get("amount"), "avg": v.get("avg_price"), "price": (d.get("prices") or {}).get(p)}
                      for p, v in (d.get("positions") or {}).items()],
        "updated_at": d.get("updated_at"),
    }


def tidy_house(house):
    """Bifrost's lists, with an unknown on/off (null, e.g. right after a reboot) as off."""
    out = {k: [dict(item) for item in house.get(k) or []] for k in ("outlets", "covers", "projectors")}
    for item in out["outlets"] + out["projectors"]:
        item["on"] = bool(item.get("on"))
    return out


def recent(items, n=6):
    """Latest imports, one per film or series."""
    out, titles = [], set()
    for x in sorted(items, key=lambda x: x.get("at") or "", reverse=True):
        if x.get("title") not in titles:
            titles.add(x.get("title"))
            out.append(x)
    return out[:n]


# ---------- settings: the screens' remote control ----------
# The home page's Errol card and the projector's home screen (Pensieve) read
# and change them (GET/POST /screen/settings, through Caddy); they go into
# screen.json, and Errol and Pensieve apply them live. look: the look of every
# screen, or None for each one's own default; follow_hub: the home page sets
# the look to its own whenever it is opened. The looks are those of
# home/site/theme/looks.json.

def load_settings():
    try:
        with open(SETTINGS) as f:
            saved = json.load(f)
    except (OSError, ValueError):
        saved = {}
    look = saved.get("look")
    return {"look": look if look in LOOKS else None, "follow_hub": bool(saved.get("follow_hub"))}


def save_settings(changes):
    settings = load_settings()
    if "look" in changes:
        if changes["look"] is not None and changes["look"] not in LOOKS:
            raise ValueError(f"unknown look {changes['look']!r}")
        settings["look"] = changes["look"]
    if "follow_hub" in changes:
        settings["follow_hub"] = bool(changes["follow_hub"])
    tmp = SETTINGS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(settings, f)
    os.replace(tmp, SETTINGS)
    return settings


class SettingsHandler(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/") != "/screen/settings":
            return self.reply(404, {"error": "not found"})
        self.reply(200, load_settings())

    def do_POST(self):
        if self.path.rstrip("/") != "/screen/settings":
            return self.reply(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 1024)
            changes = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(changes, dict):
                raise ValueError("expected an object")
            self.reply(200, save_settings(changes))
        except ValueError as error:
            self.reply(400, {"error": str(error)})

    def log_message(self, *args):
        pass


def serve_settings():
    server = ThreadingHTTPServer(("", SETTINGS_PORT), SettingsHandler)
    threading.Thread(target=server.serve_forever, name="settings", daemon=True).start()


# ---------- events ----------

class Feed:
    def __init__(self):
        self.events = []
        self.seen = None          # previous state, None before the first pass
        self.slow_at = 0
        self.slow = {}
        self.radarr_key = api_key("radarr")
        self.sonarr_key = api_key("sonarr")
        self.n = 0

    def emit(self, kind, **data):
        self.n += 1
        self.events.append({"id": f"{int(time.time())}-{self.n}", "kind": kind, "at": now().isoformat(timespec="seconds"), **data})
        self.events = self.events[-KEEP_EVENTS:]

    def safe(self, name, fn, default=None):
        try:
            return fn()
        except Exception as e:     # one dead source must not stop the screen
            self.errors[name] = f"{type(e).__name__}: {e}"[:160]
            return default

    def tick(self):
        self.errors = {}
        t = time.time()
        if t - self.slow_at >= SLOW:
            self.slow_at = t
            self.slow = {
                "radarr": self.safe("radarr", lambda: imports("radarr", self.radarr_key, RADARR), self.slow.get("radarr", [])),
                "sonarr": self.safe("sonarr", lambda: imports("sonarr", self.sonarr_key, SONARR), self.slow.get("sonarr", [])),
                "draupnir": self.safe("draupnir", draupnir, self.slow.get("draupnir")),
                "resume": self.safe("resume", jellyfin_resume, self.slow.get("resume", [])),
            }
        playing = self.safe("jellyfin", jellyfin, [])
        house = self.safe("bifrost", lambda: get(BIFROST), None)
        torrents = self.safe("transmission", transmission, None)
        kpiece = read_status("kpiece.json")
        disk = read_status("disk.json")
        services = read_status("services.json") or []

        state = {
            "outlets": {o["id"]: o for o in (house or {}).get("outlets", [])},
            "covers": {c["id"]: c for c in (house or {}).get("covers", [])},
            "projectors": {p["id"]: p for p in (house or {}).get("projectors", [])},
            "done": {x["id"]: x for x in (torrents or []) if x.get("percentDone") == 1},
            "imports": {x["id"] for x in self.slow.get("radarr", []) + self.slow.get("sonarr", [])},
            "scan": ((kpiece or {}).get("latest") or {}).get("scan"),
            "playing": {p["id"] for p in playing},
        }
        prev = self.seen
        if prev is not None:
            if house is not None:
                for k, o in state["outlets"].items():
                    if k in prev["outlets"] and o.get("on") != prev["outlets"][k].get("on"):
                        self.emit("light", name=o.get("name"), on=o.get("on"))
                for k, c in state["covers"].items():
                    p = prev["covers"].get(k)
                    if p and c.get("moving") and not p.get("moving"):
                        self.emit("cover", name=c.get("name"), cover=k, target=c.get("target"), moving=c.get("moving"))
                for k, pr in state["projectors"].items():
                    p = prev["projectors"].get(k)
                    if p and pr.get("on") != p.get("on"):
                        self.emit("projector", name=pr.get("name"), on=pr.get("on"), app=pr.get("app"))
                    elif p and pr.get("on") and pr.get("app") != p.get("app") and pr.get("app"):
                        self.emit("projector", name=pr.get("name"), on=True, app=pr.get("app"))
            if torrents is not None:
                for k, x in state["done"].items():
                    if k not in prev["done"]:
                        self.emit("download", name=x.get("name"), size=x.get("totalSize"))
            for x in self.slow.get("radarr", []) + self.slow.get("sonarr", []):
                if x["id"] not in prev["imports"]:
                    self.emit("import", **{k: v for k, v in x.items() if k != "id"})
            if state["scan"] and prev["scan"] and state["scan"] != prev["scan"]:
                self.emit("scan", **(kpiece.get("latest") or {}))
            for p in playing:
                if p["id"] not in prev["playing"]:
                    self.emit("play", title=p["title"], series=p["series"], season=p["season"], episode=p["episode"], device=p["device"])
        # keep what a dead source last said, so it does not fire again when it comes back
        if prev is not None:
            if house is None:
                for k in ("outlets", "covers", "projectors"):
                    state[k] = prev[k]
            if torrents is None:
                state["done"] = prev["done"]
        self.seen = state

        return {
            "updated_at": now().isoformat(timespec="seconds"),
            "playing": playing,
            "resume": self.slow.get("resume", []),
            "events": self.events,
            "house": house and tidy_house(house),
            "downloads": [{"name": x["name"], "percent": round(x["percentDone"] * 100, 1), "rate": x.get("rateDownload"), "eta": x.get("eta")}
                          for x in (torrents or []) if x.get("percentDone", 1) < 1][:6],
            "recent": recent(self.slow.get("radarr", []) + self.slow.get("sonarr", [])),
            "one_piece": kpiece,
            "portfolio": self.slow.get("draupnir"),
            "disk": disk,
            "services": {"up": sum(1 for s in services if s.get("state") == "running"), "total": len(services)},
            "settings": load_settings(),
            "errors": self.errors,
        }


def main():
    serve_settings()
    feed = Feed()
    while True:
        started = time.time()
        data = feed.tick()
        tmp = OUT + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, OUT)
        time.sleep(max(0.5, TICK - (time.time() - started)))


if __name__ == "__main__":
    main()
