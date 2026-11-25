import io
import json
import os
import socket
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import quiet  # noqa: E402

PS5_ON = b"HTTP/1.1 200 Ok\nhost-id:78C881FEAB84\nhost-type:PS5\nhost-name:PS5-399\nhost-request-port:997\n"
PS5_REST = b"HTTP/1.1 620 Server Standby\nhost-type:PS5\nhost-name:PS5-399\n"


class Answer(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeSocket:
    def __init__(self, answers):
        self.answers = list(answers)
        self.sent = []

    def setsockopt(self, *a):
        pass

    def settimeout(self, t):
        pass

    def sendto(self, data, address):
        self.sent.append((data, address))

    def recvfrom(self, n):
        if not self.answers:
            raise socket.timeout()
        return self.answers.pop(0)

    def close(self):
        pass


class Consoles(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(quiet.parse_console(PS5_ON), {"name": "PS5-399", "on": True})
        self.assertEqual(quiet.parse_console(PS5_REST), {"name": "PS5-399", "on": False})
        self.assertIsNone(quiet.parse_console(b"SRCH * HTTP/1.1"))

    def test_discovery(self):
        s = FakeSocket([(PS5_ON, ("192.168.1.20", 9302)), (PS5_ON, ("192.168.1.20", 9302)), (b"junk", ("192.168.1.9", 9302))])
        found = quiet.consoles(sock=s)
        self.assertEqual(found, [{"name": "PS5-399", "on": True, "ip": "192.168.1.20"}])
        self.assertEqual({a[1] for _, a in s.sent}, {9302, 987})


class Jellyfin(unittest.TestCase):
    def test_playing(self):
        sessions = [{"NowPlayingItem": {"Name": "Dune"}, "PlayState": {"IsPaused": False}},
                    {"NowPlayingItem": {"Name": "Paused"}, "PlayState": {"IsPaused": True}}, {"DeviceName": "idle"}]
        with mock.patch.object(quiet, "JELLYFIN_KEY", "k"), mock.patch.object(quiet.urllib.request, "urlopen", return_value=Answer(json.dumps(sessions).encode())):
            self.assertEqual(quiet.playing(), ["Dune"])
        with mock.patch.object(quiet, "JELLYFIN_KEY", ""):
            self.assertEqual(quiet.playing(), [])


class Transmission(unittest.TestCase):
    def test_rpc_session(self):
        conflict = urllib.error.HTTPError("u", 409, "c", {"X-Transmission-Session-Id": "s1"}, None)
        replies = [conflict, Answer(b'{"result": "success", "arguments": {"alt-speed-enabled": true}}')]

        def urlopen(req, timeout=0):
            r = replies.pop(0)
            if isinstance(r, Exception):
                raise r
            self.assertEqual(req.headers["X-transmission-session-id"], "s1")
            self.assertTrue(req.headers["Authorization"].startswith("Basic "))
            return r
        with mock.patch.object(quiet.urllib.request, "urlopen", urlopen), mock.patch.object(quiet, "TRANSMISSION_AUTH", "u:p"):
            self.assertTrue(quiet.turtle())

    def test_rpc_errors(self):
        with mock.patch.object(quiet.urllib.request, "urlopen", side_effect=urllib.error.HTTPError("u", 500, "e", {}, None)):
            with self.assertRaises(urllib.error.HTTPError):
                quiet.rpc("session-get")
        conflict = urllib.error.HTTPError("u", 409, "c", {"X-Transmission-Session-Id": "s"}, None)
        with mock.patch.object(quiet.urllib.request, "urlopen", side_effect=[conflict, conflict]):
            with self.assertRaises(RuntimeError):
                quiet.rpc("session-get")

    def test_set_turtle(self):
        with mock.patch.object(quiet, "rpc") as rpc:
            quiet.set_turtle(1)
        rpc.assert_called_once_with("session-set", {"alt-speed-enabled": True})


class Deciding(unittest.TestCase):
    def test_hold(self):
        state = {}
        self.assertFalse(quiet.decide(False, state, 1000))
        self.assertTrue(quiet.decide(True, state, 1000))
        self.assertTrue(quiet.decide(False, state, 1000 + quiet.HOLD - 1))
        self.assertFalse(quiet.decide(False, state, 1000 + quiet.HOLD))

    def run_step(self, state, now, consoles=(), playing=(), turtle=False):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(quiet, "STATUS", os.path.join(d, "q.json")), \
                mock.patch.object(quiet, "consoles", return_value=list(consoles)), mock.patch.object(quiet, "playing", return_value=list(playing)), \
                mock.patch.object(quiet, "turtle", return_value=turtle), mock.patch.object(quiet, "set_turtle") as st:
            quiet.step(state, now)
            with open(quiet.STATUS) as f:
                return st, json.load(f)

    def test_steps(self):
        state = {}
        ps5 = {"name": "PS5-399", "on": True, "ip": "x"}
        st, status = self.run_step(state, 1000, consoles=[ps5, dict(ps5, on=False)])
        st.assert_called_once_with(True)
        self.assertEqual((status["turtle"], len(status["consoles"])), (True, 1))
        st, _ = self.run_step(state, 1100, turtle=True)  # held
        st.assert_not_called()
        st, status = self.run_step(state, 1000 + quiet.HOLD + 1, turtle=True)  # calm again: ours, lifted
        st.assert_called_once_with(False)
        self.assertFalse(status["turtle"])
        st, status = self.run_step(state, 5000, turtle=True)  # turned on by hand: left alone
        st.assert_not_called()
        self.assertTrue(status["turtle"])
        st, _ = self.run_step({}, 10, playing=["Dune"])
        st.assert_called_once_with(True)

    def test_helpers(self):
        self.assertEqual(quiet.why({"consoles": [{"name": "PS5"}], "playing": ["Dune"]}), "PS5, Dune")
        self.assertEqual(quiet.why({"consoles": [], "playing": []}), "?")
        self.assertEqual(quiet.safe(lambda: 1 / 0, "d"), "d")
        with mock.patch.object(quiet, "STATUS", "/nonexistent/dir/q.json"):
            quiet.write_status({})  # no volume: only logged

    def test_main_survives(self):
        with mock.patch.object(quiet, "step", side_effect=RuntimeError("away")), mock.patch.object(quiet.time, "sleep", side_effect=StopIteration):
            with self.assertRaises(StopIteration):
                quiet.main()

    def test_get_json(self):
        with mock.patch.object(quiet.urllib.request, "urlopen", return_value=Answer(b"[1]")):
            self.assertEqual(quiet.get_json("http://x"), [1])


if __name__ == "__main__":
    unittest.main()
