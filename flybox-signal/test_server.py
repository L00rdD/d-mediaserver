"""Tests of flybox-signal/server.py, without the box or a real socket:
python3 -m unittest flybox-signal/test_server.py"""

import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# loaded by path ("flybox-signal" is no module name), with no port argument
_spec = importlib.util.spec_from_file_location(
    "flybox_server", os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.py"))
server = importlib.util.module_from_spec(_spec)
with mock.patch("sys.argv", ["server.py"]):
    _spec.loader.exec_module(server)

OVERVIEW = {
    "cell_5G_stats_cfg": [{"stat": {"RSRPCurrent": -95, "SNRCurrent": 12}}],
    "cell_LTE_stats_cfg": [{"stat": {"RSRPCurrent": -101, "SNRCurrent": 4}}],
}


def handler(path, body=None):
    """A Handler for one request, without a socket."""
    h = server.Handler.__new__(server.Handler)
    h.path, h.command, h.request_version, h.requestline = path, "GET", "HTTP/1.1", ""
    h.client_address = ("192.168.1.20", 5000)
    data = b"" if body is None else body
    h.headers = {"Content-Length": str(len(data))} if body is not None else {}
    h.rfile, h.wfile = io.BytesIO(data), io.BytesIO()
    return h


def response(h):
    head, _, body = h.wfile.getvalue().partition(b"\r\n\r\n")
    lines = head.decode().split("\r\n")
    return int(lines[0].split()[1]), dict(l.split(": ", 1) for l in lines[1:]), body


class Box(unittest.TestCase):
    def test_read_box(self):
        answer = mock.MagicMock()
        answer.__enter__.return_value = io.BytesIO(json.dumps(OVERVIEW).encode())
        with mock.patch("urllib.request.urlopen", return_value=answer) as urlopen, \
                mock.patch("time.time", return_value=12.5):
            self.assertEqual(server.read_box(), {"t": 12.5, "nr": {"rsrp": -95, "snr": 12},
                                                 "lte": {"rsrp": -101, "snr": 4}})
        urlopen.assert_called_once_with(server.BOX, timeout=3)

    def test_default_port(self):
        self.assertEqual(server.PORT, 8765)

    def test_lan_ip(self):
        sock = mock.Mock()
        sock.getsockname.return_value = ("192.168.1.42", 51000)
        with mock.patch("socket.socket", return_value=sock):
            self.assertEqual(server.lan_ip(), "192.168.1.42")
        sock.connect.assert_called_once_with(("192.168.1.1", 80))
        sock.close.assert_called_once_with()


class Requests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        Path(self.dir.name, "index.html").write_text("<h1>signal</h1>")
        for p in [mock.patch.object(server, "HERE", Path(self.dir.name)),
                  mock.patch.object(server, "SPOTS", Path(self.dir.name, "spots.json"))]:
            p.start()
            self.addCleanup(p.stop)

    def get(self, path):
        h = handler(path)
        h.do_GET()
        return response(h)

    def post(self, path, body):
        h = handler(path, json.dumps(body).encode() if body is not None else b"")
        h.do_POST()
        return response(h)

    def test_page(self):
        code, headers, body = self.get("/")
        self.assertEqual((code, body), (200, b"<h1>signal</h1>"))
        self.assertEqual(headers["Content-Type"], "text/html; charset=utf-8")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Content-Length"], str(len(body)))

    def test_signal_and_box_down(self):
        with mock.patch.object(server, "read_box", return_value={"t": 1}):
            code, headers, body = self.get("/api/signal")
        self.assertEqual((code, json.loads(body)), (200, {"t": 1}))
        self.assertEqual(headers["Content-Type"], "application/json")
        with mock.patch.object(server, "read_box", side_effect=OSError("timed out")):
            code, _, body = self.get("/api/signal")
        self.assertEqual((code, json.loads(body)), (503, {"error": "timed out"}))

    def test_unknown_paths(self):
        self.assertEqual(self.get("/nope")[0], 404)
        code, _, body = self.post("/nope", {"a": 1})
        self.assertEqual((code, json.loads(body)), (404, {"error": "not found"}))
        self.assertFalse(server.SPOTS.exists())

    def test_save_list_and_delete_spots(self):
        self.assertEqual(json.loads(self.get("/api/spots")[2]), [])
        with mock.patch("time.strftime", return_value="2026-11-04 10:00:00"):
            code, _, body = self.post("/api/spots", {"name": "fenêtre", "nr": -90})
        self.assertEqual(code, 200)
        spot = {"name": "fenêtre", "nr": -90, "saved": "2026-11-04 10:00:00"}
        self.assertEqual(json.loads(body), [spot])
        self.assertEqual(json.loads(server.SPOTS.read_text()), [spot])
        self.assertIn("fenêtre", server.SPOTS.read_text())
        self.assertEqual(json.loads(self.get("/api/spots")[2]), [spot])
        code, _, body = self.post("/api/spots/delete", {"saved": "2026-11-04 10:00:00"})
        self.assertEqual((code, json.loads(body)), (200, []))

    def test_empty_body(self):
        with mock.patch("time.strftime", return_value="t"):
            code, _, body = self.post("/api/spots", None)
        self.assertEqual(json.loads(body), [{"saved": "t"}])
        h = handler("/api/spots/delete")
        h.do_POST()
        self.assertEqual(json.loads(response(h)[2]), [{"saved": "t"}])


if __name__ == "__main__":
    unittest.main()
