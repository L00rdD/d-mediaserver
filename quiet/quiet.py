"""quiet: the Pi lets the home network breathe while someone uses it. Every 20 s it
looks whether a PlayStation is on (playing, or streamed with Remote Play / chiaki-ng)
and whether Jellyfin is playing something; then it puts Transmission in turtle mode
(its alt-speed limits). Five minutes after the last of them, the Pi gets the whole
network back: at work or at night, it downloads at full speed.

It only lifts the turtle mode it turned on itself: one turned on by hand stays.
Standard library only; runs with the host's network, to reach the consoles' discovery
by broadcast. Writes what it sees to /status/quiet.json for the home page."""

import base64
import json
import os
import socket
import time
import urllib.error
import urllib.request

TRANSMISSION = os.environ.get("TRANSMISSION_URL", "http://localhost:9091/transmission/rpc")
TRANSMISSION_AUTH = os.environ.get("TRANSMISSION_AUTH", "")  # "user:password", if Transmission asks
JELLYFIN = os.environ.get("JELLYFIN_URL", "http://localhost:8096")
JELLYFIN_KEY = os.environ.get("JELLYFIN_API_KEY", "")
EVERY = int(os.environ.get("QUIET_EVERY", "20"))
HOLD = int(os.environ.get("QUIET_HOLD", "300"))  # seconds of calm before full speed again
STATUS = os.environ.get("QUIET_STATUS", "/status/quiet.json")
# PlayStation's discovery: a PS5 answers on 9302, a PS4 on 987; "200 Ok" when it is on,
# "620 Server Standby" in rest mode
DISCOVERY = b"SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n"
DISCOVERY_PORTS = (9302, 987)
BROADCASTS = ("255.255.255.255",)

session = {"id": ""}


# ---------- who uses the network ----------

def parse_console(data):
    """{name, on} of a PlayStation's discovery answer, or None."""
    text = data.decode(errors="replace")
    if not text.startswith("HTTP/1.1 "):
        return None
    fields = dict(line.split(":", 1) for line in text.splitlines()[1:] if ":" in line)
    return {"name": fields.get("host-name", "PlayStation").strip(), "on": text.split(" ", 2)[1] == "200"}


def consoles(timeout=1.5, sock=None):
    """The PlayStations answering on the home network."""
    s = sock or socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.settimeout(timeout)
    for port in DISCOVERY_PORTS:
        for address in BROADCASTS:
            s.sendto(DISCOVERY, (address, port))
    found = {}
    try:
        while True:
            data, (ip, _) = s.recvfrom(2048)
            c = parse_console(data)
            if c:
                found[ip] = dict(c, ip=ip)
    except (socket.timeout, OSError):
        pass
    finally:
        s.close()
    return list(found.values())


def get_json(url, headers=None, timeout=10):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def playing():
    """What Jellyfin is playing (not paused) right now: titles."""
    if not JELLYFIN_KEY:
        return []
    sessions = get_json(f"{JELLYFIN}/Sessions?ActiveWithinSeconds=120", {"X-Emby-Token": JELLYFIN_KEY})
    return [s["NowPlayingItem"].get("Name", "?") for s in sessions
            if s.get("NowPlayingItem") and not (s.get("PlayState") or {}).get("IsPaused")]


# ---------- Transmission ----------

def rpc(method, arguments=None):
    body = json.dumps({"method": method, "arguments": arguments or {}}).encode()
    for _ in range(2):
        headers = {"X-Transmission-Session-Id": session["id"], "Content-Type": "application/json"}
        if TRANSMISSION_AUTH:
            headers["Authorization"] = "Basic " + base64.b64encode(TRANSMISSION_AUTH.encode()).decode()
        try:
            with urllib.request.urlopen(urllib.request.Request(TRANSMISSION, data=body, headers=headers), timeout=15) as r:
                return json.load(r).get("arguments", {})
        except urllib.error.HTTPError as e:
            if e.code != 409:
                raise
            session["id"] = e.headers.get("X-Transmission-Session-Id", "")
    raise RuntimeError("Transmission refuses the session")


def turtle():
    return bool(rpc("session-get", {"fields": ["alt-speed-enabled"]}).get("alt-speed-enabled"))


def set_turtle(on):
    rpc("session-set", {"alt-speed-enabled": bool(on)})


# ---------- deciding ----------

def decide(busy, state, now):
    """The turtle mode wanted: on while busy, and HOLD seconds after; the state keeps
    when the network was last busy."""
    if busy:
        state["last_busy"] = now
    return now - state.get("last_busy", 0) < HOLD


def step(state, now):
    """One look: who uses the network, then Transmission set accordingly."""
    seen = {"consoles": [c for c in consoles() if c["on"]], "playing": safe(playing, [])}
    want = decide(bool(seen["consoles"] or seen["playing"]), state, now)
    on = turtle()
    if want and not on:
        set_turtle(True)
        state["ours"], on = True, True
        print("turtle on:", why(seen), flush=True)
    elif not want and on and state.get("ours"):
        set_turtle(False)
        state["ours"], on = False, False
        print("turtle off: the network is calm", flush=True)
    write_status(dict(seen, turtle=on, since=state.get("last_busy", 0)))


def safe(fn, default):
    try:
        return fn()
    except Exception as e:  # Jellyfin away: as if nothing played
        print(fn.__name__, e, flush=True)
        return default


def why(seen):
    return ", ".join([c["name"] for c in seen["consoles"]] + seen["playing"]) or "?"


def write_status(status):
    try:
        tmp = STATUS + ".tmp"
        with open(tmp, "w") as f:
            json.dump(status, f)
        os.replace(tmp, STATUS)
    except OSError as e:  # no status volume: only the logs say it
        print("status:", e, flush=True)


def main():
    state = {}
    print(f"quiet: every {EVERY}s, full speed {HOLD}s after the last use", flush=True)
    while True:
        try:
            step(state, time.time())
        except Exception as e:  # Transmission away: next time
            print("quiet:", e, flush=True)
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
