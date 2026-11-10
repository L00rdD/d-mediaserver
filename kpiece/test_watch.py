"""Tests of kpiece/watch.py, without network: python3 -m unittest kpiece/test_watch.py"""

import importlib.util
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

# loaded by path under its own name: printer/watch.py is also "watch"
_spec = importlib.util.spec_from_file_location(
    "kpiece_watch", os.path.join(os.path.dirname(os.path.abspath(__file__)), "watch.py"))
watch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(watch)

SAGAS = [{"saganame": "elbaf", "arcssearch": ["elbaf"], "arcsname": ["Elbaf"]}]
SCANS = [{"scan": "1160", "name": "Old", "date": "02 Octobre 2026", "maxpages": 15},
         {"scan": "1161", "name": "Loki", "date": "09 Octobre 2026", "maxpages": 17}]
NEXT = {"nextscan": "16-10-2026", "nextscan_time": "14:00:00"}


class Stop(BaseException):
    """Ends main()'s endless loop from a mocked time.sleep."""


def cdn(saga=SAGAS, scans=SCANS, nxt=NEXT):
    pages = {"data/saga.json": saga, "data/saga/elbaf/elbaf.json": scans, "data/nextscan/nextscan.json": nxt}
    return mock.patch.object(watch, "get", side_effect=lambda path: pages[path])


class Helpers(unittest.TestCase):
    def test_log_stamps_the_line(self):
        with mock.patch("builtins.print") as p:
            watch.log("hi")
        stamp, msg = p.call_args[0]
        self.assertEqual(msg, "hi")
        datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S")

    def test_get_reads_json_from_the_cdn(self):
        answer = mock.MagicMock()
        answer.__enter__.return_value = io.BytesIO(b'{"a": 1}')
        with mock.patch("urllib.request.urlopen", return_value=answer) as urlopen:
            self.assertEqual(watch.get("data/saga.json"), {"a": 1})
        req = urlopen.call_args[0][0]
        self.assertEqual(req.full_url, "https://cdn.kpiece.fr/data/saga.json")
        self.assertEqual(urlopen.call_args[1], {"timeout": 20})

    def test_french_date(self):
        self.assertEqual(watch.french_date("08 Octobre 2026"), "2026-10-08")
        self.assertEqual(watch.french_date(" 1 Août 2026 "), "2026-08-01")
        self.assertEqual(watch.french_date("3 fevrier 2027"), "2027-02-03")
        self.assertIsNone(watch.french_date("08 Brumaire 2026"))
        self.assertIsNone(watch.french_date("demain"))


class Check(unittest.TestCase):
    def test_status_of_the_latest_scan_and_the_next(self):
        with cdn():
            status = watch.check()
        self.assertEqual(status["latest"], {
            "scan": 1161, "name": "Loki", "date": "2026-10-09", "pages": 17, "arc": "Elbaf",
            "url": "https://www.kpiece.fr/scan/elbaf/elbaf/1161/1",
        })
        self.assertEqual(status["next"], {"scan": 1162, "at": "2026-10-16T14:00:00+02:00"})
        datetime.fromisoformat(status["checked_at"])

    def test_missing_names_dates_and_times(self):
        saga = [{"saganame": "s", "arcssearch": ["a"]}]
        scans = [{"scan": "7", "date": "bientot"}]
        pages = {"data/saga.json": saga, "data/saga/s/a.json": scans,
                 "data/nextscan/nextscan.json": {"nextscan": "16-10-2026", "nextscan_time": ""}}
        with mock.patch.object(watch, "get", side_effect=lambda p: pages[p]):
            status = watch.check()
        self.assertEqual(status["latest"]["arc"], "a")
        self.assertEqual(status["latest"]["name"], "")
        self.assertEqual(status["latest"]["date"], "bientot")
        self.assertIsNone(status["latest"]["pages"])
        self.assertEqual(status["next"]["at"], "2026-10-16T00:00:00+02:00")

    def test_next_date_not_understood(self):
        for nxt in ({}, {"nextscan": "soon"}):
            with cdn(nxt=nxt), mock.patch.object(watch, "log") as log:
                self.assertIsNone(watch.check()["next"])
            log.assert_called_once_with(f"next scan date not understood: {nxt!r}")


