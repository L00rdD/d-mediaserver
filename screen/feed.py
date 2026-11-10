"""Feed of the living-room screen: what plays on Jellyfin, what the house does
(Bifrost: lamps, projection screen, projector), what finished downloading, the
latest One Piece scan, Draupnir, the disks, the Claude Code sessions of
the Mac when Cerebro answers, the resin printer's print while it is on, the
weather (Open-Meteo, with WEATHER_LAT and WEATHER_LON), the next episodes to
watch (Jellyfin) and those airing today or tomorrow (Sonarr), and how many
times each thing happened since midnight.
Written to /status/screen.json every few seconds; Errol (https://github.com/L00rdD/errol), the screen's renderer,
reads it through the home page (/screen.json) and turns every change into a scene.
The same document is pushed as it changes on /screen/events (Server-Sent Events,
through Caddy), so Errol, Pensieve and the home page see a change at the same
instant instead of asking every few seconds. Python standard library only.

Changes become events: a lamp switched, the projection screen moving, the
projector turned on or switching app, a torrent finished, Radarr or Sonarr
importing a film or an episode, a new scan, a Claude Code session waiting
for an answer (Cerebro), a print that starts, finishes or is cancelled. The
first pass only records the state, so a restart does not replay the past; so
does a source's first answer whenever it comes (one down at the start, back
later). A torrent sent by Radarr or Sonarr is no news when it finishes: its
import is. The projection screen going up on its own, a while after the
projector turned off, is no news either.
"""
import json
import os
import queue
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
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
# The house, for the weather (decimal degrees); without them screen.json has no "weather".
WEATHER_LAT = os.environ.get("WEATHER_LAT", "")
WEATHER_LON = os.environ.get("WEATHER_LON", "")
OPEN_METEO = os.environ.get("OPEN_METEO_URL", "https://api.open-meteo.com/v1/forecast")
STATUS = os.environ.get("STATUS_DIR", "/status")
SETTINGS = os.path.join(STATUS, "screen-settings.json")
TODAY = "screen-today.json"   # in STATUS: the day's counts, kept across a restart
SETTINGS_PORT = int(os.environ.get("SETTINGS_PORT", "8584"))
LOOKS = {"friday", "cyberpunk", "hogwarts"}
TICK = 3                 # seconds between two passes
HEARTBEAT = 30           # seconds between two pushes of an unchanged document
KEEPALIVE = 15           # seconds between two comments on a quiet event stream
SLOW = 30                # seconds between two passes on the slow sources
KEEP_EVENTS = 30
DONE_FRESH = 600         # seconds: a torrent done longer ago is no news (renumbered, re-added, checked again)
ASK_AGAIN = 600          # seconds before a Claude Code session waiting again is news again
QUIET_APPS = {"home", "screensaver"}   # the projector idling: no news
PRINTER_FRESH = 180      # seconds: an older printer.json means the printer service stopped
PREVIEW_KEEP = 3 * 3600  # seconds a print's preview link is kept: Anycubic's last 4 h, and change at each read
WEATHER_EVERY = 900      # seconds between two reads of the weather
RAIN_HOURS = 3           # hours ahead the chance of rain looks
AUTO_CLOSE = 60          # seconds around the hub's close of the screen in which it going up is no news
# Transmission categories of Radarr and Sonarr (their defaults): a label, or the last folder of the download
ARR_CATEGORIES = {"radarr", "sonarr", "tv-sonarr"}
# What each event adds to the day's counts (a light switched on, a print done only)
COUNTED = {"import": "imports", "download": "downloads", "play": "plays", "light": "lights",
           "print": "prints", "cerebro": "questions"}


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


FAILED = object()           # what a source that could not be read answers, to tell it from an empty answer


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
    headers = {"X-Emby-Token": JELLYFIN_KEY}
    user = jellyfin_user(headers)
    if not user:
        return []
    items = get(f"{JELLYFIN}/Users/{user['Id']}/Items/Resume?Limit=5&MediaTypes=Video&Fields=Overview,Genres", headers)
    return [video(it, (it.get("UserData") or {}).get("PlaybackPositionTicks")) for it in items.get("Items", [])]


