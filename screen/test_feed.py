"""Tests of screen/feed.py, without network: python3 -m unittest screen/test_feed.py"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import feed  # noqa: E402

CHECKED = datetime(2026, 11, 4, 17, 40, 42, tzinfo=timezone.utc)
S3 = "https://cloud-slice-prod.s3.us-east-2.amazonaws.com/cloud/a.jpg?X-Amz-Date=20261104T174041Z"


def status(**job):
    """printer.json as the printer service writes it, a print going on."""
    return {
        "online": True, "host": "M7.lan", "name": "Anycubic Photon Mono M7", "cloud": "ok",
        "job": {"state": "printing", "active": True, "name": "01_Cafetière", "progress": 2.0,
                "layer": 89.0, "layers": 2978.0, "remaining_min": 312.0,
                "started_at": "2026-11-04T17:18:40+00:00", "image": S3, **job},
        "checked_at": CHECKED.isoformat(),
    }


def shown(**job):
    return feed.printer(status(**job), CHECKED + timedelta(seconds=10))


class Printer(unittest.TestCase):
    def test_a_print_going_on(self):
        p = shown()
        self.assertEqual(p["name"], "Anycubic Photon Mono M7")
        self.assertEqual((p["file"], p["state"], p["active"]), ("01_Cafetière", "printing", True))
        self.assertEqual((p["progress"], p["layer"], p["layers"]), (2.0, 89, 2978))
        self.assertEqual(p["remaining"], 312 * 60)
        self.assertEqual(datetime.fromisoformat(p["ends_at"]), CHECKED + timedelta(minutes=312))
        self.assertEqual(p["image"], S3)

    def test_the_file_name_is_composed(self):
        self.assertEqual(shown(name="01_Cafetie\u0300re")["file"], "01_Cafetière")

    def test_off_or_absent_is_none(self):
        self.assertIsNone(feed.printer(None, CHECKED))
        self.assertIsNone(feed.printer({**status(), "online": False}, CHECKED))

    def test_a_stale_file_is_none(self):
        self.assertIsNone(feed.printer(status(), CHECKED + timedelta(seconds=feed.PRINTER_FRESH + 1)))

    def test_a_bad_time_is_none(self):
        self.assertIsNone(feed.printer({**status(), "checked_at": "never"}, CHECKED))
        self.assertIsNone(feed.printer({"online": True}, CHECKED))

    def test_without_progress_the_share_of_layers(self):
        self.assertEqual(shown(progress=None, layer=1489.0)["progress"], 50.0)
        self.assertIsNone(shown(progress=None, layers=None)["progress"])

    def test_no_time_left_once_finished(self):
        p = shown(state="done", active=False)
        self.assertIsNone(p["remaining"])
        self.assertIsNone(p["ends_at"])

    def test_on_without_a_cloud_shows_no_print(self):
        p = feed.printer({**status(), "cloud": "no token", "job": None}, CHECKED)
        self.assertEqual((p["cloud"], p["state"], p["file"], p["image"]), ("no token", None, None, None))


class Preview(unittest.TestCase):
    def test_the_service_copy_once_it_is_there(self):
        job = {"preview": "/printer.jpg?v=1", "image": S3}
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(feed, "STATUS", tmp):
            self.assertEqual(feed.preview(job), S3)
            open(os.path.join(tmp, "printer.jpg"), "wb").close()
            self.assertEqual(feed.preview(job), "/printer.jpg?v=1")

    def test_anycubic_link_without_a_copy(self):
        self.assertEqual(feed.preview({"image": S3}), S3)
        self.assertIsNone(feed.preview({}))


class PrintPhase(unittest.TestCase):
    JOB = ["01_Cafetière", "2026-11-04T17:18:40+00:00"]

    def at(self, state, job=None):
        return {"job": job or self.JOB, "state": state}

    def test_unknown_states_are_not_compared(self):
        self.assertIsNone(feed.print_job(None))
        self.assertIsNone(feed.print_job({"state": "unknown"}))
        self.assertEqual(feed.print_job(shown()), self.at("printing"))

    def test_first_layers_start_it(self):
        self.assertEqual(feed.print_phase(self.at("levelling"), self.at("printing")), "started")
        self.assertEqual(feed.print_phase(None, self.at("printing")), "started")
        self.assertEqual(feed.print_phase(self.at("done", ["old", "x"]), self.at("printing")), "started")

    def test_printing_on_is_no_news(self):
        self.assertIsNone(feed.print_phase(self.at("printing"), self.at("printing")))

    def test_its_end(self):
        self.assertEqual(feed.print_phase(self.at("printing"), self.at("done")), "done")
        self.assertEqual(feed.print_phase(self.at("printing"), self.at("cancelled")), "cancelled")
        self.assertIsNone(feed.print_phase(self.at("done"), self.at("done")))
        # the last print of the day, seen done when the printer comes on: no news
        self.assertIsNone(feed.print_phase(None, self.at("done")))
        self.assertIsNone(feed.print_phase(self.at("printing"), None))
        self.assertIsNone(feed.print_phase(self.at("printing"), self.at("preheating")))


class Sources(unittest.TestCase):
    """Feed.tick with every source stubbed: lists of what each pass reads."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.files = {"kpiece.json": None, "disk.json": None, "services.json": None, "printer.json": None}
        self.house = {"outlets": [{"id": "lamp", "name": "Lamp", "on": False}],
                      "covers": [{"id": "screen", "name": "Screen", "moving": None}],
                      "projectors": [{"id": "pj", "name": "Projector", "on": False, "app": None}]}
        self.torrents = []
        self.playing = []
        self.history = []
        for name, value in {
            "STATUS": self.tmp.name, "SETTINGS": os.path.join(self.tmp.name, "s.json"),
            "read_status": lambda name: self.files.get(name),
            "get": lambda url, *a, **k: json.loads(json.dumps(self.house)),
            "transmission": lambda: self.torrents,
            "jellyfin": lambda: self.playing,
            "jellyfin_resume": lambda: [],
            "imports": lambda app, key, url: [x for x in self.history if x["id"].startswith(app)],
            "draupnir": lambda: {"name": "Draupnir"},
            "now": lambda: CHECKED.astimezone(),
        }.items():
            patcher = mock.patch.object(feed, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.feed = feed.Feed()

    def kinds(self):
        return [(e["kind"], e.get("phase") or e.get("name") or e.get("title")) for e in self.feed.events]

    def test_the_first_pass_only_records(self):
        self.files["printer.json"] = status()
        doc = self.feed.tick()
        self.assertEqual(doc["events"], [])
        self.assertEqual(doc["printer"]["file"], "01_Cafetière")
        self.assertEqual(doc["portfolio"], {"name": "Draupnir"})
        self.assertEqual(doc["errors"], {})

    def test_each_change_is_one_event(self):
        self.feed.tick()
        self.house["outlets"][0]["on"] = True
        self.house["covers"][0]["moving"] = "down"
        self.house["projectors"][0]["on"] = True
        self.torrents = [{"id": 1, "name": "Dune", "percentDone": 1, "totalSize": 6}]
        self.playing = [{"id": "x", "title": "Dune", "series": None, "season": None, "episode": None, "device": "TV"}]
        self.feed.tick()
        self.house["projectors"][0]["app"] = "Netflix"
        self.feed.tick()
        self.assertEqual(self.kinds(), [("light", "Lamp"), ("cover", "Screen"), ("projector", "Projector"),
                                        ("download", "Dune"), ("play", "Dune"), ("projector", "Projector")])

    def test_imports_scans_and_sessions(self):
        session = {"id": "a", "status": "busy", "name": "errol", "project": None, "room": None, "lead": None}
        self.files["kpiece.json"] = {"latest": {"scan": 1196}}
        with mock.patch.object(self.feed, "cerebro", lambda t: {"sessions": [session]}):
            self.feed.tick()
            self.history = [{"id": "radarr-1", "title": "Dune"}]
            self.files["kpiece.json"] = {"latest": {"scan": 1197, "name": "Elbaf"}}
            session["status"] = "waiting"
            self.feed.slow_at = 0
            self.feed.tick()
        self.assertEqual(self.kinds(), [("import", "Dune"), ("scan", "Elbaf"), ("cerebro", "errol")])

    def test_a_print_starts_and_finishes_once(self):
        self.files["printer.json"] = status(state="levelling")
        self.feed.tick()
        self.files["printer.json"] = status()
        self.feed.tick()
        self.feed.tick()
        self.files["printer.json"] = status(state="done", active=False)
        self.feed.tick()
        self.feed.tick()
        self.assertEqual(self.kinds(), [("print", "started"), ("print", "done")])
        started = self.feed.events[0]
        self.assertEqual((started["file"], started["layers"], started["remaining"], started["image"]),
                         ("01_Cafetière", 2978, 312 * 60, S3))

    def test_a_printer_off_for_a_while_is_no_news(self):
        self.files["printer.json"] = status()
        self.feed.tick()
        self.files["printer.json"] = {**status(), "online": False}
        self.feed.tick()
        self.files["printer.json"] = status()
        self.feed.tick()
        self.assertEqual(self.feed.events, [])

    def test_dead_sources_keep_their_last_word(self):
        self.torrents = [{"id": 1, "name": "Dune", "percentDone": 1}]
        self.feed.tick()
        self.house, self.torrents = None, None
        with mock.patch.object(feed, "get", side_effect=OSError("down")), \
                mock.patch.object(feed, "transmission", side_effect=OSError("down")):
            doc = self.feed.tick()
        self.assertEqual(set(doc["errors"]), {"bifrost", "transmission"})
        self.assertIn(1, self.feed.seen["done"])
        self.assertIn("lamp", self.feed.seen["outlets"])

    def test_the_preview_link_stays_for_one_print(self):
        self.files["printer.json"] = status()
        first = self.feed.tick()["printer"]["image"]
        self.files["printer.json"] = status(image=S3.replace("174041", "174205"))
        self.assertEqual(self.feed.tick()["printer"]["image"], first)
        # a print later, or once the link is too old, the new one
        self.feed.preview = (self.feed.preview[0], first, -feed.PREVIEW_KEEP)
        self.assertNotEqual(self.feed.tick()["printer"]["image"], first)


if __name__ == "__main__":
    unittest.main()