class Files(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        p = mock.patch.object(watch, "STATUS", self.dir.name)
        p.start()
        self.addCleanup(p.stop)

    def test_write_replaces_the_file(self):
        watch.write("kpiece.json", "x\n")
        watch.write("kpiece.json", "y\n")
        self.assertEqual(os.listdir(self.dir.name), ["kpiece.json"])
        with open(os.path.join(self.dir.name, "kpiece.json")) as f:
            self.assertEqual(f.read(), "y\n")

    def test_read_seen(self):
        self.assertIsNone(watch.read_seen())
        watch.write("kpiece-seen", "garbage")
        self.assertIsNone(watch.read_seen())
        watch.write("kpiece-seen", "1161\n")
        self.assertEqual(watch.read_seen(), 1161)


class Notify(unittest.TestCase):
    def payload(self, latest):
        with mock.patch.object(watch, "WEBHOOK", "https://d/1"), mock.patch("urllib.request.urlopen") as urlopen:
            watch.notify(latest)
        urlopen.return_value.close.assert_called_once_with()
        req = urlopen.call_args[0][0]
        self.assertEqual(req.full_url, "https://d/1")
        return json.loads(req.data)

    def test_full_and_bare_embeds(self):
        latest = {"scan": 1161, "name": "Loki", "url": "https://k/1161", "arc": "Elbaf", "pages": 17}
        body = self.payload(latest)
        self.assertEqual(body["content"], "Le scan 1161 de One Piece est sorti ! https://k/1161")
        self.assertEqual(body["embeds"][0]["title"], "Scan 1161 : Loki")
        self.assertEqual(body["embeds"][0]["description"], "Arc Elbaf, 17 pages")
        self.assertNotIn("username", body)
        embed = self.payload(dict(latest, name="", pages=None))["embeds"][0]
        self.assertEqual((embed["title"], embed["description"]), ("Scan 1161", "Arc Elbaf"))


class WaitTime(unittest.TestCase):
    def status(self, delta):
        at = datetime.now(watch.PARIS) + delta
        return {"next": {"at": at.isoformat(timespec="seconds")}}

    def test_fast_around_the_release_only(self):
        self.assertEqual(watch.wait_time(None), watch.INTERVAL)
        self.assertEqual(watch.wait_time({"next": None}), watch.INTERVAL)
        self.assertEqual(watch.wait_time(self.status(timedelta(minutes=3))), watch.FAST_INTERVAL)
        self.assertEqual(watch.wait_time(self.status(timedelta(hours=-5))), watch.FAST_INTERVAL)
        self.assertEqual(watch.wait_time(self.status(timedelta(hours=1))), watch.INTERVAL)
        self.assertEqual(watch.wait_time(self.status(timedelta(hours=-7))), watch.INTERVAL)


class Main(unittest.TestCase):
    def run_main(self, seen, statuses, webhook=""):
        written, sleeps = [], []

        def sleep(s):
            sleeps.append(s)
            if len(sleeps) == len(statuses):
                raise Stop

        with mock.patch.object(watch, "read_seen", return_value=seen), \
                mock.patch.object(watch, "check", side_effect=statuses), \
                mock.patch.object(watch, "write", side_effect=lambda n, t: written.append((n, t))), \
                mock.patch.object(watch, "notify") as notify, \
                mock.patch.object(watch, "WEBHOOK", webhook), \
                mock.patch.object(watch, "wait_time", side_effect=lambda s: 60 if s else 300), \
                mock.patch.object(watch, "log") as log, \
                mock.patch("time.sleep", sleep), \
                self.assertRaises(Stop):
            watch.main()
        return written, sleeps, notify, [c[0][0] for c in log.call_args_list]

    def status(self, n):
        return {"latest": {"scan": n, "url": f"https://k/{n}"}, "next": None}

    def test_first_run_only_remembers(self):
        written, sleeps, notify, logs = self.run_main(None, [self.status(1161)], webhook="https://d/1")
        self.assertEqual(written[1], ("kpiece-seen", "1161\n"))
        json.loads(written[0][1])
        notify.assert_not_called()
        self.assertEqual(sleeps, [60])
        self.assertEqual(logs, ["watching KPIECE every 300 s, Discord on, last scan seen: None"])

    def test_new_scan_is_posted_once(self):
        statuses = [self.status(1161), self.status(1162), self.status(1162)]
        written, _, notify, logs = self.run_main(1161, statuses, webhook="https://d/1")
        notify.assert_called_once_with(statuses[1]["latest"])
        self.assertEqual([w for w in written if w[0] == "kpiece-seen"], [("kpiece-seen", "1162\n")])
        self.assertIn("scan 1162 is out: https://k/1162", logs)

    def test_without_webhook_nothing_is_posted(self):
        _, _, notify, logs = self.run_main(1161, [self.status(1162)])
        notify.assert_not_called()
        self.assertIn("Discord off", logs[0])

    def test_failure_is_logged_and_waits_the_normal_time(self):
        _, sleeps, _, logs = self.run_main(1, [OSError("cdn down")])
        self.assertEqual(sleeps, [300])
        self.assertEqual(logs[-1], "check failed: OSError('cdn down')")


if __name__ == "__main__":
    unittest.main()