def jellyfin_user(headers):
    """Whose videos the screens show: JELLYFIN_USER, else the first user; None without a key or a user."""
    if not JELLYFIN_KEY:
        return None
    users = get(f"{JELLYFIN}/Users", headers)
    return next((u for u in users if u.get("Name") == JELLYFIN_USER), users[0] if users else None)


def jellyfin_next_up():
    """The next episodes to watch, at most 3: Jellyfin's "next up"."""
    headers = {"X-Emby-Token": JELLYFIN_KEY}
    user = jellyfin_user(headers)
    if not user:
        return []
    items = get(f"{JELLYFIN}/Shows/NextUp?UserId={user['Id']}&Limit=3&Fields=Overview", headers)
    return [next_episode(it) for it in items.get("Items", [])][:3]


def next_episode(it):
    """An episode to watch, as the screens show it; the series' poster, through the home page."""
    return {
        "series": it.get("SeriesName") or it.get("Name"),
        "season": it.get("ParentIndexNumber"),
        "episode": it.get("IndexNumber"),
        "title": it.get("Name"),
        "poster": f"/Items/{it.get('SeriesId') or it['Id']}/Images/Primary",
    }


_tr_session = ""


def transmission():
    global _tr_session
    body = json.dumps({"method": "torrent-get", "arguments": {
        "fields": ["id", "hashString", "name", "percentDone", "status", "rateDownload", "eta", "totalSize", "doneDate",
                   "downloadDir", "labels"]}}).encode()
    for _ in range(2):
        try:
            return get(TRANSMISSION, {"X-Transmission-Session-Id": _tr_session, "Content-Type": "application/json"}, body)["arguments"]["torrents"]
        except urllib.error.HTTPError as e:
            if e.code != 409:
                raise
            _tr_session = e.headers.get("X-Transmission-Session-Id", "")
    # no list rather than an empty one: an empty one would make every torrent done news again
    raise OSError("transmission: no session")


def for_arr(torrent):
    """Whether Radarr or Sonarr sent the torrent: their category, as a label or as the
    last folder of its download directory."""
    folder = os.path.basename((torrent.get("downloadDir") or "").rstrip("/"))
    return folder in ARR_CATEGORIES or bool(ARR_CATEGORIES & set(torrent.get("labels") or []))


def imports(app, key, url):
    """Last films (Radarr) or episodes (Sonarr) imported into the library."""
    if not key:
        return []
    extra = "includeMovie=true" if app == "radarr" else "includeSeries=true&includeEpisode=true"
    recs = get(f"{url}/api/v3/history?pageSize=10&sortKey=date&sortDirection=descending&eventType=3&{extra}", {"X-Api-Key": key})["records"]
    return [history_entry(app, r) for r in recs]


def artwork(media, kind, size):
    """A picture of the film or series ("poster", "fanart"), at a smaller size; None when it has none."""
    url = next((i.get("remoteUrl") for i in media.get("images", []) if i.get("coverType") == kind), None)
    return url.replace("/original/", f"/{size}/") if url else None


def history_entry(app, r):
    """One import of Radarr's or Sonarr's history as the screens show it."""
    media = r.get("movie") or r.get("series") or {}
    e = r.get("episode") or {}
    return {
        "id": f"{app}-{r['id']}",
        "media": "movie" if app == "radarr" else "episode",
        "title": media.get("title"),
        "year": media.get("year"),
        "season": e.get("seasonNumber"),
        "episode": e.get("episodeNumber"),
        "episode_title": e.get("title"),
        "quality": ((r.get("quality") or {}).get("quality") or {}).get("name"),
        "poster": artwork(media, "poster", "w342"),
        "fanart": artwork(media, "fanart", "w780"),
        "at": r.get("date"),
    }


