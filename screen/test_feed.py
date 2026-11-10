"""Tests of screen/feed.py, without network: python3 -m unittest screen/test_feed.py"""

import json
import os
import sys
import tempfile
import time
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
            self.feed.slow_reads.result()   # read behind the pass: its news comes with the next
            self.feed.tick()
        self.assertEqual(self.kinds(), [("scan", "Elbaf"), ("cerebro", "errol"), ("import", "Dune")])

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

    def test_a_switch_the_hub_could_not_read_is_no_news(self):
        self.house["projectors"][0]["on"] = None     # unknown from the start
        self.feed.tick()
        self.house["projectors"][0]["on"] = False
        self.feed.tick()
        for on in (None, False, None, None, False):  # adb unanswered now and then, asleep
            self.house["projectors"][0]["on"] = on
            self.house["outlets"][0]["on"] = None if on is None else False
            doc = self.feed.tick()
        self.assertEqual(self.feed.events, [])
        self.house["projectors"][0]["on"] = True
        self.feed.tick()
        self.house["projectors"][0]["on"] = None
        doc = self.feed.tick()
        self.assertEqual(self.kinds(), [("projector", "Projector")])
        self.assertTrue(doc["house"]["projectors"][0]["on"])   # still on, as last known

    def test_the_projector_idling_is_no_news(self):
        self.house["projectors"][0].update(on=True, app="org.jellyfin.androidtv")
        self.feed.tick()
        for app in ("screensaver", "home", None, "home"):
            self.house["projectors"][0]["app"] = app
            self.feed.tick()
        self.house["projectors"][0]["app"] = "com.netflix.ninja"
        self.feed.tick()
        self.assertEqual([e["app"] for e in self.feed.events], ["com.netflix.ninja"])

    def test_a_download_is_news_once_whatever_its_number(self):
        self.feed.tick()
        recent = time.time() - 60
        self.torrents = [{"id": 1, "hashString": "h", "name": "Dune", "percentDone": 1, "doneDate": recent},
                         {"id": 2, "hashString": "old", "name": "Alien", "percentDone": 1, "doneDate": 1}]
        self.feed.tick()
        self.torrents = [{**t, "id": t["id"] + 10} for t in self.torrents]   # Transmission restarted
        self.feed.tick()
        self.assertEqual(self.kinds(), [("download", "Dune")])

    def test_a_session_asking_again_and_again_is_news_once_in_a_while(self):
        session = {"id": "a", "status": "busy", "name": "errol", "project": None, "room": None, "lead": None}
        with mock.patch.object(self.feed, "cerebro", lambda t: {"sessions": [session]}):
            self.feed.tick()
            for status in ("waiting", "busy", "waiting", "busy", "waiting"):
                session["status"] = status
                self.feed.tick()
        self.assertEqual(self.kinds(), [("cerebro", "errol")])

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

    def test_a_source_first_heard_late_is_no_news(self):
        self.torrents, self.house, self.files["printer.json"] = None, None, None
        with mock.patch.object(feed, "imports", side_effect=OSError("down")), \
                mock.patch.object(feed, "transmission", side_effect=OSError("down")), \
                mock.patch.object(feed, "get", side_effect=OSError("down")):
            self.feed.tick()
        self.house = {"outlets": [{"id": "lamp", "name": "Lamp", "on": True}], "covers": [], "projectors": []}
        self.torrents = [{"id": 1, "name": "Dune", "percentDone": 1, "doneDate": time.time() - 60}]
        self.history = [{"id": "radarr-1", "title": "Dune"}, {"id": "sonarr-1", "title": "Arcane"}]
        self.files["printer.json"] = status()
        self.feed.slow_at = 0
        self.feed.tick()
        self.feed.slow_reads.result()
        self.feed.tick()
        self.assertEqual(self.feed.events, [])
        self.assertTrue({"house", "transmission", "printer", "radarr", "sonarr"} <= self.feed.heard)
        # heard once, what follows is news again
        self.house["outlets"][0]["on"] = False
        self.history.append({"id": "radarr-2", "title": "Alien"})
        self.feed.slow_at = 0
        self.feed.tick()
        self.feed.slow_reads.result()
        self.feed.tick()
        self.assertEqual(self.kinds(), [("light", "Lamp"), ("import", "Alien")])

    def test_a_cerebro_or_a_scan_first_heard_late_is_no_news(self):
        session = {"id": "a", "status": "waiting", "name": "errol", "project": None, "room": None, "lead": None}
        sessions = None
        with mock.patch.object(self.feed, "cerebro", lambda t: sessions):
            self.feed.tick()
            sessions = {"sessions": [session]}
            self.files["kpiece.json"] = {"latest": {"scan": 1197}}
            self.feed.tick()
        self.assertEqual(self.feed.events, [])

    def test_the_projector_app_under_its_name(self):
        pj = self.house["projectors"][0]
        pj["apps"] = [{"name": "Accueil", "package": "home"}, {"name": "Netflix", "package": "com.netflix.ninja"}]
        self.feed.tick()
        pj.update(on=True, app="com.netflix.ninja")
        doc = self.feed.tick()
        pj["app"] = "org.jellyfin.androidtv"
        self.feed.tick()
        self.assertEqual([e["app"] for e in self.feed.events], ["Netflix", "org.jellyfin.androidtv"])
        self.assertEqual(doc["house"]["projectors"][0]["app"], "Netflix")

    def test_the_screen_going_up_on_its_own_is_no_news(self):
        pj, cover = self.house["projectors"][0], self.house["covers"][0]
        pj.update(on=True, cover="screen")
        self.feed.tick()
        pj.update(on=False, closes_at=(CHECKED + timedelta(seconds=30)).isoformat())
        self.feed.tick()
        pj["closes_at"] = None              # the hub forgets it as it raises the screen
        cover.update(moving="up", target=0)
        self.feed.tick()
        cover["moving"] = None
        self.feed.tick()
        self.assertEqual(self.kinds(), [("projector", "Projector")])
        # raised by hand, long after: news
        self.feed.closes["pj"] = CHECKED - timedelta(minutes=10)
        cover["moving"] = "up"
        self.feed.tick()
        # coming down as the projector turns on: news, and the close is forgotten
        cover["moving"] = None
        self.feed.tick()
        pj["on"], cover["moving"] = True, "down"
        self.feed.tick()
        self.assertEqual(self.kinds()[1:], [("cover", "Screen"), ("cover", "Screen"), ("projector", "Projector")])
        self.assertEqual(self.feed.closes, {})

    def test_a_download_of_radarr_or_sonarr_is_only_counted(self):
        self.feed.tick()
        recent = time.time() - 60
        self.torrents = [{"id": 1, "hashString": "a", "name": "Dune.2021", "percentDone": 1, "doneDate": recent,
                          "downloadDir": "/downloads/complete/radarr/"},
                         {"id": 2, "hashString": "b", "name": "Arcane.S02", "percentDone": 1, "doneDate": recent,
                          "downloadDir": "/downloads/complete", "labels": ["tv-sonarr"]},
                         {"id": 3, "hashString": "c", "name": "Linux.iso", "percentDone": 1, "doneDate": recent,
                          "downloadDir": "/downloads/complete"}]
        doc = self.feed.tick()
        self.assertEqual(self.kinds(), [("download", "Linux.iso")])
        self.assertEqual(doc["today"]["downloads"], 3)

    def test_the_day_counts(self):
        session = {"id": "a", "status": "busy", "name": "errol", "project": None, "room": None, "lead": None}
        with mock.patch.object(self.feed, "cerebro", lambda t: {"sessions": [session]}):
            self.files["printer.json"] = status()
            self.feed.tick()
            self.house["outlets"][0]["on"] = True
            self.playing = [{"id": "x", "title": "Dune", "series": None, "season": None, "episode": None, "device": "TV"}]
            session["status"] = "waiting"
            self.files["printer.json"] = status(state="done", active=False)
            self.feed.tick()
            self.house["outlets"][0]["on"] = False         # switched off: not counted
            self.files["printer.json"] = status(started_at="later")   # started: not counted
            self.history = [{"id": "radarr-1", "title": "Dune"}]
            self.feed.slow_at = 0
            self.feed.tick()
            self.feed.slow_reads.result()
            doc = self.feed.tick()
        self.assertEqual(doc["today"], {"imports": 1, "downloads": 0, "plays": 1, "lights": 1, "prints": 1, "questions": 1})
        with open(os.path.join(self.tmp.name, feed.TODAY)) as f:
            saved = json.load(f)
        self.assertEqual((saved["date"], saved["lights"]), (CHECKED.astimezone().date().isoformat(), 1))
        # a restart the same day keeps them; the next day starts again from zero
        self.files[feed.TODAY] = saved
        self.assertEqual(feed.Feed().tick()["today"]["plays"], 1)
        with mock.patch.object(feed, "now", lambda: (CHECKED + timedelta(days=1)).astimezone()):
            self.assertEqual(self.feed.tick()["today"], dict.fromkeys(feed.COUNTED.values(), 0))

    def test_services_down_by_name(self):
        self.files["services.json"] = [{"name": "jellyfin", "state": "running"}, {"name": "prowlarr", "state": "exited"},
                                       {"name": "radarr", "state": "running"}]
        self.assertEqual(self.feed.tick()["services"], {"up": 2, "total": 3, "down": ["prowlarr"]})

    def test_the_new_parts_of_the_document(self):
        with mock.patch.object(feed, "weather", lambda: {"temperature": 9.4}), \
                mock.patch.object(feed, "jellyfin_next_up", lambda: [{"series": "Arcane"}]), \
                mock.patch.object(feed, "airing", lambda key, url, at: [{"series": "Arcane", "episode": 6}]):
            doc = self.feed.tick()
        self.assertEqual((doc["weather"], doc["next_up"], doc["airing"]),
                         ({"temperature": 9.4}, [{"series": "Arcane"}], [{"series": "Arcane", "episode": 6}]))
        self.assertEqual(doc["today"], dict.fromkeys(feed.COUNTED.values(), 0))

    def test_the_weather_every_quarter_of_an_hour_and_its_last_word(self):
        answers = [{"temperature": 9.4}, None, {"temperature": 11.0}]
        with mock.patch.object(feed, "weather", lambda: answers.pop(0)):
            self.assertEqual(self.feed.weather(None), {"temperature": 9.4})
            self.assertEqual(self.feed.weather({"temperature": 9.4}), {"temperature": 9.4})   # too soon: not asked
            self.feed.weather_at -= feed.WEATHER_EVERY
            self.assertEqual(self.feed.weather({"temperature": 9.4}), {"temperature": 9.4})   # failed: the last
            self.assertEqual(self.feed.weather({"temperature": 9.4}), {"temperature": 11.0})  # asked again at once
        self.assertEqual(answers, [])


