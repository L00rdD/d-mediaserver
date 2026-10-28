"""Feed of the living-room screen: what plays on Jellyfin, what the house does
(Bifrost: lamps, projection screen, projector), what finished downloading, the
latest One Piece scan, Draupnir, the disks, and the Claude Code sessions of
the Mac when Cerebro answers. Written to /status/screen.json every
few seconds; Errol (https://github.com/L00rdD/errol), the screen's renderer,
reads it through the home page (/screen.json) and turns every change into a scene.
The same document is pushed as it changes on /screen/events (Server-Sent Events,
through Caddy), so Errol, Pensieve and the home page see a change at the same
instant instead of asking every few seconds. Python standard library only.

Changes become events: a lamp switched, the projection screen moving, the
projector turned on or switching app, a torrent finished, Radarr or Sonarr
importing a film or an episode, a new scan, a Claude Code session waiting
for an answer (Cerebro). The first pass only records the
state, so a restart does not replay the past.
"""
import json
import os
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
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
# Cerebro, on the Mac: its phone page's address (http://<the Mac's ZeroTier or local IP>:4243)
# and the key of its link (~/.cerebro/mobile-key). Without them, or while the Mac sleeps,
# screen.json has no "cerebro".
CEREBRO = os.environ.get("CEREBRO_URL", "").rstrip("/")
CEREBRO_KEY = os.environ.get("CEREBRO_KEY", "")
STATUS = os.environ.get("STATUS_DIR", "/status")
SETTINGS = os.path.join(STATUS, "screen-settings.json")
SETTINGS_PORT = int(os.environ.get("SETTINGS_PORT", "8584"))
LOOKS = {"friday", "cyberpunk", "hogwarts"}
TICK = 3                 # seconds between two passes
HEARTBEAT = 30           # seconds between two pushes of an unchanged document
KEEPALIVE = 15           # seconds between two comments on a quiet event stream
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


def cerebro_catalog():
    """Cerebro's manifests: its rooms and characters by id, as its panel draws them."""
    rooms = get(f"{CEREBRO}/rooms/rooms.json", timeout=2)
    characters = get(f"{CEREBRO}/characters/characters.json", timeout=2)
    return {
        "room_size": [rooms.get("frameWidth", 192), rooms.get("frameHeight", 120)],
        "character_size": [characters.get("frameWidth", 24), characters.get("frameHeight", 24)],
        "rooms": {r["id"]: r for r in rooms.get("rooms") or [] if "id" in r},
        "characters": {c["id"]: c for c in characters.get("characters") or [] if "id" in c},
    }


def cerebro_snapshot():
    """Cerebro's latest snapshot; None when the Mac does not answer (asleep, away) or has none yet."""
    try:
        req = urllib.request.Request(f"{CEREBRO}/api/snapshot?key={urllib.parse.quote(CEREBRO_KEY)}")
        with urllib.request.urlopen(req, timeout=2) as r:
            return json.load(r) if r.status == 200 else None
    except urllib.error.HTTPError:
        raise                    # it answers, but refuses: a wrong key is worth an error
    except (OSError, ValueError):
        return None


ORDER = {"waiting": 0, "busy": 1}
# How the lead of a session stands, by status, as in Cerebro's panel; subagents always walk
LEAD_STATE = {"busy": "walking", "idle": "asleep"}
# Cerebro's pictures, through the home page (home/Caddyfile): the screens never need the key
SPRITES = "/cerebro/"


def cerebro(snapshot, catalog):
    """The sessions as the screens show them, those waiting for an answer first, then those
    working; each with its scene, all Cerebro's panel needs to draw it: the room's sprite
    sheet and its floor, and every actor with its sprite, its way of moving and its power."""
    rooms, characters = catalog.get("rooms", {}), catalog.get("characters", {})
    home = re.compile(r"^/(Users|home)/[^/]+")
    sessions = []
    for s in snapshot.get("scenes") or []:
        actors = s.get("actors") or []
        room = rooms.get(s.get("room")) or next(iter(rooms.values()), None)
        status = s.get("status")
        cast = []
        for index, a in enumerate(actors):
            c = characters.get(a.get("character"))
            if not c:
                continue
            cast.append({
                "id": a.get("id"),
                "name": c.get("name"),
                "sprite": SPRITES + c["sprite"],
                "move": c.get("move") or "walk",
                "power": c.get("power") or "glow",
                "color": c.get("powerColor") or c.get("aura") or "#FFFFFF",
                "aura": c.get("aura"),
                "state": LEAD_STATE.get(status, "alert") if index == 0 else "walking",
            })
        lead = actors[0].get("character") if actors else None
        since = s.get("statusSince")
        sessions.append({
            "id": s.get("id"),
            "name": s.get("name"),
            "project": home.sub("~", s.get("cwd") or "") or None,
            "status": status,
            "since": datetime.fromtimestamp(since / 1000, timezone.utc).astimezone().isoformat(timespec="seconds") if since else None,
            "room": (room or {}).get("name") or s.get("room"),
            "lead": (characters.get(lead) or {}).get("name") or lead,
            "agents": max(len(actors) - 1, 0),
            "scene": room and {
                "room": {
                    "sprite": SPRITES + room["sprite"],
                    "frames": room.get("frames", 1),
                    "fps": room.get("fps", 8),
                    "walk": room.get("walkArea"),
                },
                "actors": cast,
            },
        })
    sessions.sort(key=lambda s: (ORDER.get(s["status"], 2), s["name"] or ""))
    return {
        "sessions": sessions,
        "busy": sum(1 for s in sessions if s["status"] == "busy"),
        "waiting": sum(1 for s in sessions if s["status"] == "waiting"),
        "room_size": catalog.get("room_size", [192, 120]),
        "character_size": catalog.get("character_size", [24, 24]),
        "emotes": SPRITES + "ui/emotes.png",
        # the phone page, for the home page's card; the key only lets one read the sessions
        "link": f"{CEREBRO}/?key={urllib.parse.quote(CEREBRO_KEY)}",
    }