def airing(key, url, at):
    """Episodes that air today or tomorrow, at most 4, the soonest first: Sonarr's calendar."""
    if not key:
        return []
    midnight = at.replace(hour=0, minute=0, second=0, microsecond=0)
    span = [(midnight + timedelta(days=d)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") for d in (0, 2)]
    episodes = get(f"{url}/api/v3/calendar?start={span[0]}&end={span[1]}&includeSeries=true", {"X-Api-Key": key})
    episodes = sorted(episodes, key=lambda e: e.get("airDateUtc") or "")
    return [airing_episode(e) for e in episodes][:4]


def airing_episode(e):
    """An episode of Sonarr's calendar as the screens show it, with its series' poster."""
    series = e.get("series") or {}
    return {
        "series": series.get("title"),
        "season": e.get("seasonNumber"),
        "episode": e.get("episodeNumber"),
        "title": e.get("title"),
        "at": local_iso(e.get("airDateUtc")),
        "poster": artwork(series, "poster", "w342"),
    }


def local_iso(text):
    """An ISO time, as local ISO text with its offset; None without one or when unreadable."""
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone().isoformat(timespec="seconds")
    except (AttributeError, ValueError):
        return None


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


def weather():
    """The weather at the house, from Open-Meteo; None without WEATHER_LAT and WEATHER_LON."""
    if not (WEATHER_LAT and WEATHER_LON):
        return None
    query = urllib.parse.urlencode({
        "latitude": WEATHER_LAT, "longitude": WEATHER_LON, "timezone": "auto", "forecast_days": 2,
        "current": "temperature_2m,weather_code,wind_speed_10m",
        "daily": "temperature_2m_max,temperature_2m_min,sunrise,sunset",
        "hourly": "precipitation_probability",
    })
    return weather_of(get(f"{OPEN_METEO}?{query}", timeout=10))


def weather_of(w):
    """Open-Meteo's answer as the screens show it: now, today's highest and lowest, the chance of
    rain in the next RAIN_HOURS hours, and the sun; None without a temperature or a sky."""
    current, daily = w.get("current") or {}, w.get("daily") or {}
    if current.get("temperature_2m") is None or current.get("weather_code") is None:
        return None
    offset = timezone(timedelta(seconds=w.get("utc_offset_seconds") or 0))
    return {
        "temperature": current["temperature_2m"],
        "code": current["weather_code"],
        "wind": current.get("wind_speed_10m"),
        "high": first(daily, "temperature_2m_max"),
        "low": first(daily, "temperature_2m_min"),
        "rain": rain_soon(w.get("hourly") or {}, current.get("time") or ""),
        "sunrise": with_offset(first(daily, "sunrise"), offset),
        "sunset": with_offset(first(daily, "sunset"), offset),
    }


def first(daily, key):
    """Today's value of one of Open-Meteo's daily series; None when it has none."""
    values = daily.get(key) or [None]
    return values[0]


def rain_soon(hourly, current):
    """The highest chance of rain over the hour going on and the next ones, RAIN_HOURS in all;
    None when unknown. Open-Meteo's times are local and of the same form, so they compare as text."""
    hours = zip(hourly.get("time") or [], hourly.get("precipitation_probability") or [])
    ahead = [p for t, p in hours if t[:13] >= current[:13]][:RAIN_HOURS]
    chances = [p for p in ahead if p is not None]
    return max(chances) if chances else None


def with_offset(local, offset):
    """A local time without offset (Open-Meteo's, with timezone=auto), as ISO text with it."""
    try:
        return datetime.fromisoformat(local).replace(tzinfo=offset).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return None


def counter(kind, data):
    """The count of the day an event adds to; None for those not counted."""
    if kind == "light" and not data.get("on") or kind == "print" and data.get("phase") != "done":
        return None
    return COUNTED.get(kind)


def day_of(counts, at):
    """The day's counts, at zero again once the local date is no longer theirs."""
    date = at.date().isoformat()
    if isinstance(counts, dict) and counts.get("date") == date:
        return {"date": date, **{k: as_int(counts.get(k)) or 0 for k in COUNTED.values()}}
    return {"date": date, **dict.fromkeys(COUNTED.values(), 0)}


def save_today(counts):
    """Keeps the day's counts in STATUS, so a restart does not lose them."""
    path = os.path.join(STATUS, TODAY)
    try:
        with open(path + ".tmp", "w") as f:
            json.dump(counts, f)
        os.replace(path + ".tmp", path)
    except OSError:
        pass                     # counted all the same, only not kept


def tidy_house(house, seen=None):
    """Bifrost's lists, with an unknown on/off (null: adb unanswered, a reboot) as it was last
    known, else off, and the projector's app under its name."""
    out = {k: [dict(item) for item in house.get(k) or []] for k in ("outlets", "covers", "projectors")}
    for k in ("outlets", "projectors"):
        for item in out[k]:
            if item.get("on") is None:
                item["on"] = ((seen or {}).get(k, {}).get(item.get("id")) or {}).get("on")
            item["on"] = bool(item["on"])
    for item in out["projectors"]:
        item["app"] = app_name(item, item.get("app"))
    return out


def app_name(projector, package):
    """An app of the projector under the name the hub gives it (its "apps"); the package without one."""
    return next((a.get("name") for a in projector.get("apps") or [] if a.get("package") == package and a.get("name")),
                package)


def closing(projectors, cover, closes, at):
    """Whether the projection screen going up is the hub raising it on its own: its projector
    was due to close it within AUTO_CLOSE seconds of `at` (closes: when, by projector)."""
    for pid, p in projectors.items():
        due = closes.get(pid)
        if p.get("cover") == cover and due and abs((at - due).total_seconds()) <= AUTO_CLOSE:
            return True
    return False


def due_at(text):
    """When the hub will close the screen (its closes_at); None without one or when unreadable."""
    try:
        return datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None


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
# a session's folder, with the home folder shortened to ~
HOME = re.compile(r"^/(Users|home)/[^/]+")
# How the lead of a session stands, by status, as in Cerebro's panel; subagents always walk
LEAD_STATE = {"busy": "walking", "idle": "asleep"}
# Cerebro's pictures, through the home page (home/Caddyfile): the screens never need the key
SPRITES = "/cerebro/"


def cerebro_actor(a, c, lead, status):
    """One actor of a scene: its character's sprite, way of moving and power; the lead
    stands as its session does, the subagents walk."""
    return {
        "id": a.get("id"),
        "name": c.get("name"),
        "sprite": SPRITES + c["sprite"],
        "move": c.get("move") or "walk",
        "power": c.get("power") or "glow",
        "color": c.get("powerColor") or c.get("aura") or "#FFFFFF",
        "aura": c.get("aura"),
        "state": LEAD_STATE.get(status, "alert") if lead else "walking",
    }


def cerebro_cast(actors, characters, status):
    """The actors of a scene whose character Cerebro knows; the first is the session's lead."""
    cast = []
    for index, a in enumerate(actors):
        c = characters.get(a.get("character"))
        if c:
            cast.append(cerebro_actor(a, c, index == 0, status))
    return cast


def cerebro_scene(room, cast):
    """The room's sprite sheet and floor, and its actors; nothing without a room."""
    return room and {
        "room": {
            "sprite": SPRITES + room["sprite"],
            "frames": room.get("frames", 1),
            "fps": room.get("fps", 8),
            "walk": room.get("walkArea"),
        },
        "actors": cast,
    }


def local_time(ms):
    """A time in milliseconds since the epoch, as local ISO text; None without one."""
    return datetime.fromtimestamp(ms / 1000, timezone.utc).astimezone().isoformat(timespec="seconds") if ms else None


def cerebro_session(s, rooms, characters):
    """One Cerebro session as the screens show it, in its room (the first one when its own is unknown)."""
    actors = s.get("actors") or []
    room = rooms.get(s.get("room")) or next(iter(rooms.values()), None)
    status = s.get("status")
    lead = actors[0].get("character") if actors else None
    return {
        "id": s.get("id"),
        "name": s.get("name"),
        "project": HOME.sub("~", s.get("cwd") or "") or None,
        "status": status,
        "since": local_time(s.get("statusSince")),
        "room": (room or {}).get("name") or s.get("room"),
        "lead": (characters.get(lead) or {}).get("name") or lead,
        "agents": max(len(actors) - 1, 0),
        "scene": cerebro_scene(room, cerebro_cast(actors, characters, status)),
    }


def cerebro(snapshot, catalog):
    """The sessions as the screens show them, those waiting for an answer first, then those
    working; each with its scene, all Cerebro's panel needs to draw it: the room's sprite
    sheet and its floor, and every actor with its sprite, its way of moving and its power."""
    rooms, characters = catalog.get("rooms", {}), catalog.get("characters", {})
    sessions = [cerebro_session(s, rooms, characters) for s in snapshot.get("scenes") or []]
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


def as_int(value):
    return int(value) if isinstance(value, (int, float)) else None


def printer(status, at):
    """The resin printer and its print as the screens show it, from printer.json (the
    printer service); None while it is off, or when the service has not written for
    PRINTER_FRESH seconds: the home page's card hides then too. Without a cloud token
    the printer shows as on, with no print."""
    checked = printer_checked(status, at)
    if checked is None:
        return None
    job = status.get("job") or {}
    layer, layers = as_int(job.get("layer")), as_int(job.get("layers"))
    progress = print_progress(job, layer, layers)
    left = job.get("remaining_min") if job.get("active") else None
    return {
        "name": status.get("name") or "Anycubic",
        "cloud": status.get("cloud"),
        "state": job.get("state"),
        "active": bool(job.get("active")),
        # the slicer's names come decomposed (e + a combining accent): composed, the screens draw them whole
        "file": unicodedata.normalize("NFC", job.get("name") or "") or None,
        "progress": None if progress is None else round(progress, 1),
        "layer": layer,
        "layers": layers,
        "remaining": None if left is None else round(left * 60),       # seconds, as a download's eta
        "ends_at": None if left is None else (checked + timedelta(minutes=left)).astimezone().isoformat(timespec="seconds"),
        "started_at": job.get("started_at"),
        "height_mm": job.get("height_mm"),
        "resin_ml": job.get("resin_ml"),
        "image": preview(job),
    }


def printer_checked(status, at):
    """When the printer service last saw the printer on; None when it is off, or when
    that was more than PRINTER_FRESH seconds before `at`."""
    if not status or not status.get("online"):
        return None
    try:
        checked = datetime.fromisoformat(status["checked_at"])
    except (KeyError, TypeError, ValueError):
        return None
    return None if (at - checked).total_seconds() > PRINTER_FRESH else checked


def print_progress(job, layer, layers):
    """The cloud's progress, else the share of layers done; None when neither is known."""
    progress = job.get("progress")
    if progress is None and layers:
        progress = 100 * (layer or 0) / layers
    return progress


def preview(job):
    """The print's preview: the copy the printer service keeps next to printer.json
    (a path on the home page) once it is there, else Anycubic's own link."""
    if job.get("preview") and os.path.exists(os.path.join(STATUS, "printer.jpg")):
        return job["preview"]
    return job.get("image")


# states of a print before its first layer: going from one of them to printing starts it
PRINT_COMING = {"downloading", "checking", "preheating", "levelling", "slicing"}


def print_job(p):
    """What the events compare of the print: which job, and its state; None when not
    known (printer off, no cloud, a state the cloud does not name)."""
    if not p or p.get("state") in (None, "unknown"):
        return None
    return {"job": [p.get("file"), p.get("started_at")], "state": p["state"]}


def print_phase(before, now):
    """The step of the print worth an event, from one pass to the next: "started" when
    its first layers begin, "done" or "cancelled" when it ends; else None."""
    if not now:
        return None
    same = bool(before) and before["job"] == now["job"]
    if now["state"] == "printing":
        return None if same and before["state"] not in PRINT_COMING else "started"
    if now["state"] in ("done", "cancelled") and same and before["state"] != now["state"]:
        return now["state"]
    return None


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
# The home page's Errol card reads and changes them (GET/POST /screen/settings,
# through Caddy); they go into screen.json, and Errol applies them live. Each app
# picks its own look: Pensieve, the projector's home screen, ignores these.
# look: Errol's look, or None for its own default; follow_hub: the home page sets
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
        self.slow_reads = None    # the slow sources being read, behind the passes
        self.pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="source")
        self.radarr_key = api_key("radarr")
        self.sonarr_key = api_key("sonarr")
        self.cerebro_at = 0       # when to ask Cerebro again after the Mac did not answer
        self.cerebro_catalog = None
        self.preview = None       # (the print and its picture, the link kept, since when)
        self.n = 0
        self.asked = {}           # when each Claude Code session last made news by waiting
        self.heard = set()        # the sources that answered once: their first answer is no news
        self.slow_heard = set()   # ...those of the slow ones in their last read
        self.weather_at = 0       # when the weather last answered
        self.closes = {}          # when the hub closes the screen, by projector, as last announced
        self.today = day_of(read_status(TODAY), now())

    def emit(self, kind, **data):
        self.n += 1
        self.events.append({"id": f"{int(time.time())}-{self.n}", "kind": kind, "at": now().isoformat(timespec="seconds"), **data})
        self.events = self.events[-KEEP_EVENTS:]
        self.count(kind, data)

    def count(self, kind, data):
        """Adds an event to the day's counts, and keeps them."""
        key = counter(kind, data)
        if key:
            self.today = day_of(self.today, now())
            self.today[key] += 1
            save_today(self.today)

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

    def printer(self, t):
        """The printer while it is on. Anycubic signs its preview link anew at each read:
        the first link of a print's picture is kept for PREVIEW_KEEP seconds, so the
        screens do not fetch the same picture again every 20 s."""
        p = printer(read_status("printer.json"), now())
        if p and p["image"]:
            # the same picture of the same print, whatever the signature in the query
            same = (p["file"], p["started_at"], p["image"].split("?")[0])
            if self.preview and self.preview[0] == same and t - self.preview[2] < PREVIEW_KEEP:
                p["image"] = self.preview[1]
            else:
                self.preview = (same, p["image"], t)
        return p

    def read(self, t):
        """Every source, once and side by side: one that does not answer is None, and only
        holds the pass for its own timeout. The slow ones are read behind the passes and keep
        their last word until they answer, so they never hold the house back."""
        self.read_slow(t)
        fast = {
            "playing": ("jellyfin", jellyfin, []),
            "house": ("bifrost", lambda: get(BIFROST), None),
            "torrents": ("transmission", transmission, None),
            "claude": ("cerebro", lambda: self.cerebro(t), None),
            "printer": ("printer", lambda: self.printer(t), None),
        }
        running = {k: self.pool.submit(self.safe, *args) for k, args in fast.items()}
        return {
            **{k: f.result() for k, f in running.items()},
            "kpiece": read_status("kpiece.json"),
            "disk": read_status("disk.json"),
            "services": read_status("services.json") or [],
        }

    def read_slow(self, t):
        """Takes the slow sources' answers once they are all in, and asks again every SLOW seconds.
        The first pass waits for them: it records what is already there, so none of it is news."""
        if self.slow_reads is None and t - self.slow_at >= SLOW:
            self.slow_at = t
            self.slow_reads = self.pool.submit(self.slow_pass, dict(self.slow))
        if self.seen is None and self.slow_reads is not None:
            self.slow_reads.result()
        if self.slow_reads is not None and self.slow_reads.done():
            self.slow, self.slow_heard = self.slow_reads.result()
            self.slow_reads = None

    def slow_pass(self, last):
        """The slow sources, one after the other: each that fails keeps its last word. Also
        which of them answered."""
        reads = {
            "radarr": (lambda: imports("radarr", self.radarr_key, RADARR), []),
            "sonarr": (lambda: imports("sonarr", self.sonarr_key, SONARR), []),
            "draupnir": (draupnir, None),
            "resume": (jellyfin_resume, []),
            "next_up": (jellyfin_next_up, []),
            "airing": (lambda: airing(self.sonarr_key, SONARR, now()), []),
        }
        out, answered = {}, set()
        for name, (fn, empty) in reads.items():
            out[name] = self.safe(name, fn, FAILED)
            if out[name] is FAILED:
                out[name] = last.get(name, empty)
            else:
                answered.add(name)
        out["weather"] = self.weather(last.get("weather"))
        return out, answered

    def weather(self, last):
        """The weather every WEATHER_EVERY seconds, the last answer in between and on failure."""
        t = time.time()
        if t - self.weather_at < WEATHER_EVERY:
            return last
        answer = self.safe("weather", weather)
        if answer is not None:
            self.weather_at = t
        return answer or last

    def imported(self):
        return self.slow.get("radarr", []) + self.slow.get("sonarr", [])

    def state(self, src):
        """What the next pass compares to find what changed."""
        house, claude = src["house"] or {}, src["claude"] or {}
        return {
            "outlets": {o["id"]: o for o in house.get("outlets", [])},
            "covers": {c["id"]: c for c in house.get("covers", [])},
            "projectors": {p["id"]: p for p in house.get("projectors", [])},
            # by hash: Transmission renumbers its torrents at each restart
            "done": {x.get("hashString") or x["id"]: x for x in (src["torrents"] or []) if x.get("percentDone") == 1},
            "imports": {x["id"] for x in self.imported()},
            "scan": ((src["kpiece"] or {}).get("latest") or {}).get("scan"),
            "playing": {p["id"] for p in src["playing"]},
            "sessions": {x["id"]: x["status"] for x in claude.get("sessions", [])},
            "print": print_job(src["printer"]),
        }

    def notice_house(self, prev, state):
        self.notice_lights(prev["outlets"], state["outlets"])
        self.notice_covers(prev["covers"], state["covers"], state["projectors"])
        self.notice_projectors(prev["projectors"], state["projectors"])

    def notice_lights(self, prev, now):
        for k, o in now.items():
            was = prev.get(k, {}).get("on")
            if None not in (was, o.get("on")) and o.get("on") != was:
                self.emit("light", name=o.get("name"), on=o.get("on"))

    def notice_covers(self, prev, covers, projectors):
        """The projection screen setting off; going up on its own after its projector turned off,
        it is no news (the projector turning off was)."""
        for k, c in covers.items():
            p = prev.get(k)
            if not p or not c.get("moving") or p.get("moving"):
                continue
            if c["moving"] != "up" or not closing(projectors, k, self.closes, now()):
                self.emit("cover", name=c.get("name"), cover=k, target=c.get("target"), moving=c["moving"])

    def notice_projectors(self, prev, now):
        """On or off, or a new app in front; the projector idling (home, screensaver) is no news."""
        for k, pr in now.items():
            p = prev.get(k)
            on, app = pr.get("on"), pr.get("app")
            if p and None not in (p.get("on"), on) and on != p.get("on"):
                self.emit("projector", name=pr.get("name"), on=on, app=None if app in QUIET_APPS else app_name(pr, app))
            elif p and on and app != p.get("app") and app not in QUIET_APPS | {None}:
                self.emit("projector", name=pr.get("name"), on=True, app=app_name(pr, app))

    def remember_closes(self, projectors):
        """When the hub will close the screen, by projector: it forgets it as it does it, so
        the feed keeps the last one announced until the projector turns on again."""
        for pid, p in projectors.items():
            if p.get("on"):
                self.closes.pop(pid, None)
            elif due_at(p.get("closes_at")):
                self.closes[pid] = due_at(p["closes_at"])

    def notice_print(self, prev, state, p):
        """A print that starts, finishes or is cancelled; once each, not at every pass."""
        phase = print_phase(prev["print"], state["print"])
        if phase:
            self.emit("print", phase=phase, printer=p["name"], file=p["file"], image=p["image"],
                      layers=p["layers"], remaining=p["remaining"], started_at=p["started_at"])

    def notice_downloads(self, prev, state):
        """Torrents finished. One Radarr or Sonarr sent is only counted: its import is the news."""
        for k, x in state["done"].items():
            if k in prev["done"] or time.time() - x.get("doneDate", time.time()) >= DONE_FRESH:
                continue
            if for_arr(x):
                self.count("download", {})
            else:
                self.emit("download", name=x.get("name"), size=x.get("totalSize"))

    def notice_media(self, prev, state, src):
        """Downloads finished, films and episodes imported, videos started; nothing of a
        source's first answer."""
        if src["torrents"] is not None and "transmission" in self.heard:
            self.notice_downloads(prev, state)
        for x in self.imported():
            if x["id"] not in prev["imports"] and x["id"].split("-")[0] in self.heard:
                self.emit("import", **{k: v for k, v in x.items() if k != "id"})
        for p in src["playing"]:
            if p["id"] not in prev["playing"]:
                self.emit("play", title=p["title"], series=p["series"], season=p["season"], episode=p["episode"], device=p["device"])

    def notice_news(self, prev, state, src):
        """A new scan, a Claude Code session that starts waiting for an answer."""
        if state["scan"] and prev["scan"] and state["scan"] > prev["scan"]:
            self.emit("scan", **(src["kpiece"].get("latest") or {}))
        for x in (src["claude"] or {}).get("sessions", []):
            if x["status"] == "waiting" and prev["sessions"].get(x["id"], "waiting") != "waiting" \
                    and time.time() - self.asked.get(x["id"], float("-inf")) >= ASK_AGAIN:
                # a session asking for one permission after another is news once in a while
                self.asked[x["id"]] = time.time()
                self.emit("cerebro", **{k: x[k] for k in ("name", "project", "status", "room", "lead")})

    def notice(self, prev, state, src):
        """Turns what changed since the previous pass into events."""
        if src["house"] is not None and "house" in self.heard:
            self.notice_house(prev, state)
        self.notice_media(prev, state, src)
        self.notice_news(prev, state, src)
        if "printer" in self.heard:
            self.notice_print(prev, state, src["printer"])

    def answered(self, src):
        """The sources whose word this pass holds; the slow ones' as of their last read."""
        fast = {"house": src["house"], "transmission": src["torrents"], "printer": print_job(src["printer"]),
                "cerebro": src["claude"], "kpiece": src["kpiece"]}
        return {k for k, v in fast.items() if v is not None} | self.slow_heard

    @staticmethod
    def known(prev, state):
        """An on/off the hub could not read (null: adb unanswered in deep sleep, a reboot) is
        what it was before: a projector asleep must not turn off again at every missed look."""
        for k in ("outlets", "projectors"):
            for i, item in state[k].items():
                if item.get("on") is None and i in prev[k]:
                    state[k][i] = prev[k][i]
                elif item.get("on") and not item.get("app") and prev[k].get(i, {}).get("app"):
                    # on, but the app in front missed: still the one it was
                    state[k][i] = {**item, "app": prev[k][i]["app"]}

    @staticmethod
    def keep(prev, state, src):
        """Keeps what a dead source last said, so it does not fire again when it comes back.
        A printer switched off keeps its last print: switched on again, it is no news."""
        dead = {
            ("outlets", "covers", "projectors"): src["house"] is None,
            ("done",): src["torrents"] is None,
            ("sessions",): src["claude"] is None,
            ("print",): state["print"] is None,
        }
        for keys, gone in dead.items():
            for k in keys if gone else ():
                state[k] = prev[k]

    def tick(self):
        self.errors = {}
        src = self.read(time.time())
        state = self.state(src)
        prev = self.seen
        if prev is not None:
            self.known(prev, state)
            self.remember_closes(state["projectors"])
            self.notice(prev, state, src)
            self.keep(prev, state, src)
        self.seen = state
        self.heard |= self.answered(src)
        return self.document(src)

    def document(self, src):
        """screen.json."""
        torrents, services = src["torrents"] or [], src["services"]
        self.today = day_of(self.today, now())
        return {
            "updated_at": now().isoformat(timespec="seconds"),
            "playing": src["playing"],
            "resume": self.slow.get("resume", []),
            "events": self.events,
            "house": src["house"] and tidy_house(src["house"], self.seen),
            "downloads": [{"name": x["name"], "percent": round(x["percentDone"] * 100, 1), "rate": x.get("rateDownload"), "eta": x.get("eta")}
                          for x in torrents if x.get("percentDone", 1) < 1][:6],
            "recent": recent(self.imported()),
            "one_piece": src["kpiece"],
            "portfolio": self.slow.get("draupnir"),
            "cerebro": src["claude"],
            "disk": src["disk"],
            "services": {"up": sum(1 for s in services if s.get("state") == "running"), "total": len(services),
                         "down": [s.get("name") for s in services if s.get("state") != "running"]},
            "printer": src["printer"],
            "weather": self.slow.get("weather"),
            "next_up": self.slow.get("next_up", []),
            "airing": self.slow.get("airing", []),
            "today": {k: v for k, v in self.today.items() if k != "date"},
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