class Jellyfin(unittest.TestCase):
    EPISODE = {"Id": "e1", "Type": "Episode", "Name": "Romance Dawn", "SeriesName": "One Piece", "SeriesId": "s1",
               "ParentIndexNumber": 1, "IndexNumber": 1, "ProductionYear": 1999, "Overview": "x" * 500,
               "Genres": ["Anime", "Action", "Adventure", "Comedy"], "RunTimeTicks": 14_400_000_000,
               "ParentBackdropItemId": "s1", "MediaType": "Video"}
    MOVIE = {"Id": "m1", "Type": "Movie", "Name": "Dune", "BackdropImageTags": ["t"], "MediaType": "Video"}

    def test_an_episode(self):
        v = feed.video(self.EPISODE, 6_000_000_000)
        self.assertEqual((v["type"], v["series"], v["season"], v["episode"]), ("episode", "One Piece", 1, 1))
        self.assertEqual((v["runtime"], v["position"], len(v["overview"])), (1440, 600, 400))
        self.assertEqual(v["genres"], ["Anime", "Action", "Adventure"])
        self.assertEqual((v["poster"], v["backdrop"]), ("/Items/s1/Images/Primary", "/Items/s1/Images/Backdrop"))

    def test_a_movie(self):
        v = feed.video(self.MOVIE, None)
        self.assertEqual((v["type"], v["series"], v["season"], v["episode"]), ("movie", None, None, None))
        self.assertEqual((v["runtime"], v["position"], v["overview"], v["genres"]), (0, 0, "", []))
        self.assertEqual((v["poster"], v["backdrop"]), ("/Items/m1/Images/Primary", "/Items/m1/Images/Backdrop"))

    def test_an_episode_without_series_or_backdrop(self):
        v = feed.video({"Id": "e2", "Type": "Episode"}, 0)
        self.assertEqual((v["poster"], v["backdrop"]), ("/Items/e2/Images/Primary", None))
        self.assertEqual(feed.video({"Id": "e3", "Type": "Episode", "SeriesId": "s3"}, 0)["backdrop"],
                         "/Items/s3/Images/Backdrop")

    def test_without_a_key_nothing_is_asked(self):
        with mock.patch.object(feed, "JELLYFIN_KEY", ""), mock.patch.object(feed, "get") as get:
            self.assertEqual(feed.jellyfin(), [])
            self.assertEqual(feed.jellyfin_resume(), [])
        get.assert_not_called()

    def test_videos_playing(self):
        sessions = [
            {"NowPlayingItem": self.MOVIE, "PlayState": {"PositionTicks": 10_000_000, "IsPaused": True},
             "DeviceName": "TV", "Client": "Android TV", "UserName": "d"},
            {"NowPlayingItem": {**self.MOVIE, "MediaType": "Audio"}},
            {"PlayState": {}},
            {"NowPlayingItem": self.EPISODE},
        ]
        with mock.patch.object(feed, "JELLYFIN_KEY", "k"), mock.patch.object(feed, "get", return_value=sessions) as get:
            out = feed.jellyfin()
        self.assertEqual(get.call_args.args[1], {"X-Emby-Token": "k"})
        self.assertEqual([(x["id"], x["paused"], x["position"], x["device"]) for x in out],
                         [("m1", True, 1, "TV"), ("e1", False, 0, None)])

    def resume(self, users, name=""):
        items = {"Items": [{**self.MOVIE, "UserData": {"PlaybackPositionTicks": 20_000_000}}, self.EPISODE]}
        urls = []

        def get(url, headers):
            urls.append(url)
            return users if url.endswith("/Users") else items
        with mock.patch.object(feed, "JELLYFIN_KEY", "k"), mock.patch.object(feed, "JELLYFIN_USER", name), \
                mock.patch.object(feed, "get", get):
            return feed.jellyfin_resume(), urls

    def test_resume_for_the_named_user(self):
        out, urls = self.resume([{"Id": "u1", "Name": "a"}, {"Id": "u2", "Name": "d"}], "d")
        self.assertIn("/Users/u2/Items/Resume", urls[1])
        self.assertEqual([(x["id"], x["position"]) for x in out], [("m1", 2), ("e1", 0)])

    def test_resume_for_the_first_user_else_nobody(self):
        self.assertIn("/Users/u1/", self.resume([{"Id": "u1", "Name": "a"}], "d")[1][1])
        self.assertEqual(self.resume([]), ([], [f"{feed.JELLYFIN}/Users"]))

    def test_next_up(self):
        items = {"Items": [{"Id": "e5", "SeriesId": "s1", "SeriesName": "Arcane", "ParentIndexNumber": 2,
                            "IndexNumber": 5, "Name": "Blisters"}, {"Id": "e9", "Name": "Pilot"}] * 2}
        urls = []

        def get(url, headers):
            urls.append(url)
            return [{"Id": "u1", "Name": "d"}] if url.endswith("/Users") else items
        with mock.patch.object(feed, "JELLYFIN_KEY", "k"), mock.patch.object(feed, "get", get):
            out = feed.jellyfin_next_up()
        self.assertIn("/Shows/NextUp?UserId=u1&Limit=3", urls[1])
        self.assertEqual(out[0], {"series": "Arcane", "season": 2, "episode": 5, "title": "Blisters",
                                  "poster": "/Items/s1/Images/Primary"})
        self.assertEqual((len(out), out[1]["series"], out[1]["poster"]), (3, "Pilot", "/Items/e9/Images/Primary"))

    def test_next_up_without_a_key_or_a_user(self):
        with mock.patch.object(feed, "JELLYFIN_KEY", ""):
            self.assertEqual(feed.jellyfin_next_up(), [])
        with mock.patch.object(feed, "JELLYFIN_KEY", "k"), mock.patch.object(feed, "get", return_value=[]):
            self.assertEqual(feed.jellyfin_next_up(), [])


