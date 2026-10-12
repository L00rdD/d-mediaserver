"""Watches KPIECE for the new One Piece scan (French).

Every few minutes it reads the JSON files the site itself loads from its CDN:
data/saga.json (the current saga and arc), data/saga/<saga>/<arc>.json (every
scan out in that arc) and data/nextscan/nextscan.json (when the next one is
due). The scan pages cannot be used for this: they answer even for a scan that
is not out yet.

It writes what the home page shows to /status/kpiece.json and, when a scan
newer than the last one seen comes out, posts its link to the Discord webhook
in KPIECE_WEBHOOK_URL (optional). The last scan seen is kept in
/status/kpiece-seen, so a restart never posts the same scan twice; the very
first run only remembers the current scan.

Standard library only: runs on the stock python:3-alpine image.
"""

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CDN = "https://cdn.kpiece.fr/"
SITE = "https://www.kpiece.fr/"
STATUS = os.environ.get("KPIECE_STATUS_DIR", "/status")
WEBHOOK = os.environ.get("KPIECE_WEBHOOK_URL", "").strip()
INTERVAL = int(os.environ.get("KPIECE_INTERVAL", "300"))
# Around the expected release, check every minute (the CDN caches for 60 s)
FAST_BEFORE = timedelta(minutes=5)
FAST_AFTER = timedelta(hours=6)
FAST_INTERVAL = 60
# The site gives release times in French time
PARIS = ZoneInfo("Europe/Paris")
MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet",
          "aout", "septembre", "octobre", "novembre", "decembre"]


def log(msg):
    print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def get(path):
    req = urllib.request.Request(CDN + path, headers={"User-Agent": "Mozilla/5.0 (mediaserver kpiece watcher)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def french_date(text):
    """'08 Octobre 2026' -> '2026-10-08' (the site writes 'Aout', 'Fevrier' without accents)."""
    m = re.fullmatch(r"(\d{1,2}) (\S+) (\d{4})", text.strip())
    if not m:
        return None
    month = m[2].lower().translate(str.maketrans("éèêûô", "eeeuo"))
    if month not in MONTHS:
        return None
    return f"{m[3]}-{MONTHS.index(month) + 1:02d}-{int(m[1]):02d}"


def check():
    sagas = get("data/saga.json")
    saga = sagas[0]
    saga_id, arc_id = saga["saganame"], saga["arcssearch"][0]
    arc_name = (saga.get("arcsname") or [arc_id])[0]

    latest = max(get(f"data/saga/{saga_id}/{arc_id}.json"), key=lambda s: int(s["scan"]))
    number = int(latest["scan"])
    status = {
        "latest": {
            "scan": number,
            "name": latest.get("name", ""),
            "date": french_date(latest.get("date", "")) or latest.get("date", ""),
            "pages": latest.get("maxpages"),
            "arc": arc_name,
            "url": f"{SITE}scan/{saga_id}/{arc_id}/{number}/1",
        },
        "next": None,
        "checked_at": datetime.now(PARIS).isoformat(timespec="seconds"),
    }

    nxt = get("data/nextscan/nextscan.json")
    try:
        at = datetime.strptime(f"{nxt['nextscan']} {nxt.get('nextscan_time') or '00:00:00'}", "%d-%m-%Y %H:%M:%S")
        status["next"] = {"scan": number + 1, "at": at.replace(tzinfo=PARIS).isoformat(timespec="seconds")}
    except (KeyError, ValueError):
        log(f"next scan date not understood: {nxt!r}")
    return status


def write(name, text):
    path = os.path.join(STATUS, name)
    with open(path + ".tmp", "w") as f:
        f.write(text)
    os.replace(path + ".tmp", path)


def read_seen():
    try:
        with open(os.path.join(STATUS, "kpiece-seen")) as f:
            return int(f.read().strip())
    except (OSError, ValueError):
        return None


def notify(latest):
    payload = {
        "username": "KPIECE",
        "content": f"Le scan {latest['scan']} de One Piece est sorti ! {latest['url']}",
        "embeds": [{
            "title": f"Scan {latest['scan']}" + (f" : {latest['name']}" if latest["name"] else ""),
            "url": latest["url"],
            "description": f"Arc {latest['arc']}" + (f", {latest['pages']} pages" if latest["pages"] else ""),
            "color": 0xFF3340,
        }],
    }
    req = urllib.request.Request(
        WEBHOOK,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "mediaserver kpiece watcher"},
    )
    urllib.request.urlopen(req, timeout=20).close()


def wait_time(status):
    if status and status["next"]:
        at = datetime.fromisoformat(status["next"]["at"])
        if at - FAST_BEFORE <= datetime.now(PARIS) <= at + FAST_AFTER:
            return FAST_INTERVAL
    return INTERVAL


def main():
    seen = read_seen()
    log(f"watching KPIECE every {INTERVAL} s, Discord {'on' if WEBHOOK else 'off'}, last scan seen: {seen}")
    while True:
        status = None
        try:
            status = check()
            write("kpiece.json", json.dumps(status, ensure_ascii=False) + "\n")
            latest = status["latest"]
            if seen is None or latest["scan"] > seen:
                if seen is not None:
                    log(f"scan {latest['scan']} is out: {latest['url']}")
                    if WEBHOOK:
                        notify(latest)
                seen = latest["scan"]
                write("kpiece-seen", f"{seen}\n")
        except Exception as e:  # network, site or Discord down: try again next round
            log(f"check failed: {e!r}")
        time.sleep(wait_time(status))


if __name__ == "__main__":
    sys.exit(main())
