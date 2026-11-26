"""quiet: the Pi lets the home network breathe while someone uses it. Every 20 s it
looks whether a PlayStation is on (playing, or streamed with Remote Play / chiaki-ng),
whether Jellyfin is playing something, and, with the Livebox's password, how much of
the Internet link the other devices use (the box's fibre counters minus the Pi's own:
Netflix on the TV, a video call, a download on a laptop…); then it puts Transmission in
turtle mode (its alt-speed limits). Five minutes after the last of them, the Pi gets
the whole network back: at work or at night, it downloads at full speed.

It only lifts the turtle mode it turned on itself: one turned on in Transmission stays.
The home page's turtle card picks the mode (GET/POST /quiet on QUIET_PORT, through
Caddy): "on" or "off" keeps the turtle mode so until "auto" is picked again, which
hands it back to quiet at once.
Standard library only; runs with the host's network, to reach the consoles' discovery
by broadcast. Writes what it sees to /status/quiet.json for the home page."""

import base64
import http.cookiejar
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TRANSMISSION = os.environ.get("TRANSMISSION_URL", "http://localhost:9091/transmission/rpc")
TRANSMISSION_AUTH = os.environ.get("TRANSMISSION_AUTH", "")  # "user:password", if Transmission asks
JELLYFIN = os.environ.get("JELLYFIN_URL", "http://localhost:8096")
JELLYFIN_KEY = os.environ.get("JELLYFIN_API_KEY", "")
LIVEBOX = os.environ.get("LIVEBOX_URL", "http://192.168.1.1")
LIVEBOX_PASSWORD = os.environ.get("LIVEBOX_PASSWORD", "")
WAN = os.environ.get("LIVEBOX_WAN", "veip0")  # the box's fibre interface
OTHERS_MBPS = float(os.environ.get("QUIET_OTHERS_MBPS", "3"))  # the others' use that counts
EVERY = int(os.environ.get("QUIET_EVERY", "20"))
HOLD = int(os.environ.get("QUIET_HOLD", "300"))  # seconds of calm before full speed again
STATUS = os.environ.get("QUIET_STATUS", "/status/quiet.json")
PORT = int(os.environ.get("QUIET_PORT", "8588"))  # the home page's switch
# PlayStation's discovery: a PS5 answers on 9302, a PS4 on 987; "200 Ok" when it is on,
# "620 Server Standby" in rest mode
DISCOVERY = b"SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n"
DISCOVERY_PORTS = (9302, 987)
BROADCASTS = ("255.255.255.255",)

session = {"id": ""}
lock = threading.Lock()  # one change of Transmission at a time: a look or the switch


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


# ---------- the Livebox: what the others use ----------

