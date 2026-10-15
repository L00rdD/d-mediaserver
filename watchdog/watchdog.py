#!/usr/bin/env python3
"""Keep the media server up, and say so on Discord when it is not.

Run every minute by mediaserver-watchdog.timer, as root. Each run:

1. repairs what can be repaired: a drive that came back after a USB drop is
   mounted again, then the pool, then Docker (which stops with the pool);
2. lists what is still wrong: missing drive, pool or Docker down, a container
   stopped or unhealthy, the home page not answering;
3. posts to Discord when a problem has lasted long enough, again every few
   hours while it lasts, and once more when everything is back.

Settings come from the project's .env (next to this folder):
  WATCHDOG_WEBHOOK_URL  Discord webhook for the alerts (falls back on
                        AUTOHEAL_WEBHOOK_URL, with or without /slack)
  WATCHDOG_PING_URL     optional dead man's switch (healthchecks.io): pinged
                        when all is well, so it warns you when the Pi itself
                        is off or offline and cannot post anything
  HOME_PORT             port of the home page (80)

Only the Python standard library: it runs on the host, outside Docker.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
STATE_FILE = Path("/var/lib/mediaserver-watchdog/state.json")
POOL = "/mnt/storage"

# a problem is reported once it has lasted this long (seconds), so a restart
# in progress or autoheal doing its job does not page anyone
GRACE = 120
GRACE_UNHEALTHY = 600
# while a problem lasts, remind every REMIND seconds
REMIND = 6 * 3600


def log(msg):
    print(msg, flush=True)


def run(*cmd, timeout=60):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


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


def fstab_drives():
    """(mount point, UUID) of every drive under /mnt/disks in /etc/fstab."""
    drives = []
    for line in Path("/etc/fstab").read_text().splitlines():
        fields = line.split()
        if len(fields) < 2 or line.lstrip().startswith("#"):
            continue
        source, target = fields[0], fields[1]
        if target.startswith("/mnt/disks/") and "*" not in source:
            uuid = source[5:] if source.startswith("UUID=") else None
            drives.append((target, uuid))
    return drives


def mounted(path):
    return run("mountpoint", "-q", path).returncode == 0


def unit_for(path):
    return run("systemd-escape", "--path", "--suffix=mount", path).stdout.strip()


def active(unit):
    return run("systemctl", "is-active", "--quiet", unit).returncode == 0


def repair_and_check(env):
    """Repair what can be, return {problem key: (message, grace)}."""
    problems = {}
    actions = []

    for target, uuid in fstab_drives():
        if mounted(target):
            continue
        name = Path(target).name
        if uuid and not Path("/dev/disk/by-uuid", uuid).exists():
            problems["drive:" + name] = (f"Drive {name} ({uuid}) is unplugged or dead.", GRACE)
            continue
        result = run("systemctl", "start", unit_for(target))
        if mounted(target):
            actions.append(f"remounted {name}")
        else:
            problems["drive:" + name] = (
                f"Drive {name} is plugged in but will not mount: {result.stderr.strip()[:200]}",
                GRACE,
            )

    if not mounted(POOL):
        run("systemctl", "start", unit_for(POOL))
        if mounted(POOL):
            actions.append("remounted the pool")
        else:
            problems["pool"] = (f"The pool {POOL} is not mounted.", GRACE)

    if not active("docker.service"):
        if mounted(POOL):
            run("systemctl", "start", "docker.service", timeout=180)
        if active("docker.service"):
            actions.append("started Docker")
        else:
            problems["docker"] = ("Docker is stopped: every app is down.", GRACE)

    if active("docker.service"):
        result = run(
            "docker", "ps", "-a", "--format",
            '{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Label "com.docker.compose.project"}}'
            '\t{{.Label "com.docker.compose.oneoff"}}',
        )
        for line in result.stdout.splitlines():
            name, state, status, project, oneoff = (line.split("\t") + [""] * 5)[:5]
            if not project or oneoff == "True":
                continue
            if state != "running":
                problems["container:" + name] = (f"Container {name} is {state} ({status}).", GRACE)
            elif "(unhealthy)" in status:
                problems["unhealthy:" + name] = (f"Container {name} is unhealthy.", GRACE_UNHEALTHY)

        port = env.get("HOME_PORT") or "80"
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10)
        except Exception as e:
            problems["home"] = (f"The home page (port {port}) does not answer: {e}", GRACE)

    return problems, actions


def post(url, text):
    """Send text to a Discord webhook (native or its /slack variant)."""
    key = "text" if url.rstrip("/").endswith("/slack") else "content"
    body = json.dumps({key: text, "username": "Mediaserver watchdog"}).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json", "User-Agent": "mediaserver-watchdog"}
    )
    urllib.request.urlopen(req, timeout=15)


def ping(url, ok, text):
    if not url:
        return
    try:
        req = urllib.request.Request(url if ok else url.rstrip("/") + "/fail", data=text.encode())
        urllib.request.urlopen(req, timeout=15)
    except Exception as e:
        log(f"ping failed: {e}")


def main():
    env = read_env()
    webhook = env.get("WATCHDOG_WEBHOOK_URL") or env.get("AUTOHEAL_WEBHOOK_URL")
    host = socket.gethostname()
    now = time.time()

    try:
        state = json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        state = {}
    since = state.get("since", {})        # problem key -> first seen
    reported = state.get("reported", {})  # problem key -> last posted

    problems, actions = repair_and_check(env)
    for action in actions:
        log(action)

    since = {k: since.get(k, now) for k in problems}
    lasting = [k for k in problems if now - since[k] >= problems[k][1]]
    due = [k for k in lasting if now - reported.get(k, 0) >= REMIND]
    resolved = [k for k in reported if k not in problems]
    if problems:
        # the "back up" message waits for the last problem to go
        for k in resolved:
            reported.pop(k)
        resolved = []

    lines = []
    if due:
        lines.append(f"🔴 **{host}**: something is wrong")
        for k in sorted(problems):
            minutes = int((now - since[k]) / 60)
            lines.append(f"- {problems[k][0]} (for {minutes} min)")
    if actions:
        lines.append(f"🔧 **{host}**: " + ", ".join(actions) + ".")
    if resolved:
        lines.append(f"🟢 **{host}**: everything is back up.")

    if lines and webhook:
        try:
            post(webhook, "\n".join(lines))
            for k in due:
                reported[k] = now
            for k in resolved:
                reported.pop(k, None)
        except Exception as e:
            # keep the state: the message goes out on a later run
            log(f"Discord post failed: {e}")
    elif lines:
        log("\n".join(lines))
        for k in due:
            reported[k] = now
        for k in resolved:
            reported.pop(k, None)

    summary = "; ".join(problems[k][0] for k in sorted(problems)) or "all good"
    ping(env.get("WATCHDOG_PING_URL"), not lasting, summary)
    log(summary)

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"since": since, "reported": reported}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