class Imports(unittest.TestCase):
    FILM = {"id": 7, "date": "2026-11-04T10:00:00Z", "quality": {"quality": {"name": "Bluray-1080p"}},
            "movie": {"title": "Dune", "year": 2021, "images": [
                {"coverType": "fanart", "remoteUrl": "https://t/original/f.jpg"},
                {"coverType": "poster", "remoteUrl": "https://t/original/p.jpg"}]}}
    EPISODE = {"id": 8, "series": {"title": "One Piece", "images": [{"coverType": "poster", "remoteUrl": ""}]},
               "episode": {"seasonNumber": 2, "episodeNumber": 5, "title": "Elbaf"}}

    def test_without_a_key_nothing_is_asked(self):
        with mock.patch.object(feed, "get") as get:
            self.assertEqual(feed.imports("radarr", "", "http://radarr"), [])
        get.assert_not_called()

    def test_films(self):
        with mock.patch.object(feed, "get", return_value={"records": [self.FILM]}) as get:
            out = feed.imports("radarr", "k", "http://radarr")
        self.assertIn("includeMovie=true", get.call_args.args[0])
        self.assertEqual(get.call_args.args[1], {"X-Api-Key": "k"})
        self.assertEqual(out, [{"id": "radarr-7", "media": "movie", "title": "Dune", "year": 2021,
                                "season": None, "episode": None, "episode_title": None, "quality": "Bluray-1080p",
                                "poster": "https://t/w342/p.jpg", "fanart": "https://t/w780/f.jpg",
                                "at": "2026-11-04T10:00:00Z"}])

    def test_episodes(self):
        with mock.patch.object(feed, "get", return_value={"records": [self.EPISODE, {"id": 9}]}) as get:
            out = feed.imports("sonarr", "k", "http://sonarr")
        self.assertIn("includeSeries=true&includeEpisode=true", get.call_args.args[0])
        e = out[0]
        self.assertEqual((e["id"], e["media"], e["title"], e["season"], e["episode"], e["episode_title"]),
                         ("sonarr-8", "episode", "One Piece", 2, 5, "Elbaf"))
        self.assertEqual((e["quality"], e["poster"], e["fanart"]), (None, None, None))
        self.assertEqual((out[1]["id"], out[1]["title"]), ("sonarr-9", None))

    def test_airing_today_and_tomorrow(self):
        def episode(n, at):
            return {"seasonNumber": 2, "episodeNumber": n, "title": f"E{n}", "airDateUtc": at,
                    "series": {"title": "Arcane", "images": [{"coverType": "poster", "remoteUrl": "https://t/original/a.jpg"}]}}
        eps = [episode(6, "2026-11-09T20:00:00Z"), episode(5, "2026-11-08T20:00:00Z"), episode(7, None),
               episode(8, "2026-11-09T21:00:00Z"), episode(9, "2026-11-09T22:00:00Z")]
        at = datetime(2026, 11, 8, 15, 0, tzinfo=timezone(timedelta(hours=1)))
        with mock.patch.object(feed, "get", return_value=eps) as get:
            out = feed.airing("k", "http://sonarr", at)
        self.assertIn("/api/v3/calendar?start=2026-11-07T23:00:00Z&end=2026-11-09T23:00:00Z&includeSeries=true",
                      get.call_args.args[0])
        self.assertEqual(get.call_args.args[1], {"X-Api-Key": "k"})
        self.assertEqual([e["episode"] for e in out], [7, 5, 6, 8])
        self.assertEqual((out[1]["series"], out[1]["season"], out[1]["title"], out[1]["poster"]),
                         ("Arcane", 2, "E5", "https://t/w342/a.jpg"))
        self.assertEqual(datetime.fromisoformat(out[1]["at"]), datetime(2026, 11, 8, 20, tzinfo=timezone.utc))
        self.assertIsNone(out[0]["at"])

    def test_airing_without_a_key(self):
        with mock.patch.object(feed, "get") as get:
            self.assertEqual(feed.airing("", "http://sonarr", CHECKED), [])
        get.assert_not_called()
        self.assertEqual(feed.airing_episode({})["series"], None)

    def test_torrents_of_radarr_and_sonarr(self):
        self.assertTrue(feed.for_arr({"downloadDir": "/downloads/complete/radarr"}))
        self.assertTrue(feed.for_arr({"downloadDir": "/downloads/complete/tv-sonarr/"}))
        self.assertTrue(feed.for_arr({"downloadDir": "/downloads/complete", "labels": ["sonarr"]}))
        self.assertFalse(feed.for_arr({"downloadDir": "/downloads/complete", "labels": []}))
        self.assertFalse(feed.for_arr({}))