class Livebox:
    """A session on the Livebox's web API (the one its pages use): a context made with
    the admin password, then calls to its services."""

    def __init__(self, url=None, password=None):
        self.url, self.password, self.ctx = url or LIVEBOX, password if password is not None else LIVEBOX_PASSWORD, None
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def post(self, body, auth):
        req = urllib.request.Request(f"{self.url}/ws", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/x-sah-ws-4-call+json", **auth})
        with self.opener.open(req, timeout=10) as r:
            return json.load(r)

    def login(self):
        r = self.post({"service": "sah.Device.Information", "method": "createContext",
                       "parameters": {"applicationName": "webui", "username": "admin", "password": self.password}}, {"Authorization": "X-Sah-Login"})
        self.ctx = (r.get("data") or {}).get("contextID")
        if not self.ctx:
            raise RuntimeError("the Livebox refuses the password")

    def call(self, service, method):
        """A service's answer, logged in again once if the session expired."""
        for _ in range(2):
            if not self.ctx:
                self.login()
            r = self.post({"service": service, "method": method, "parameters": {}}, {"Authorization": f"X-Sah {self.ctx}", "X-Context": self.ctx})
            if r.get("status") is not None:
                return r["status"]
            self.ctx = None
        raise RuntimeError(f"the Livebox does not answer {service}.{method}")

    def wan_bytes(self):
        s = self.call(f"NeMo.Intf.{WAN}", "getNetDevStats")
        return s["RxBytes"] + s["TxBytes"]


def default_interface(route_file="/proc/net/route"):
    """The interface of the default route: the one the Pi's Internet traffic goes through."""
    with open(route_file) as f:
        for line in f.readlines()[1:]:
            fields = line.split()
            if len(fields) > 2 and fields[1] == "00000000":
                return fields[0]
    return ""


def own_bytes(net="/sys/class/net"):
    iface = default_interface()
    total = 0
    for name in ("rx_bytes", "tx_bytes"):
        with open(f"{net}/{iface}/statistics/{name}") as f:
            total += int(f.read())
    return total


def others_mbps(box, state, now):
    """The Internet link's use by everything but the Pi since the last look, in Mb/s
    (0 the first time, or when a counter went back)."""
    wan, own = box.wan_bytes(), own_bytes()
    before = state.get("counters")
    state["counters"] = (now, wan, own)
    if not before or now <= before[0]:
        return 0.0
    others = (wan - before[1]) - (own - before[2])
    return max(0.0, others * 8 / (now - before[0]) / 1e6)


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
    return "last_busy" in state and now - state["last_busy"] < HOLD


def others(state, now):
    """The others' use of the Internet link, or None without the Livebox's password."""
    if not LIVEBOX_PASSWORD:
        return None
    box = state.setdefault("box", Livebox())
    return round(safe(lambda: others_mbps(box, state, now), 0.0), 1)


def busy(seen):
    return bool(seen["consoles"] or seen["playing"] or (seen["others_mbps"] or 0) >= OTHERS_MBPS)


def step(state, now):
    """One look: who uses the network, then Transmission set accordingly."""
    seen = {"consoles": [c for c in consoles() if c["on"]], "playing": safe(playing, []), "others_mbps": others(state, now)}
    with lock:
        apply(seen, state, now)


MODES = ("auto", "on", "off")


def apply(seen, state, now):
    """Transmission set to what is wanted, or kept as picked by hand ("on", "off")."""
    want = state["want"] = decide(busy(seen), state, now)
    on, mode = turtle(), state.get("mode", "auto")
    if mode == "auto":
        on = follow(want, seen, state, on)
    elif on != (mode == "on"):  # changed in Transmission meanwhile
        on = force(mode == "on")
    state["seen"] = seen
    publish(state, on)


def follow(want, seen, state, on):
    """Transmission's turtle mode set to the wish; returns it as it is now."""
    if want and not on:
        set_turtle(True)
        state["ours"] = True
        print("turtle on:", why(seen), flush=True)
        return True
    if not want and on and state.get("ours"):
        set_turtle(False)
        state["ours"] = False
        print("turtle off: the network is calm", flush=True)
        return False
    return on


def force(on):
    set_turtle(on)
    return on


def switch(state, mode):
    """The mode picked on the home page: "on" or "off" holds until "auto", which sets
    the turtle mode to quiet's wish at once, even one turned on in Transmission."""
    with lock:
        state["mode"] = mode
        want = state.get("want", False) if mode == "auto" else mode == "on"
        on = turtle()
        if on != want:
            on = force(want)
        state["ours"] = mode == "auto" and on
        print("turtle mode:", mode, flush=True)
        return publish(state, on)


def publish(state, on):
    """What the home page shows, written to the status file and kept for GET /quiet.
    hand: in "auto", a turtle mode turned on in Transmission, which quiet leaves on."""
    seen = state.get("seen") or {"consoles": [], "playing": [], "others_mbps": None}
    mode = state.get("mode", "auto")
    hand = mode == "auto" and on and not state.get("ours")
    state["status"] = dict(seen, turtle=on, mode=mode, hand=hand, since=state.get("last_busy", 0),
                           ours=bool(state.get("ours")))
    write_status(state["status"])
    return state["status"]


def safe(fn, default):
    try:
        return fn()
    except Exception as e:  # Jellyfin away: as if nothing played
        print(fn.__name__, e, flush=True)
        return default


def why(seen):
    use = [f"{seen['others_mbps']} Mb/s used by the others"] if (seen.get("others_mbps") or 0) >= OTHERS_MBPS else []
    return ", ".join([c["name"] for c in seen["consoles"]] + seen["playing"] + use) or "?"


def write_status(status):
    try:
        tmp = STATUS + ".tmp"
        with open(tmp, "w") as f:
            json.dump(status, f)
        os.replace(tmp, STATUS)
    except OSError as e:  # no status volume: only the logs say it
        print("status:", e, flush=True)


class Switch(BaseHTTPRequestHandler):
    """GET /quiet: the status; POST /quiet {"mode": "auto"|"on"|"off"}: the mode picked."""
    state = {}

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.split("?")[0].rstrip("/") != "/quiet":
            return self.reply(404, {"error": "not found"})
        self.reply(200, self.state.get("status") or {"turtle": turtle(), "mode": "auto", "hand": False})

    def do_POST(self):
        if self.path.rstrip("/") != "/quiet":
            return self.reply(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length") or 0), 1024)
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict) or body.get("mode") not in MODES:
                raise ValueError('expected {"mode": "auto"|"on"|"off"}')
        except ValueError as e:
            return self.reply(400, {"error": str(e)})
        try:
            self.reply(200, switch(self.state, body["mode"]))
        except Exception as e:  # Transmission away
            self.reply(502, {"error": str(e)})

    def log_message(self, *args):
        pass


def serve(state, port=None):
    Switch.state = state
    server = ThreadingHTTPServer(("", PORT if port is None else port), Switch)
    threading.Thread(target=server.serve_forever, name="switch", daemon=True).start()
    return server


def restore(state):
    """What the last run knew, from its status file: whether the turtle mode is quiet's
    own, and the mode picked. A file of before the switch has no "ours": a turtle mode
    then on was quiet's."""
    try:
        with open(STATUS) as f:
            last = json.load(f)
    except (OSError, ValueError):
        return state
    state["ours"] = bool(last.get("ours", last.get("turtle")))
    if last.get("mode") in MODES:
        state["mode"] = last["mode"]
    return state


def main():
    state = restore({})
    print(f"quiet: every {EVERY}s, full speed {HOLD}s after the last use, switch on :{PORT}", flush=True)
    serve(state)
    while True:
        try:
            step(state, time.time())
        except Exception as e:  # Transmission away: next time
            print("quiet:", e, flush=True)
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
