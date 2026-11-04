"""Follows the Anycubic resin printer (Photon Mono M7) for the home page card.

The M7 has no local API: on the home network it only answers a few busybox
leftovers (daytime, telnet...) and talks to Anycubic's cloud. So it is followed
in two steps:

- on the network: is it switched on? A TCP connection to one of its open ports
  says so within a second, without any account. When it is off nothing else is
  asked, and the card stays hidden.
- in the cloud, while it is on: the newest print job of the account (file,
  progress, layers, time left, preview), read with the token of the Anycubic web
  app (cloud-universe.anycubic.com, see the README). Without a token, or when it
  has expired (about 90 days), the card still shows that the printer is on.

It writes /status/printer.json every PRINTER_INTERVAL seconds (20 s), or every
minute while the printer is off. Read only: nothing here can start, pause or stop
a print.

Standard library only: runs on the stock python:3-alpine image.
"""

import hashlib
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

STATUS = os.environ.get("PRINTER_STATUS_DIR", "/status")
HOST = os.environ.get("PRINTER_HOST", "").strip() or "M7.lan"
TOKEN = os.environ.get("ANYCUBIC_TOKEN", "").strip()
INTERVAL = int(os.environ.get("PRINTER_INTERVAL", "20"))
OFF_INTERVAL = 60
# Ports the M7 answers on: 13 (busybox daytime) first, so that its own service on
# 11311 is only knocked on when the others are closed
PORTS = (13, 23, 11311)

CLOUD = "https://cloud-universe.anycubic.com/p/p/workbench/api"
# The Anycubic web app's own client id, not a secret: the cloud checks that each
# request is signed with it (md5 of id, time, version, secret, nonce, id again)
APP_ID = "f9b3528877c94d5c9c5af32245db46ef"
APP_SECRET = "0cf75926606049a3937f56b0373b99fb"
APP_VERSION = "1.0.0"
# print_status of a job, as the cloud gives it
STATES = {1: "printing", 2: "done", 3: "cancelled", 4: "downloading",
          5: "checking", 6: "preheating", 7: "slicing", 9: "levelling"}


class TokenRejected(Exception):
    """The cloud refused the token: wrong, or expired."""


def log(msg):
    print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def is_on(host, ports=PORTS, timeout=1.5):
    """True when the printer accepts a TCP connection on one of its ports."""
    for port in ports:
        try:
            socket.create_connection((host, port), timeout=timeout).close()
            return True
        except OSError:
            continue
    return False


def signed_headers(token, now_ms=None, nonce=None):
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    nonce = nonce or str(uuid.uuid1())
    raw = f"{APP_ID}{now_ms}{APP_VERSION}{APP_SECRET}{nonce}{APP_ID}"
    return {
        "Xx-Device-Type": "web",
        "Xx-Is-Cn": "1",
        "Xx-Nonce": nonce,
        "Xx-Signature": hashlib.md5(raw.encode()).hexdigest(),
        "Xx-Timestamp": str(now_ms),
        "Xx-Version": APP_VERSION,
        "XX-Token": token,
        "XX-LANGUAGE": "US",
        "Origin": "https://uc.makeronline.com",
        "User-Agent": "Mozilla/5.0 (mediaserver printer watcher)",
    }


def cloud_get(path, token, **params):
    """GET one cloud endpoint and return its "data". An expired token comes
    back as HTTP 200 with no data and a message about the token or the login."""
    url = CLOUD + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers=signed_headers(token))
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise TokenRejected(f"HTTP {e.code}") from e
        raise
    message = str(body.get("msg") or "")
    if body.get("data") is None and any(w in message.lower() for w in ("token", "login")):
        raise TokenRejected(message)
    return body.get("data")


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_dict(value):
    """Some fields come as a JSON string, others already decoded."""
    if isinstance(value, dict):
        return value
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def job_of(project):
    """What the card shows of a cloud project (a print job), or None."""
    if not project:
        return None
    live = as_dict(project.get("settings")) or as_dict(project.get("device_message"))
    code = int(number(project.get("print_status")) or 0)
    started = number(project.get("start_time"))
    return {
        "state": STATES.get(code, "unknown"),
        "active": code in (1, 4, 5, 6, 9),
        "name": project.get("gcode_name") or live.get("filename") or "",
        "progress": number(live.get("progress", project.get("progress"))),
        "layer": number(live.get("curr_layer")),
        "layers": number(live.get("total_layers")),
        "remaining_min": number(project.get("remain_time")),
        "started_at": datetime.fromtimestamp(started, timezone.utc).isoformat(timespec="seconds") if started else None,
        "image": project.get("img") or project.get("image_id") or None,
    }


def latest_job(token, printer_id):
    """The account's newest job on this printer (projects come newest first)."""
    for project in cloud_get("/work/project/getProjects", token, page="1", limit="20") or []:
        if int(number(project.get("printer_id")) or 0) == printer_id:
            return job_of(project)
    return None


def find_printer(token, wanted=""):
    """The account's printer: the one whose name or model contains `wanted`, else
    the first M7, else the first one. Returns (id, name) or None."""
    printers = cloud_get("/work/printer/getPrinters", token) or []
    label = lambda p: f"{p.get('name') or ''} {p.get('model') or ''} {p.get('machine_type') or ''}".lower()
    for test in (lambda p: wanted and wanted.lower() in label(p), lambda p: "m7" in label(p), lambda p: True):
        for p in printers:
            if test(p):
                return int(p["id"]), p.get("name") or p.get("model") or "Anycubic"
    return None


def cloud_part(token, printer):
    """The cloud fields of printer.json, and the printer (id, name) found. Never
    raises: a cloud problem becomes a "cloud" word the card can show."""
    if not token:
        return {"cloud": "no token", "job": None}, printer
    try:
        printer = printer or find_printer(token, os.environ.get("PRINTER_NAME", ""))
        if not printer:
            return {"cloud": "no printer on the account", "job": None}, None
        return {"cloud": "ok", "name": printer[1], "job": latest_job(token, printer[0])}, printer
    except TokenRejected as e:
        log(f"Anycubic token rejected: {e}")
        return {"cloud": "token rejected", "job": None}, None
    except Exception as e:  # network or cloud down: show the printer as on anyway
        log(f"cloud read failed: {e!r}")
        return {"cloud": "unreachable", "job": None}, printer


def write(name, text):
    path = os.path.join(STATUS, name)
    with open(path + ".tmp", "w") as f:
        f.write(text)
    os.replace(path + ".tmp", path)


def round_once(printer, was_on):
    """One look at the printer: writes printer.json, returns (printer, on)."""
    on = is_on(HOST)
    if on != was_on:
        log(f"{HOST} is {'on' if on else 'off'}")
    status = {"online": on, "host": HOST, "name": "Anycubic", "cloud": None, "job": None}
    if on:
        part, printer = cloud_part(TOKEN, printer)
        status.update(part)
    status["checked_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    write("printer.json", json.dumps(status, ensure_ascii=False) + "\n")
    return printer, on


def main():
    log(f"following {HOST} every {INTERVAL} s, Anycubic cloud {'on' if TOKEN else 'off (no ANYCUBIC_TOKEN)'}")
    printer, on = None, None
    while True:
        try:
            printer, on = round_once(printer, on)
        except Exception as e:  # status folder unwritable...: try again next round
            log(f"round failed: {e!r}")
        time.sleep(INTERVAL if on else OFF_INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
