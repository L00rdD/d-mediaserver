#!/usr/bin/env python3
"""Keep the media server up, and say so on Discord when it is not.

Run every minute by mediaserver-watchdog.timer, as root. Each run:

1. repairs what can be repaired: a drive that came back after a USB drop is
   mounted again, then the pool, then Docker (which stops with the pool). A
   drive that came back under a new device name while its old mount stayed
   (every read fails with an I/O error) has its mount and the pool detached
   first, with Docker stopped meanwhile. The drive holding Docker's own data
   (/mnt/docker, when fstab has it) is watched the same way, and Docker only
   starts once it is mounted;
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
# images, containers and volumes, off the SD card (outside the pool)
DOCKER_DISK = "/mnt/docker"

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
    """(mount point, UUID) of every drive under /mnt/disks in /etc/fstab, and
    of the Docker data drive."""
    drives = []
    for line in Path("/etc/fstab").read_text().splitlines():
        fields = line.split()
        if len(fields) < 2 or line.lstrip().startswith("#"):
            continue
        source, target = fields[0], fields[1]
        if (target.startswith("/mnt/disks/") or target == DOCKER_DISK) and "*" not in source:
            uuid = source[5:] if source.startswith("UUID=") else None
            drives.append((target, uuid))
    return drives


def mounted(path):
    return run("mountpoint", "-q", path).returncode == 0


def stale(target, uuid):
    """True when target is still mounted but its drive is gone or came back
    under another device: the old mount answers every read with an I/O error."""
    if uuid:
        dev = Path("/dev/disk/by-uuid", uuid)
        source = run("findmnt", "-no", "SOURCE", target).stdout.strip()
        if dev.exists() and source and os.path.realpath(dev) != os.path.realpath(source):
            return True
    try:
        return run("ls", target, timeout=15).returncode != 0
    except subprocess.TimeoutExpired:
        return True


def unit_for(path):
    return run("systemd-escape", "--path", "--suffix=mount", path).stdout.strip()


def active(unit):
    return run("systemctl", "is-active", "--quiet", unit).returncode == 0


def detach_stale(drives, problems, actions):
    """Detach the stale mounts of drives that are plugged in again, report the others."""
    dead = [(t, u) for t, u in drives if mounted(t) and stale(t, u)]
    # only a drive that is plugged in again can be remounted: detach it, the
    # pool and Docker (which hold it), the loop below mounts everything back
    back = [(t, u) for t, u in dead if not u or Path("/dev/disk/by-uuid", u).exists()]
    if back:
        run("systemctl", "stop", "docker.socket", "docker.service", "containerd.service", timeout=180)
        run("umount", "-l", POOL)
        for target, _ in back:
            run("umount", "-l", target)
        actions.append("detached the stale mount of " + ", ".join(Path(t).name for t, _ in back))
    for target, uuid in dead:
        if (target, uuid) not in back:
            name = Path(target).name
            problems["drive:" + name] = (f"Drive {name} ({uuid}) cannot be read and is unplugged.", GRACE)


def mount_drives(drives, problems, actions):
    """Mount again every drive that is plugged in but not mounted."""
    for target, uuid in drives:
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


def mount_pool(problems, actions):
    if not mounted(POOL):
        run("systemctl", "start", unit_for(POOL))
        if mounted(POOL):
            actions.append("remounted the pool")
        else:
            problems["pool"] = (f"The pool {POOL} is not mounted.", GRACE)


def start_docker(problems, actions, needs=(POOL,)):
    """Start Docker when it is stopped and every mount in needs is there."""
    if not active("docker.service"):
        if all(mounted(path) for path in needs):
            run("systemctl", "start", "docker.socket", "docker.service", timeout=180)
        if active("docker.service"):
            actions.append("started Docker")
        else:
            problems["docker"] = ("Docker is stopped: every app is down.", GRACE)


def check_containers(problems):
    """Report the compose containers that are stopped or unhealthy."""
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


def check_home(env, problems):
    port = env.get("HOME_PORT") or "80"
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10)
    except Exception as e:
        problems["home"] = (f"The home page (port {port}) does not answer: {e}", GRACE)


def repair_and_check(env):
    """Repair what can be, return {problem key: (message, grace)}."""
    problems = {}
    actions = []

    drives = fstab_drives()
    detach_stale(drives, problems, actions)
    mount_drives(drives, problems, actions)
    mount_pool(problems, actions)
    start_docker(problems, actions, [POOL] + [t for t, _ in drives if t == DOCKER_DISK])

    if active("docker.service"):
        check_containers(problems)
        check_home(env, problems)

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


def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        return {}


def problem_lines(host, now, problems, since):
    lines = [f"🔴 **{host}**: something is wrong"]
    for k in sorted(problems):
        minutes = int((now - since[k]) / 60)
        lines.append(f"- {problems[k][0]} (for {minutes} min)")
    return lines


def message_lines(host, alarm, actions, resolved):
    """The Discord message, one line per item, empty when there is nothing to say.
    alarm is problem_lines() when a problem is due, else empty."""
    lines = list(alarm)
    if actions:
        lines.append(f"🔧 **{host}**: " + ", ".join(actions) + ".")
    if resolved:
        lines.append(f"🟢 **{host}**: everything is back up.")
    return lines


def mark_sent(reported, due, resolved, now):
    for k in due:
        reported[k] = now
    for k in resolved:
        reported.pop(k, None)


def deliver(webhook, lines, sent):
    """Post the message (or log it without a webhook), then call sent()."""
    if lines and webhook:
        try:
            post(webhook, "\n".join(lines))
            sent()
        except Exception as e:
            # keep the state: the message goes out on a later run
            log(f"Discord post failed: {e}")
    elif lines:
        log("\n".join(lines))
        sent()


def triage(problems, since, reported, now):
    """(since, lasting, due, resolved): when each problem was first seen, those
    past their grace, those to post now, those gone since they were posted.
    Forgets in reported the problems gone while others remain."""
    since = {k: since.get(k, now) for k in problems}
    lasting = [k for k in problems if now - since[k] >= problems[k][1]]
    due = [k for k in lasting if now - reported.get(k, 0) >= REMIND]
    resolved = [k for k in reported if k not in problems]
    if problems:
        # the "back up" message waits for the last problem to go
        for k in resolved:
            reported.pop(k)
        resolved = []
    return since, lasting, due, resolved


def main():
    env = read_env()
    webhook = env.get("WATCHDOG_WEBHOOK_URL") or env.get("AUTOHEAL_WEBHOOK_URL")
    host = socket.gethostname()
    now = time.time()

    state = load_state()
    since = state.get("since", {})        # problem key -> first seen
    reported = state.get("reported", {})  # problem key -> last posted

    problems, actions = repair_and_check(env)
    for action in actions:
        log(action)

    since, lasting, due, resolved = triage(problems, since, reported, now)

    alarm = problem_lines(host, now, problems, since) if due else []
    lines = message_lines(host, alarm, actions, resolved)
    deliver(webhook, lines, lambda: mark_sent(reported, due, resolved, now))

    summary = "; ".join(problems[k][0] for k in sorted(problems)) or "all good"
    ping(env.get("WATCHDOG_PING_URL"), not lasting, summary)
    log(summary)

    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"since": since, "reported": reported}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