class Weather(unittest.TestCase):
    ANSWER = {
        "utc_offset_seconds": 3600,
        "current": {"time": "2026-11-08T14:15", "temperature_2m": 9.4, "weather_code": 61, "wind_speed_10m": 18.0},
        "daily": {"temperature_2m_max": [12.0, 13.0], "temperature_2m_min": [6.0, 5.0],
                  "sunrise": ["2026-11-08T07:58", "x"], "sunset": ["2026-11-08T17:21", "x"]},
        "hourly": {"time": ["2026-11-08T13:00", "2026-11-08T14:00", "2026-11-08T15:00", "2026-11-08T16:00",
                            "2026-11-08T17:00"],
                   "precipitation_probability": [90, 40, None, 70, 100]},
    }

    def test_the_weather_as_the_screens_show_it(self):
        self.assertEqual(feed.weather_of(self.ANSWER), {
            "temperature": 9.4, "code": 61, "wind": 18.0, "high": 12.0, "low": 6.0, "rain": 70,
            "sunrise": "2026-11-08T07:58:00+01:00", "sunset": "2026-11-08T17:21:00+01:00"})

    def test_what_open_meteo_does_not_say(self):
        self.assertIsNone(feed.weather_of({}))
        self.assertIsNone(feed.weather_of({"current": {"temperature_2m": 9.4}}))
        w = feed.weather_of({"current": {"temperature_2m": 0, "weather_code": 0}, "daily": {"sunrise": ["never"]}})
        self.assertEqual((w["temperature"], w["wind"], w["high"], w["rain"], w["sunrise"], w["sunset"]),
                         (0, None, None, None, None, None))

    def test_without_a_place_nothing_is_asked(self):
        with mock.patch.object(feed, "WEATHER_LAT", ""), mock.patch.object(feed, "get") as get:
            self.assertIsNone(feed.weather())
        get.assert_not_called()

    def test_asked_of_open_meteo(self):
        with mock.patch.object(feed, "WEATHER_LAT", "48.85"), mock.patch.object(feed, "WEATHER_LON", "2.35"), \
                mock.patch.object(feed, "get", return_value=self.ANSWER) as get:
            self.assertEqual(feed.weather()["code"], 61)
        url = get.call_args.args[0]
        for part in ("latitude=48.85", "longitude=2.35", "timezone=auto", "precipitation_probability",
                     "current=temperature_2m%2Cweather_code%2Cwind_speed_10m", "sunrise"):
            self.assertIn(part, url)