# ---------- the event stream ----------
# Whoever asks /screen/events gets the document at once, then again each time
# it changes (and every HEARTBEAT seconds anyway); a comment line every
# KEEPALIVE seconds keeps a quiet connection open through the proxy.

class Broadcast:
    def __init__(self):
        self.lock = threading.Lock()
        self.listeners = set()
        self.latest = None       # the document as last written, as text
        self.doc = None          # ...and as a dict, for a settings change

    def publish(self, doc):
        text = json.dumps(doc, ensure_ascii=False)
        with self.lock:
            self.doc, self.latest = doc, text
            listeners = list(self.listeners)
        for q in listeners:
            q.put(text)

    def subscribe(self):
        q = queue.Queue()
        with self.lock:
            self.listeners.add(q)
            if self.latest is not None:
                q.put(self.latest)
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.listeners.discard(q)


broadcast = Broadcast()


def write_out(doc):
    """Writes screen.json whole (a reader never sees half a file) and pushes it to the stream."""
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, ensure_ascii=False)
    os.replace(tmp, OUT)
    broadcast.publish(doc)


def changed(a, b):
    """Whether two documents differ in anything but their time stamp."""
    if a is None or b is None:
        return True
    return {k: v for k, v in a.items() if k != "updated_at"} != {k: v for k, v in b.items() if k != "updated_at"}


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
    # the screens learn of it now, not at the next pass
    with broadcast.lock:
        doc = dict(broadcast.doc) if broadcast.doc else None
    if doc is not None:
        doc["settings"] = settings
        write_out(doc)
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
        path = self.path.split("?")[0].rstrip("/")
        if path == "/screen/events":
            return self.stream()
        if path != "/screen/settings":
            return self.reply(404, {"error": "not found"})
        self.reply(200, load_settings())

    def stream(self):
        """The document now, then each time it changes, as Server-Sent Events, until the client goes."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        q = broadcast.subscribe()
        try:
            while True:
                try:
                    text = q.get(timeout=KEEPALIVE)
                    self.wfile.write(f"data: {text}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (OSError, ValueError):
            pass             # the client went away
        finally:
            broadcast.unsubscribe(q)

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
        self.cerebro_at = 0       # when to ask Cerebro again after the Mac did not answer
        self.cerebro_catalog = None
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

    def cerebro(self, t):
        """The Mac's Claude Code sessions, or None. A Mac that does not answer is asked
        again in SLOW seconds only, so its timeouts do not slow the screen down."""
        if not CEREBRO or t < self.cerebro_at:
            return None
        snapshot = cerebro_snapshot()
        if snapshot is None:
            self.cerebro_at = t + SLOW
            return None
        if self.cerebro_catalog is None:
            try:
                self.cerebro_catalog = cerebro_catalog()
            except (OSError, ValueError):
                pass             # no scenes, the ids for names, until the next pass
        return cerebro(snapshot, self.cerebro_catalog or {})

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
        claude = self.safe("cerebro", lambda: self.cerebro(t), None)
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
            "sessions": {x["id"]: x["status"] for x in (claude or {}).get("sessions", [])},
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
            if claude is not None:
                for x in claude["sessions"]:
                    if x["status"] == "waiting" and prev["sessions"].get(x["id"], "waiting") != "waiting":
                        self.emit("cerebro", **{k: x[k] for k in ("name", "project", "status", "room", "lead")})
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
            if claude is None:
                state["sessions"] = prev["sessions"]
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
            "cerebro": claude,
            "disk": disk,
            "services": {"up": sum(1 for s in services if s.get("state") == "running"), "total": len(services)},
            "settings": load_settings(),
            "errors": self.errors,
        }


def main():
    serve_settings()
    feed = Feed()
    pushed_at = 0
    while True:
        started = time.time()
        data = feed.tick()
        # the file is always written; the stream only hears of a change, or a heartbeat
        if changed(broadcast.doc, data) or started - pushed_at >= HEARTBEAT:
            write_out(data)
            pushed_at = started
        else:
            tmp = OUT + ".tmp"
            with open(tmp, "w") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, OUT)
        time.sleep(max(0.5, TICK - (time.time() - started)))


if __name__ == "__main__":
    main()
