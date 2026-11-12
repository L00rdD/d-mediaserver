#!/usr/bin/env python3
"""Keep fake releases out: an episode or a film that is in fact a program (.exe, .lnk...).

Run every 10 minutes by mediaserver-fakes.timer. Each run:

1. makes sure Sonarr and Radarr turn such releases down before grabbing them:
   a release profile in Sonarr, a custom format scored far below zero in every
   Radarr quality profile, both matching a release title that ends with a
   program's extension;
2. sweeps both queues: a download whose title ends that way, or in which Sonarr
   or Radarr found a program, is removed from Transmission (with its files),
   blocklisted, and searched again;
3. posts what it removed to Discord.

Settings come from the project's .env (next to this folder):
  FAKES_WEBHOOK_URL  Discord webhook (falls back on WATCHDOG_WEBHOOK_URL,
                     then AUTOHEAL_WEBHOOK_URL)
The API keys are read from config/sonarr and config/radarr.

Only the Python standard library: it runs on the host, outside Docker.
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
APPS = {"sonarr": 8989, "radarr": 7878}

EXTENSIONS = "exe|scr|lnk|msi|bat|cmd|vbs|ps1|jar|apk|pif"
PROGRAM = re.compile(rf"\.({EXTENSIONS})$", re.I)
# the same, as Sonarr and Radarr write a regular expression
TERM = rf"/\.({EXTENSIONS})$/i"
# what Sonarr and Radarr say when they find one in a download
FOUND = ("executable file", "dangerous file")

NAME = "No programs (fakes)"
SCORE = -10000  # under any quality profile's minimum: never grabbed


def log(msg):
    print(msg, flush=True)


def read_env():
    env = {}
    path = PROJECT / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip("'\"")
    return env


def api_key(app):
    """The app's API key from its config.xml, None when it is not installed."""
    path = PROJECT / "config" / app / "config.xml"
    if not path.exists():
        return None
    found = re.search(r"<ApiKey>(\w+)</ApiKey>", path.read_text())
    return found.group(1) if found else None


def call(app, key, method, path, body=None):
    """One call to the app's API; the decoded JSON answer, None when empty."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"http://localhost:{APPS[app]}/api/v3/{path}", data=data, method=method,
        headers={"X-Api-Key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as answer:
        text = answer.read()
    return json.loads(text) if text else None


def is_fake(record):
    """A queued download that is a program: by its title, or by what the app found in it."""
    if PROGRAM.search(record.get("title") or ""):
        return True
    messages = [m.lower() for s in record.get("statusMessages") or [] for m in s.get("messages") or []]
    return any(f in m for m in messages for f in FOUND)


def sweep(app, key):
    """Remove, blocklist and search again every fake in the queue; their titles."""
    queue = call(app, key, "GET", "queue?pageSize=500&includeUnknownSeriesItems=true&includeUnknownMovieItems=true")
    removed = []
    for record in queue.get("records", []):
        if is_fake(record):
            query = urllib.parse.urlencode(
                {"removeFromClient": "true", "blocklist": "true", "skipRedownload": "false"})
            call(app, key, "DELETE", f"queue/{record['id']}?{query}")
            removed.append(record.get("title") or str(record["id"]))
    return removed


def guard_sonarr(key):
    """The release profile that turns the fakes down; True when it had to be made."""
    profiles = call("sonarr", key, "GET", "releaseprofile")
    if any(TERM in (p.get("ignored") or []) for p in profiles):
        return False
    call("sonarr", key, "POST", "releaseprofile",
         {"name": NAME, "enabled": True, "required": [], "ignored": [TERM], "indexerId": 0, "tags": []})
    return True


def radarr_format(key):
    """The id of the custom format matching the fakes, made when missing."""
    for fmt in call("radarr", key, "GET", "customformat"):
        if fmt.get("name") == NAME:
            return fmt["id"], False
    fmt = call("radarr", key, "POST", "customformat", {
        "name": NAME, "includeCustomFormatWhenRenaming": False,
        "specifications": [{
            "name": "Program", "implementation": "ReleaseTitleSpecification",
            "negate": False, "required": True, "fields": [{"name": "value", "value": TERM}]}]})
    return fmt["id"], True


def guard_radarr(key):
    """The custom format, scored SCORE in every quality profile; True when anything changed."""
    fmt_id, changed = radarr_format(key)
    for profile in call("radarr", key, "GET", "qualityprofile"):
        items = profile.get("formatItems") or []
        item = next((i for i in items if i.get("format") == fmt_id), None)
        if item and item.get("score") == SCORE:
            continue
        if item:
            item["score"] = SCORE
        else:
            items.append({"format": fmt_id, "name": NAME, "score": SCORE})
        profile["formatItems"] = items
        call("radarr", key, "PUT", f"qualityprofile/{profile['id']}", profile)
        changed = True
    return changed


GUARDS = {"sonarr": guard_sonarr, "radarr": guard_radarr}


def run_app(app, key):
    """Guard and sweep one app; the lines worth posting."""
    lines = []
    if GUARDS[app](key):
        log(f"{app}: fakes filter set up")
    for title in sweep(app, key):
        lines.append(f"{app}: removed and blocklisted the fake « {title} », searching again")
    return lines


def post(url, text):
    """Send text to a Discord webhook (native or its /slack variant)."""
    field = "text" if url.rstrip("/").endswith("/slack") else "content"
    body = json.dumps({field: text, "username": "Mediaserver fakes"}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json", "User-Agent": "mediaserver-fakes"})
    urllib.request.urlopen(req, timeout=15)


def main():
    env = read_env()
    webhook = env.get("FAKES_WEBHOOK_URL") or env.get("WATCHDOG_WEBHOOK_URL") or env.get("AUTOHEAL_WEBHOOK_URL")
    lines, failed = [], False
    for app in APPS:
        key = api_key(app)
        if not key:
            continue
        try:
            lines += run_app(app, key)
        except Exception as e:  # an app restarting: the next run tries again
            log(f"{app}: {e}")
            failed = True
    for line in lines:
        log(line)
    if lines and webhook:
        try:
            post(webhook, "\n".join(lines))
        except Exception as e:
            log(f"Discord post failed: {e}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