class Today(unittest.TestCase):
    def test_what_counts(self):
        self.assertEqual(feed.counter("light", {"on": True}), "lights")
        self.assertIsNone(feed.counter("light", {"on": False}))
        self.assertEqual(feed.counter("print", {"phase": "done"}), "prints")
        self.assertIsNone(feed.counter("print", {"phase": "started"}))
        self.assertEqual(feed.counter("cerebro", {}), "questions")
        self.assertIsNone(feed.counter("cover", {}))

    def test_the_day(self):
        at = CHECKED.astimezone()
        today = feed.day_of({"date": at.date().isoformat(), "plays": 2, "lights": "x"}, at)
        self.assertEqual((today["plays"], today["lights"], today["imports"]), (2, 0, 0))
        self.assertEqual(feed.day_of(today, at + timedelta(days=1))["plays"], 0)
        self.assertEqual(feed.day_of(None, at)["date"], at.date().isoformat())

    def test_kept_when_it_can_be(self):
        with mock.patch.object(feed, "STATUS", "/nowhere/at/all"):
            feed.save_today({"date": "d"})       # no folder: counted all the same


class House(unittest.TestCase):
    APPS = {"apps": [{"name": "Accueil", "package": "home"}, {"package": "x"}, {"name": "Netflix", "package": "n"}]}

    def test_app_names(self):
        self.assertEqual(feed.app_name(self.APPS, "n"), "Netflix")
        self.assertEqual(feed.app_name(self.APPS, "x"), "x")
        self.assertEqual(feed.app_name({}, "n"), "n")
        self.assertIsNone(feed.app_name(self.APPS, None))
        house = feed.tidy_house({"projectors": [{"id": "pj", "on": True, "app": "home", **self.APPS}]})
        self.assertEqual(house["projectors"][0]["app"], "Accueil")

    def test_the_hub_closing_the_screen(self):
        due = CHECKED + timedelta(seconds=40)
        projectors = {"pj": {"cover": "screen"}, "other": {"cover": "blind"}}
        self.assertTrue(feed.closing(projectors, "screen", {"pj": due}, CHECKED))
        self.assertFalse(feed.closing(projectors, "screen", {"pj": due}, CHECKED - timedelta(seconds=30)))
        self.assertFalse(feed.closing(projectors, "blind", {"pj": due}, CHECKED))
        self.assertFalse(feed.closing(projectors, "screen", {}, CHECKED))
        self.assertEqual(feed.due_at(due.isoformat()), due)
        self.assertIsNone(feed.due_at(None))
        self.assertIsNone(feed.due_at("soon"))


