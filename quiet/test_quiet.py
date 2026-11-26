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

    def run_step(self, state, now, consoles=(), playing=(), turtle=False, others=None):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(quiet, "STATUS", os.path.join(d, "q.json")), \
                mock.patch.object(quiet, "consoles", return_value=list(consoles)), mock.patch.object(quiet, "playing", return_value=list(playing)), \
                mock.patch.object(quiet, "others", return_value=others), \
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
        st, status = self.run_step({}, 10, others=8.5)  # Netflix on the TV
        st.assert_called_once_with(True)
        self.assertEqual(status["others_mbps"], 8.5)
        st, _ = self.run_step({}, 10, others=1.0)  # a phone syncing: not enough
        st.assert_not_called()

    def test_by_hand(self):
        state = {}
        ps5 = {"name": "PS5-399", "on": True, "ip": "x"}
        self.run_step(state, 1000, consoles=[ps5])  # quiet turns it on
        with tempfile.TemporaryDirectory() as d, mock.patch.object(quiet, "STATUS", os.path.join(d, "q.json")), \
                mock.patch.object(quiet, "set_turtle") as st:
            status = quiet.switch(state, False)  # switched off while the PS5 plays
        st.assert_called_once_with(False)
        self.assertEqual((status["turtle"], status["hand"], status["consoles"]), (False, True, [ps5]))
        st, status = self.run_step(state, 1020, consoles=[ps5])  # still playing: stays off
        st.assert_not_called()
        self.assertEqual((status["turtle"], status["hand"]), (False, True))
        st, status = self.run_step(state, 1020 + quiet.HOLD)  # calm: quiet watches again
        st.assert_not_called()
        self.assertEqual((status["turtle"], status["hand"]), (False, False))
        st, _ = self.run_step(state, 5000, consoles=[ps5])  # the next game: on again
        st.assert_called_once_with(True)

    def test_on_by_hand_stays(self):
        state = {}
        self.run_step(state, 1000)
        with tempfile.TemporaryDirectory() as d, mock.patch.object(quiet, "STATUS", os.path.join(d, "q.json")), \
                mock.patch.object(quiet, "set_turtle"):
            self.assertEqual(quiet.switch(state, True)["hand"], True)
        st, status = self.run_step(state, 1020, turtle=True)
        st.assert_not_called()
        self.assertEqual((status["turtle"], status["hand"]), (True, True))
        ps5 = {"name": "PS5", "on": True, "ip": "x"}
        self.run_step(state, 1040, turtle=True, consoles=[ps5])
        st, status = self.run_step(state, 1040 + quiet.HOLD, turtle=True)  # calm again: still on
        st.assert_not_called()
        self.assertEqual((status["turtle"], status["hand"]), (True, True))

    def test_helpers(self):
        self.assertEqual(quiet.why({"consoles": [{"name": "PS5"}], "playing": ["Dune"]}), "PS5, Dune")
        self.assertEqual(quiet.why({"consoles": [], "playing": []}), "?")
        self.assertEqual(quiet.why({"consoles": [], "playing": [], "others_mbps": 9.0}), "9.0 Mb/s used by the others")
        self.assertEqual(quiet.safe(lambda: 1 / 0, "d"), "d")
        with mock.patch.object(quiet, "STATUS", "/nonexistent/dir/q.json"):
            quiet.write_status({})  # no volume: only logged

    def test_main_survives(self):
        with mock.patch.object(quiet, "serve"), mock.patch.object(quiet, "restore", return_value={}), mock.patch.object(quiet, "step", side_effect=RuntimeError("away")), mock.patch.object(quiet.time, "sleep", side_effect=StopIteration):
            with self.assertRaises(StopIteration):
                quiet.main()

    def test_get_json(self):
        with mock.patch.object(quiet.urllib.request, "urlopen", return_value=Answer(b"[1]")):
            self.assertEqual(quiet.get_json("http://x"), [1])


