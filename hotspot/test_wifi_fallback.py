"""Tests of hotspot/wifi_fallback.py, with nmcli, iw, ping, files, Discord and
the clock mocked: python3 -m unittest hotspot/test_wifi_fallback.py"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import wifi_fallback as wf  # noqa: E402

H = wf.HOTSPOT


class Stop(BaseException):
    """Ends main()'s endless loop from a mocked time.sleep."""


class Run(unittest.TestCase):
    def test_returns_code_and_output(self):
        done = subprocess.CompletedProcess([], 3, "out", "")
        with mock.patch.object(subprocess, "run", return_value=done) as run:
            self.assertEqual(wf.run("nmcli", "x", timeout=7), (3, "out"))
        run.assert_called_once_with(("nmcli", "x"), capture_output=True, text=True, timeout=7)

    def test_timeout_and_missing_command_are_failures(self):
        for error in (subprocess.TimeoutExpired("iw", 30), OSError("no iw")):
            with mock.patch.object(subprocess, "run", side_effect=error):
                code, out = wf.run("iw")
            self.assertEqual((code, out), (1, str(error)))


class Env(unittest.TestCase):
    def test_read_env(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, ".env").write_text("# c\n\nHOTSPOT_SSID = net \nHOTSPOT_PASSWORD='p w'\nbad\n")
            with mock.patch.object(wf, "PROJECT", Path(d)):
                self.assertEqual(wf.read_env(), {"HOTSPOT_SSID": "net", "HOTSPOT_PASSWORD": "p w"})

    def test_missing_env(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(wf, "PROJECT", Path(d)):
            self.assertEqual(wf.read_env(), {})

    def test_post(self):
        with mock.patch("urllib.request.urlopen") as urlopen:
            wf.post("https://d/1", "hi")
            wf.post("https://d/1/slack", "hi")
        bodies = [json.loads(c[0][0].data) for c in urlopen.call_args_list]
        self.assertEqual(bodies, [{"content": "hi", "username": "Mediaserver watchdog"},
                                  {"text": "hi", "username": "Mediaserver watchdog"}])

    def test_log(self):
        with mock.patch("builtins.print") as p:
            wf.log("x")
        p.assert_called_once_with("x", flush=True)


class Links(unittest.TestCase):
    def test_active_connection(self):
        with mock.patch.object(wf, "run", return_value=(0, " home \n")) as run:
            self.assertEqual(wf.active_connection(), "home")
        run.assert_called_once_with("nmcli", "-g", "GENERAL.CONNECTION", "device", "show", "wlan0")

    def test_link_works_pings_the_gateway(self):
        replies = [(0, "100 (connected)\nhome\n192.168.1.1\n"), (0, "")]
        with mock.patch.object(wf, "run", side_effect=replies) as run:
            self.assertTrue(wf.link_works("wlan0"))
        run.assert_called_with("ping", "-c", "2", "-W", "2", "-I", "wlan0", "192.168.1.1", timeout=10)

    def test_link_does_not_work(self):
        for out, ping in [
            ("30 (disconnected)\n\n\n", None),
            (f"100 (connected)\n{H}\n10.42.0.1\n", None),
            ("100 (connected)\nhome\n\n", None),
            ("", None),
            ("100 (connected)\nhome\n192.168.1.1\n", (1, "")),
        ]:
            replies = [(0, out)] + ([ping] if ping else [])
            with mock.patch.object(wf, "run", side_effect=replies) as run:
                self.assertFalse(wf.link_works("eth0"), out)
            self.assertEqual(run.call_count, len(replies))

    def test_home_link_prefers_the_cable(self):
        with mock.patch.object(wf, "link_works", side_effect=lambda i: True) as works:
            self.assertEqual(wf.home_link(), "eth0")
        works.assert_called_once_with("eth0")
        with mock.patch.object(wf, "link_works", side_effect=lambda i: i == "wlan0"):
            self.assertEqual(wf.home_link(), "wlan0")
        with mock.patch.object(wf, "link_works", return_value=False):
            self.assertIsNone(wf.home_link())

    def test_known_wifis(self):
        profiles = "\n".join([
            "home:802-11-wireless", f"{H}:802-11-wireless", "Wired:802-3-ethernet",
            "my\\:net:802-11-wireless", "ap:802-11-wireless", "empty:802-11-wireless",
        ])
        details = {
            "home": "HomeNet\ninfrastructure\n",
            "my:net": "Café\n\n",
            "ap": "Mine\nap\n",
            "empty": "\n\n",
        }

        def run(*cmd, timeout=30):
            if cmd[1] == "-t":
                return 0, profiles
            return 0, details[cmd[-1]]

        with mock.patch.object(wf, "run", side_effect=run) as fake:
            self.assertEqual(wf.known_wifis(), {"HomeNet": "home", "Café": "my:net"})
        self.assertEqual(fake.call_count, 5)

    def test_scan(self):
        out = "BSS 1\n\tSSID: HomeNet\n\tfoo\n  SSID: Other net\n"
        with mock.patch.object(wf, "run", return_value=(0, out)) as run:
            self.assertEqual(wf.scan(), {"HomeNet", "Other net"})
        run.assert_called_once_with("iw", "dev", "wlan0", "scan", timeout=30)
        with mock.patch.object(wf, "run", side_effect=[(240, ""), (0, out)]) as run:
            self.assertEqual(wf.scan(), {"HomeNet", "Other net"})
        run.assert_called_with("iw", "dev", "wlan0", "scan", "ap-force", timeout=30)
        with mock.patch.object(wf, "run", return_value=(1, "busy")):
            self.assertIsNone(wf.scan())

    def test_home_address(self):
        with mock.patch.object(wf, "run", return_value=(0, "192.168.1.229/24 | 10.0.0.2/8\n")):
            self.assertEqual(wf.home_address("wlan0"), "192.168.1.229/24")


class Hotspot(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        for p in [mock.patch.object(wf, "ADDRESS_FILE", Path(self.dir.name, "address")),
                  mock.patch.object(wf, "DNS_FILE", Path(self.dir.name, "dns", "fallback.conf")),
                  mock.patch("socket.gethostname", return_value="dpi")]:
            p.start()
            self.addCleanup(p.stop)

    def test_saved_address(self):
        self.assertEqual(wf.saved_address(), "")
        wf.ADDRESS_FILE.write_text("192.168.1.229/24\n")
        self.assertEqual(wf.saved_address(), "192.168.1.229/24")

    def test_set_hotspot_address(self):
        with mock.patch.object(wf, "run", return_value=(0, "")) as run, mock.patch.object(wf, "log") as log:
            wf.set_hotspot_address("192.168.1.229/24")
        run.assert_called_once_with("nmcli", "connection", "modify", H, "ipv4.addresses", "192.168.1.229/24")
        log.assert_not_called()
        self.assertEqual(wf.DNS_FILE.read_text(), "address=/dpi.lan/192.168.1.229\n")
        with mock.patch.object(wf, "run", return_value=(10, " no profile \n")), mock.patch.object(wf, "log") as log:
            wf.set_hotspot_address("10.42.0.1/24")
        log.assert_called_once_with("cannot set the hotspot address 10.42.0.1/24: no profile")
        self.assertEqual(wf.DNS_FILE.read_text(), "address=/dpi.lan/10.42.0.1\n")

    def test_profile_needs_a_password(self):
        with mock.patch.object(wf, "run") as run, self.assertRaises(SystemExit):
            wf.ensure_hotspot_profile({"HOTSPOT_PASSWORD": "short"})
        run.assert_not_called()

    def test_profile_is_created_then_set(self):
        with mock.patch.object(wf, "run", side_effect=[(10, ""), (0, ""), (0, "")]) as run:
            self.assertEqual(wf.ensure_hotspot_profile({"HOTSPOT_PASSWORD": "12345678"}), "dpi-hotspot")
        calls = run.call_args_list
        self.assertEqual(calls[0], mock.call("nmcli", "connection", "show", H))
        self.assertEqual(calls[1], mock.call("nmcli", "connection", "add", "type", "wifi", "con-name", H,
                                             "ifname", "wlan0", "ssid", "dpi-hotspot"))
        settings = calls[2][0]
        self.assertEqual(settings[:4], ("nmcli", "connection", "modify", H))
        pairs = dict(zip(settings[4::2], settings[5::2]))
        self.assertEqual(pairs["802-11-wireless.band"], "a")
        self.assertEqual(pairs["802-11-wireless.channel"], "36")
        self.assertEqual(pairs["wifi-sec.psk"], "12345678")
        self.assertEqual(pairs["wifi-sec.pmf"], "disable")
        self.assertEqual(len(settings), 4 + 2 * 14)

    def test_existing_profile_is_only_set(self):
        with mock.patch.object(wf, "run", side_effect=[(0, ""), (0, "")]) as run:
            self.assertEqual(wf.ensure_hotspot_profile({"HOTSPOT_SSID": "mine", "HOTSPOT_PASSWORD": "abcdefgh"}),
                             "mine")
        self.assertEqual(run.call_count, 2)
        with mock.patch.object(wf, "run", side_effect=[(0, ""), (2, "bad key")]), \
                self.assertRaisesRegex(SystemExit, "bad key"):
            wf.ensure_hotspot_profile({"HOTSPOT_PASSWORD": "abcdefgh"})

    def test_start_hotspot(self):
        with mock.patch.object(wf, "run", return_value=(0, "")) as run:
            self.assertTrue(wf.start_hotspot())
        run.assert_called_once_with("nmcli", "connection", "up", H, timeout=wf.JOIN_TIMEOUT)
        with mock.patch.object(wf, "run", return_value=(4, " no beacon \n")), mock.patch.object(wf, "log") as log:
            self.assertFalse(wf.start_hotspot())
        log.assert_called_once_with("hotspot failed to start: no beacon")


class Rejoin(unittest.TestCase):
    def test_named_profile(self):
        with mock.patch.object(wf, "run", return_value=(0, "")) as run, \
                mock.patch.object(wf, "home_link", side_effect=[None, "wlan0"]), \
                mock.patch("time.sleep") as sleep:
            self.assertEqual(wf.try_rejoin("home"), "wlan0")
        self.assertEqual(run.call_args_list, [
            mock.call("nmcli", "connection", "down", H),
            mock.call("nmcli", "--wait", "60", "connection", "up", "home", timeout=65),
        ])
        sleep.assert_called_once_with(5)

    def test_any_profile_waits_for_autoconnect_then_gives_up(self):
        with mock.patch.object(wf, "run", return_value=(0, "")) as run, \
                mock.patch.object(wf, "home_link", return_value=None) as link, \
                mock.patch("time.sleep") as sleep:
            self.assertIsNone(wf.try_rejoin(None))
        run.assert_called_once_with("nmcli", "connection", "down", H)
        self.assertEqual(link.call_count, 4)
        self.assertEqual(sleep.call_args_list, [mock.call(60)] + [mock.call(5)] * 4)


class Checks(unittest.TestCase):
    """One round of the loop at a time, every helper mocked."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.m = {}
        for name in ["home_link", "active_connection", "home_address", "set_hotspot_address", "post",
                     "start_hotspot", "link_works", "run", "known_wifis", "scan", "try_rejoin", "log"]:
            p = mock.patch.object(wf, name)
            self.m[name] = p.start()
            self.addCleanup(p.stop)
        p = mock.patch.object(wf, "ADDRESS_FILE", Path(self.dir.name, "sub", "address"))
        p.start()
        self.addCleanup(p.stop)
        self.fb = wf.Fallback("dpi-hotspot", None, "10.42.0.1/24", "https://d/1", "dpi")

    def logs(self):
        return [c[0][0] for c in self.m["log"].call_args_list]

    def test_home_works_learns_the_address_and_posts_the_pending_message(self):
        self.m["home_link"].return_value = "eth0"
        self.m["home_address"].return_value = "192.168.1.229/24"
        self.fb.broken_since = 5
        self.fb.pending_message = "back"
        self.assertTrue(self.fb.check(100))
        self.assertIsNone(self.fb.broken_since)
        self.assertEqual(self.fb.address, "192.168.1.229/24")
        self.assertEqual(wf.ADDRESS_FILE.read_text(), "192.168.1.229/24\n")
        self.m["set_hotspot_address"].assert_called_once_with("192.168.1.229/24")
        self.m["post"].assert_called_once_with("https://d/1", "back")
        self.assertIsNone(self.fb.pending_message)

    def test_home_works_keeps_a_fixed_or_same_address_and_retries_a_failed_post(self):
        self.m["home_link"].return_value = "wlan0"
        self.m["home_address"].return_value = "192.168.1.229/24"
        self.m["post"].side_effect = OSError("down")
        fixed = wf.Fallback("s", "192.168.1.50/24", "192.168.1.50/24", "https://d/1", "dpi")
        fixed.pending_message = "back"
        fixed.check(100)
        self.assertEqual(fixed.address, "192.168.1.50/24")
        self.assertEqual(fixed.pending_message, "back")
        self.assertEqual(self.logs(), ["Discord post failed: down"])
        self.m["home_address"].return_value = ""
        self.fb.check(100)
        self.m["set_hotspot_address"].assert_not_called()
        self.assertFalse(wf.ADDRESS_FILE.exists())

    def test_no_webhook_keeps_the_message(self):
        self.m["home_link"].return_value = "wlan0"
        self.m["home_address"].return_value = "10.42.0.1/24"
        fb = wf.Fallback("s", None, "10.42.0.1/24", None, "dpi")
        fb.pending_message = "back"
        fb.check(100)
        self.m["post"].assert_not_called()

    def test_hotspot_opened_by_hand_is_taken_over(self):
        self.m["home_link"].return_value = None
        self.m["active_connection"].return_value = H
        self.fb.check(100)
        self.assertEqual((self.fb.hotspot_since, self.fb.last_scan, self.fb.last_blind), (100, 100, 100))
        fb = wf.Fallback("s", None, "a", None, "h")
        fb.broken_since = 40
        fb.check(100)
        self.assertEqual(fb.hotspot_since, 40)

    def test_hotspot_opens_after_the_grace(self):
        self.m["home_link"].return_value = None
        self.m["active_connection"].return_value = "home"
        self.fb.check(1000)
        self.assertEqual(self.fb.broken_since, 1000)
        self.m["start_hotspot"].assert_not_called()
        self.m["start_hotspot"].return_value = False
        self.fb.check(1000 + wf.GRACE)
        self.assertEqual(self.fb.broken_since, 1000 + wf.GRACE)
        self.assertIsNone(self.fb.hotspot_since)
        self.m["start_hotspot"].return_value = True
        self.fb.check(1000 + 2 * wf.GRACE)
        self.assertEqual(self.fb.hotspot_since, 1000 + wf.GRACE)
        self.assertEqual(self.fb.last_scan, 1000 + 2 * wf.GRACE)
        self.assertEqual(self.logs(), [
            "home network down for 180 s, opening hotspot dpi-hotspot",
            "home network down for 180 s, opening hotspot dpi-hotspot",
        ])

    def on_hotspot(self, since=0):
        self.fb.hotspot_since = since
        self.fb.broken_since = since
        self.fb.last_scan = self.fb.last_blind = since

    def test_cable_back_closes_the_hotspot(self):
        self.on_hotspot()
        self.m["link_works"].return_value = True
        self.m["active_connection"].return_value = "Wired connection 1"
        with mock.patch("time.time", return_value=600):
            self.assertFalse(self.fb.check(600))
        self.m["run"].assert_called_once_with("nmcli", "connection", "down", H)
        self.m["active_connection"].assert_called_once_with("eth0")
        self.assertIsNone(self.fb.hotspot_since)
        self.assertIsNone(self.fb.broken_since)
        self.assertEqual(self.fb.pending_message, "📶 **dpi**: lost the home network, ran its own hotspot "
                                                  "`dpi-hotspot` for 10 min, now back on `Wired connection 1`.")
        self.assertEqual(self.logs()[-1], "back on Wired connection 1, hotspot closed after 10 min")

    def test_hotspot_gone_on_its_own(self):
        self.on_hotspot()
        self.m["link_works"].return_value = False
        self.m["active_connection"].return_value = ""
        self.m["home_link"].return_value = None
        self.assertTrue(self.fb.check(30))
        self.m["start_hotspot"].assert_called_once_with()
        self.m["home_link"].return_value = "wlan0"
        with mock.patch("time.time", return_value=120):
            self.assertFalse(self.fb.check(120))
        self.assertIn("now back on `wlan0`", self.fb.pending_message)

    def test_no_scan_before_scan_every(self):
        self.on_hotspot()
        self.m["link_works"].return_value = False
        self.m["active_connection"].return_value = H
        self.assertTrue(self.fb.check(wf.SCAN_EVERY - 1))
        self.m["known_wifis"].assert_not_called()

    def test_scan_sees_nothing_and_blind_try_not_due(self):
        self.on_hotspot()
        self.m["link_works"].return_value = False
        self.m["active_connection"].return_value = H
        self.m["known_wifis"].return_value = {"HomeNet": "home"}
        self.m["scan"].return_value = None
        self.assertTrue(self.fb.check(wf.SCAN_EVERY))
        self.assertEqual(self.fb.last_scan, wf.SCAN_EVERY)
        self.m["try_rejoin"].assert_not_called()

    def test_known_wifi_seen_and_rejoined(self):
        self.on_hotspot()
        self.m["link_works"].return_value = False
        self.m["active_connection"].side_effect = [H, "home"]
        self.m["known_wifis"].return_value = {"Other": "other", "HomeNet": "home"}
        self.m["scan"].return_value = {"HomeNet", "Neighbour"}
        self.m["try_rejoin"].return_value = "wlan0"
        with mock.patch("time.time", return_value=300):
            self.assertFalse(self.fb.check(100))
        self.m["try_rejoin"].assert_called_once_with("home")
        self.assertEqual(self.fb.last_blind, 100)
        self.assertIn("trying to rejoin home", self.logs())

    def test_blind_try_fails_and_the_hotspot_comes_back(self):
        self.on_hotspot()
        self.m["link_works"].return_value = False
        self.m["active_connection"].return_value = H
        self.m["known_wifis"].return_value = {}
        self.m["scan"].return_value = set()
        self.m["try_rejoin"].return_value = None
        self.m["start_hotspot"].return_value = True
        self.assertTrue(self.fb.check(wf.BLIND_EVERY))
        self.m["try_rejoin"].assert_called_once_with(None)
        self.assertEqual(self.fb.hotspot_since, 0)
        self.assertEqual(self.logs(), ["trying to rejoin any known wifi", "rejoin failed, reopening the hotspot"])

    def test_hotspot_that_cannot_reopen_goes_back_to_waiting(self):
        self.on_hotspot()
        self.m["link_works"].return_value = False
        self.m["active_connection"].return_value = H
        self.m["known_wifis"].return_value = {}
        self.m["scan"].return_value = set()
        self.m["try_rejoin"].return_value = None
        self.m["start_hotspot"].return_value = False
        with mock.patch("time.time", return_value=5000):
            self.assertTrue(self.fb.check(wf.BLIND_EVERY))
        self.assertIsNone(self.fb.hotspot_since)
        self.assertEqual(self.fb.broken_since, 5000)


class Main(unittest.TestCase):
    def test_setup_then_rounds_with_sleeps_between(self):
        calls = []
        rounds = iter([True, False, True])

        def check(self, now):
            calls.append(("check", now))
            return next(rounds)

        def sleep(s):
            calls.append(("sleep", s))
            if len(calls) >= 5:
                raise Stop

        env = {"HOTSPOT_PASSWORD": "12345678", "AUTOHEAL_WEBHOOK_URL": "https://d/2"}
        with mock.patch.object(wf, "read_env", return_value=env), \
                mock.patch.object(wf, "ensure_hotspot_profile", return_value="dpi-hotspot"), \
                mock.patch.object(wf, "saved_address", return_value=""), \
                mock.patch.object(wf, "set_hotspot_address") as set_address, \
                mock.patch.object(wf, "active_connection", return_value=H), \
                mock.patch("socket.gethostname", return_value="dpi"), \
                mock.patch("time.time", side_effect=[10, 20, 30, 40]), \
                mock.patch("time.sleep", sleep), \
                mock.patch.object(wf, "log") as log, \
                mock.patch.object(wf.Fallback, "check", check), \
                self.assertRaises(Stop):
            wf.main()
        set_address.assert_called_once_with(wf.DEFAULT_ADDRESS)
        log.assert_called_once_with("started, hotspot up, hotspot address 10.42.0.1/24")
        self.assertEqual(calls, [("check", 20), ("sleep", wf.TICK), ("check", 30), ("check", 40),
                                 ("sleep", wf.TICK)])

    def test_fixed_address_and_home_network_at_start(self):
        made = []
        with mock.patch.object(wf, "read_env", return_value={"HOTSPOT_ADDRESS": "192.168.1.50/24",
                                                             "WATCHDOG_WEBHOOK_URL": "https://d/1"}), \
                mock.patch.object(wf, "ensure_hotspot_profile", return_value="s"), \
                mock.patch.object(wf, "saved_address") as saved, \
                mock.patch.object(wf, "set_hotspot_address"), \
                mock.patch.object(wf, "active_connection", return_value="home"), \
                mock.patch("socket.gethostname", return_value="dpi"), \
                mock.patch.object(wf, "log") as log, \
                mock.patch.object(wf.Fallback, "check", lambda self, now: made.append(self) or True), \
                mock.patch("time.sleep", side_effect=Stop), \
                self.assertRaises(Stop):
            wf.main()
        saved.assert_not_called()
        log.assert_called_once_with("started, on the home network, hotspot address 192.168.1.50/24")
        fb = made[0]
        self.assertEqual((fb.fixed, fb.address, fb.webhook, fb.host, fb.hotspot_since),
                         ("192.168.1.50/24", "192.168.1.50/24", "https://d/1", "dpi", None))


if __name__ == "__main__":
    unittest.main()