class Cerebro(unittest.TestCase):
    CATALOG = {
        "room_size": [200, 100], "character_size": [32, 32],
        "rooms": {"lab": {"id": "lab", "name": "Lab", "sprite": "rooms/lab.png", "frames": 4, "walkArea": [1, 2]},
                  "den": {"id": "den", "name": "Den", "sprite": "rooms/den.png"}},
        "characters": {"xav": {"name": "Xavier", "sprite": "c/xav.png", "move": "float", "power": "beam",
                               "powerColor": "#00F", "aura": "#0F0"},
                       "jean": {"name": "Jean", "sprite": "c/jean.png", "aura": "#F00"},
                       "kurt": {"name": "Kurt", "sprite": "c/kurt.png"}},
    }

    def sessions(self, *scenes, catalog=None):
        with mock.patch.object(feed, "CEREBRO", "http://mac:4243"), mock.patch.object(feed, "CEREBRO_KEY", "a b"):
            return feed.cerebro({"scenes": list(scenes)}, self.CATALOG if catalog is None else catalog)

    def test_a_session_and_its_scene(self):
        out = self.sessions({"id": "1", "name": "errol", "cwd": "/Users/d/personal/errol", "status": "busy",
                             "statusSince": CHECKED.timestamp() * 1000, "room": "lab",
                             "actors": [{"id": "a", "character": "xav"}, {"id": "b", "character": "nobody"},
                                        {"id": "c", "character": "jean"}, {"id": "d", "character": "kurt"}]})
        s = out["sessions"][0]
        self.assertEqual((s["project"], s["status"], s["room"], s["lead"], s["agents"]),
                         ("~/personal/errol", "busy", "Lab", "Xavier", 3))
        self.assertEqual(datetime.fromisoformat(s["since"]), CHECKED)
        self.assertEqual(s["scene"]["room"], {"sprite": "/cerebro/rooms/lab.png", "frames": 4, "fps": 8, "walk": [1, 2]})
        self.assertEqual([(a["id"], a["move"], a["power"], a["color"], a["state"]) for a in s["scene"]["actors"]],
                         [("a", "float", "beam", "#00F", "walking"), ("c", "walk", "glow", "#F00", "walking"),
                          ("d", "walk", "glow", "#FFFFFF", "walking")])
        self.assertEqual(s["scene"]["actors"][0]["sprite"], "/cerebro/c/xav.png")
        self.assertEqual((out["busy"], out["waiting"], out["room_size"], out["character_size"]), (1, 0, [200, 100], [32, 32]))
        self.assertEqual((out["emotes"], out["link"]), ("/cerebro/ui/emotes.png", "http://mac:4243/?key=a%20b"))

    def test_the_lead_stands_as_its_session(self):
        def lead(status):
            return self.sessions({"status": status, "actors": [{"character": "kurt"}]})["sessions"][0]["scene"]["actors"][0]["state"]
        self.assertEqual([lead("busy"), lead("idle"), lead("waiting")], ["walking", "asleep", "alert"])

    def test_waiting_first_then_working(self):
        out = self.sessions({"name": "b", "status": "idle"}, {"name": "z", "status": "busy"},
                            {"name": "a", "status": "busy"}, {"name": None, "status": "waiting"})
        self.assertEqual([s["name"] for s in out["sessions"]], [None, "a", "z", "b"])
        self.assertEqual((out["busy"], out["waiting"]), (2, 1))

    def test_unknown_room_and_characters(self):
        s = self.sessions({"room": "attic", "actors": [{"character": "ghost"}]})["sessions"][0]
        self.assertEqual((s["room"], s["lead"], s["agents"], s["project"], s["since"]), ("Lab", "ghost", 0, None, None))
        self.assertEqual(s["scene"]["actors"], [])
        bare = self.sessions({"room": "attic"}, catalog={})
        self.assertEqual((bare["sessions"][0]["room"], bare["sessions"][0]["scene"], bare["sessions"][0]["lead"]),
                         ("attic", None, None))
        self.assertEqual((bare["room_size"], bare["character_size"]), ([192, 120], [24, 24]))
        self.assertEqual(self.sessions(catalog={})["sessions"], [])