class Box(unittest.TestCase):
    def fake(self, replies):
        box = quiet.Livebox("http://box", "pw")
        sent = []

        def post(body, auth):
            sent.append((body, auth))
            return replies.pop(0)
        box.post = post
        return box, sent

    def test_login_and_counters(self):
        box, sent = self.fake([{"data": {"contextID": "c1"}}, {"status": {"RxBytes": 100, "TxBytes": 20}}])
        self.assertEqual(box.wan_bytes(), 120)
        self.assertEqual(sent[0][0]["parameters"]["password"], "pw")
        self.assertEqual(sent[1][1]["X-Context"], "c1")
        self.assertEqual(sent[1][0]["service"], "NeMo.Intf.veip0")

    def test_session_expired_then_refused(self):
        box, sent = self.fake([{"data": {"contextID": "c1"}}, {"errors": [{"error": 13}]}, {"data": {"contextID": "c2"}}, {"status": {"ok": 1}}])
        self.assertEqual(box.call("S", "m"), {"ok": 1})
        self.assertEqual(sent[3][1]["X-Context"], "c2")
        box, _ = self.fake([{"data": {}}])
        with self.assertRaises(RuntimeError):
            box.login()
        box, _ = self.fake([{"data": {"contextID": "c"}}, {"errors": []}, {"data": {"contextID": "c"}}, {"errors": []}])
        with self.assertRaises(RuntimeError):
            box.call("S", "m")

    def test_post(self):
        box = quiet.Livebox("http://box", "pw")
        box.opener = mock.Mock()
        box.opener.open.return_value = Answer(b'{"status": true}')
        self.assertEqual(box.post({"a": 1}, {"Authorization": "x"}), {"status": True})
        req = box.opener.open.call_args[0][0]
        self.assertEqual((req.full_url, req.headers["Content-type"]), ("http://box/ws", "application/x-sah-ws-4-call+json"))

    def test_own_counters(self):
        with tempfile.TemporaryDirectory() as d:
            route = os.path.join(d, "route")
            with open(route, "w") as f:
                f.write("Iface\tDestination\tGateway\nwlan0\t0001A8C0\t00000000\nwlan0\t00000000\t0101A8C0\n")
            self.assertEqual(quiet.default_interface(route), "wlan0")
            os.makedirs(os.path.join(d, "wlan0", "statistics"))
            for name, n in (("rx_bytes", 30), ("tx_bytes", 12)):
                with open(os.path.join(d, "wlan0", "statistics", name), "w") as f:
                    f.write(str(n))
            with mock.patch.object(quiet, "default_interface", return_value="wlan0"):
                self.assertEqual(quiet.own_bytes(d), 42)
            with open(route, "w") as f:
                f.write("Iface\tDestination\tGateway\n")
            self.assertEqual(quiet.default_interface(route), "")

    def test_others(self):
        box = mock.Mock()
        state = {}
        box.wan_bytes.side_effect = [1_000_000, 1_000_000 + 30_000_000, 5]
        with mock.patch.object(quiet, "own_bytes", side_effect=[500, 500 + 5_000_000, 600]):
            self.assertEqual(quiet.others_mbps(box, state, 100), 0.0)  # first look
            self.assertAlmostEqual(quiet.others_mbps(box, state, 120), 25_000_000 * 8 / 20 / 1e6)
            self.assertEqual(quiet.others_mbps(box, state, 140), 0.0)  # the box restarted: counters back to 0

    def test_others_needs_the_password(self):
        with mock.patch.object(quiet, "LIVEBOX_PASSWORD", ""):
            self.assertIsNone(quiet.others({}, 1))
        state = {"box": mock.Mock()}
        with mock.patch.object(quiet, "LIVEBOX_PASSWORD", "pw"), mock.patch.object(quiet, "others_mbps", return_value=3.14159):
            self.assertEqual(quiet.others(state, 1), 3.1)
        with mock.patch.object(quiet, "LIVEBOX_PASSWORD", "pw"), mock.patch.object(quiet, "others_mbps", side_effect=OSError("box away")):
            self.assertEqual(quiet.others(state, 1), 0.0)


if __name__ == "__main__":
    unittest.main()


class Switch(unittest.TestCase):
    def setUp(self):
        self.state = {"status": {"turtle": True, "hand": False}}
        self.server = quiet.serve(self.state, port=0)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def ask(self, path, body=None):
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        req = quiet.urllib.request.Request(self.url + path, data=data, method="POST" if data is not None else "GET")
        try:
            with quiet.urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_get(self):
        self.assertEqual(self.ask("/quiet"), (200, {"turtle": True, "hand": False}))
        self.assertEqual(self.ask("/other")[0], 404)
        self.state.pop("status")
        with mock.patch.object(quiet, "turtle", return_value=False):
            self.assertEqual(self.ask("/quiet/"), (200, {"turtle": False, "hand": False}))

    def test_post(self):
        with mock.patch.object(quiet, "switch", return_value={"turtle": False, "hand": True}) as sw:
            self.assertEqual(self.ask("/quiet", {"turtle": False}), (200, {"turtle": False, "hand": True}))
        sw.assert_called_once_with(self.state, False)
        self.assertEqual(self.ask("/quiet", {"turtle": "yes"})[0], 400)
        self.assertEqual(self.ask("/quiet", b"not json")[0], 400)
        self.assertEqual(self.ask("/other", {"turtle": True})[0], 404)
        with mock.patch.object(quiet, "switch", side_effect=RuntimeError("Transmission away")):
            self.assertEqual(self.ask("/quiet", {"turtle": True}), (502, {"error": "Transmission away"}))


class Restore(unittest.TestCase):
    def restore(self, text):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(quiet, "STATUS", os.path.join(d, "q.json")):
            if text is not None:
                with open(quiet.STATUS, "w") as f:
                    f.write(text)
            return quiet.restore({})

    def test_restore(self):
        self.assertEqual(self.restore(None), {})
        self.assertEqual(self.restore("junk"), {})
        self.assertEqual(self.restore('{"turtle": true, "hand": true}'), {"ours": True})  # before the switch
        self.assertEqual(self.restore('{"turtle": true, "ours": false, "held": null}'), {"ours": False})
        self.assertEqual(self.restore('{"turtle": false, "ours": false, "held": true}'), {"ours": False, "hand": True})

    def test_round_trip(self):
        state = {"ours": False, "hand": True, "want": True}
        with tempfile.TemporaryDirectory() as d, mock.patch.object(quiet, "STATUS", os.path.join(d, "q.json")):
            quiet.publish(state, False)
            self.assertEqual(quiet.restore({}), {"ours": False, "hand": True})
