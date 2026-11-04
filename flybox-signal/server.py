#!/usr/bin/env python3
"""Live 4G/5G signal of the Flybox, to find the best spot in the flat.

Serves a phone-friendly page on the LAN and proxies the box's unauthenticated
overview endpoint (the browser can't call the box directly: no CORS).
Saved spots go to spots.json next to this file.

    python3 flybox-signal/server.py          # then open http://<mac-ip>:8765 on the phone
"""
import json
import socket
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BOX = "http://192.168.1.1/overview_get_web_app.cgi"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
HERE = Path(__file__).resolve().parent
SPOTS = HERE / "spots.json"


def read_box():
    with urllib.request.urlopen(BOX, timeout=3) as r:
        d = json.load(r)
    nr = d["cell_5G_stats_cfg"][0]["stat"]
    lte = d["cell_LTE_stats_cfg"][0]["stat"]
    return {
        "t": time.time(),
        "nr": {"rsrp": nr["RSRPCurrent"], "snr": nr["SNRCurrent"]},
        "lte": {"rsrp": lte["RSRPCurrent"], "snr": lte["SNRCurrent"]},
    }


def load_spots():
    return json.loads(SPOTS.read_text()) if SPOTS.exists() else []


class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/":
            self.send(200, (HERE / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/signal":
            try:
                self.send(200, read_box())
            except Exception as e:  # box rebooting after being moved
                self.send(503, {"error": str(e)})
        elif self.path == "/api/spots":
            self.send(200, load_spots())
        else:
            self.send(404, {"error": "not found"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        spots = load_spots()
        if self.path == "/api/spots":
            body["saved"] = time.strftime("%Y-%m-%d %H:%M:%S")
            spots.append(body)
        elif self.path == "/api/spots/delete":
            spots = [s for s in spots if s.get("saved") != body.get("saved")]
        else:
            return self.send(404, {"error": "not found"})
        SPOTS.write_text(json.dumps(spots, indent=1, ensure_ascii=False))
        self.send(200, spots)

    def log_message(self, *a):
        pass


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.168.1.1", 80))
        return s.getsockname()[0]
    finally:
        s.close()


if __name__ == "__main__":
    print(f"Open http://{lan_ip()}:{PORT} on the phone (Ctrl+C to stop)")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