class Settings(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.settings = os.path.join(self.tmp.name, "screen-settings.json")
        for name, value in {"SETTINGS": self.settings, "OUT": os.path.join(self.tmp.name, "screen.json"),
                            "broadcast": feed.Broadcast()}.items():
            patcher = mock.patch.object(feed, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def saved(self):
        with open(self.settings) as f:
            return json.load(f)

    def test_defaults_without_a_file(self):
        self.assertEqual(feed.load_settings(), {"look": None, "follow_hub": False})

    def test_a_look_then_following_the_hub(self):
        self.assertEqual(feed.save_settings({"look": "cyberpunk"}), {"look": "cyberpunk", "follow_hub": False})
        self.assertEqual(feed.save_settings({"follow_hub": 1}), {"look": "cyberpunk", "follow_hub": True})
        self.assertEqual(feed.save_settings({"look": None}), {"look": None, "follow_hub": True})
        self.assertEqual(self.saved(), {"look": None, "follow_hub": True})
        self.assertFalse(os.path.exists(feed.OUT))      # no document yet: nothing to push

    def test_an_unknown_look_is_refused(self):
        with self.assertRaises(ValueError):
            feed.save_settings({"look": "disco"})
        self.assertFalse(os.path.exists(self.settings))

    def test_the_screens_learn_of_it_at_once(self):
        feed.broadcast.publish({"updated_at": "t", "settings": {}})
        q = feed.broadcast.subscribe()
        feed.save_settings({"look": "hogwarts"})
        q.get_nowait()
        pushed = json.loads(q.get_nowait())
        self.assertEqual(pushed, {"updated_at": "t", "settings": {"look": "hogwarts", "follow_hub": False}})
        with open(feed.OUT) as f:
            self.assertEqual(json.load(f), pushed)

    def post(self, path, body):
        handler = feed.SettingsHandler.__new__(feed.SettingsHandler)
        handler.path = path
        handler.headers = {"Content-Length": str(len(body))} if body else {}
        handler.rfile = mock.Mock(read=lambda n: body[:n])
        handler.reply = mock.Mock()
        handler.do_POST()
        return handler.reply.call_args.args

    def test_post(self):
        self.assertEqual(self.post("/screen/settings/", b'{"look": "friday"}'), (200, {"look": "friday", "follow_hub": False}))
        self.assertEqual(self.post("/screen/settings", b""), (200, {"look": "friday", "follow_hub": False}))
        self.assertEqual(self.post("/elsewhere", b"{}"), (404, {"error": "not found"}))
        self.assertEqual(self.post("/screen/settings", b"[1]"), (400, {"error": "expected an object"}))
        self.assertEqual(self.post("/screen/settings", b'{"look": "disco"}'), (400, {"error": "unknown look 'disco'"}))
        self.assertEqual(self.post("/screen/settings", b"{oops")[0], 400)


if __name__ == "__main__":
    unittest.main()
