"""Tests of fakes/fakes.py, with every API call and file mocked:
python3 -m unittest fakes/test_fakes.py"""

import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

_spec = importlib.util.spec_from_file_location(
    "fakes_script", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fakes.py"))
fakes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fakes)

EXE = {"id": 7, "title": "Show S03E05 1080p WEB H264-CAKES.exe", "statusMessages": []}
FOUND = {"id": 8, "title": "Show S03E02 1080p WEB H264-FLUX",
         "statusMessages": [{"messages": ["Caution: Found executable file with extension: '.exe'"]}]}
FINE = {"id": 9, "title": "Show S03E04 MULTi 1080p WEB H265-GL0P.mkv",
        "statusMessages": [{"messages": ["No files found are eligible for import"]}]}


class Api:
    """A fake Sonarr or Radarr: answers from a dict, records every call."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def __call__(self, app, key, method, path, body=None):
        self.calls.append((method, path.split("?")[0], body))
        return self.answers.get((method, path.split("?")[0]))


class Fakes(unittest.TestCase):
    def test_a_program_by_title_or_by_content(self):
        self.assertTrue(fakes.is_fake(EXE))
        self.assertTrue(fakes.is_fake({"title": "x.LNK"}))
        self.assertTrue(fakes.is_fake(FOUND))
        self.assertTrue(fakes.is_fake({"title": "x", "statusMessages": [
            {"messages": ["Caution: Found potentially dangerous file with extension: '.scr'"]}]}))
        self.assertFalse(fakes.is_fake(FINE))
        self.assertFalse(fakes.is_fake({"title": None, "statusMessages": None}))
        self.assertFalse(fakes.is_fake({"title": "Show.exe.Files.S01E01.mkv"}))

    def test_the_term_matches_as_the_python_pattern(self):
        self.assertEqual(fakes.TERM, "/" + fakes.PROGRAM.pattern + "/i")

    def test_sweep_removes_blocklists_and_searches_again_only_the_fakes(self):
        api = Api({("GET", "queue"): {"records": [EXE, FOUND, FINE]}})
        with mock.patch.object(fakes, "call", api):
            removed = fakes.sweep("sonarr", "k")
        self.assertEqual(removed, [EXE["title"], FOUND["title"]])
        deletes = [c for c in api.calls if c[0] == "DELETE"]
        self.assertEqual([c[1] for c in deletes], ["queue/7", "queue/8"])

    def test_sweep_query_asks_for_removal_blocklist_and_a_new_search(self):
        paths = []
        with mock.patch.object(fakes, "call", lambda a, k, m, p, b=None: paths.append(p) or {"records": [EXE]}):
            fakes.sweep("radarr", "k")
        self.assertIn("removeFromClient=true&blocklist=true&skipRedownload=false", paths[1])

    def test_sonarr_profile_made_once(self):
        api = Api({("GET", "releaseprofile"): []})
        with mock.patch.object(fakes, "call", api):
            self.assertTrue(fakes.guard_sonarr("k"))
        self.assertEqual(api.calls[1][2]["ignored"], [fakes.TERM])
        api = Api({("GET", "releaseprofile"): [{"ignored": ["other", fakes.TERM]}]})
        with mock.patch.object(fakes, "call", api):
            self.assertFalse(fakes.guard_sonarr("k"))
        self.assertEqual(len(api.calls), 1)

    def test_radarr_format_made_and_scored_in_every_profile(self):
        api = Api({("GET", "customformat"): [{"id": 1, "name": "x265"}],
                   ("POST", "customformat"): {"id": 4},
                   ("GET", "qualityprofile"): [
                       {"id": 1, "formatItems": [{"format": 1, "score": 0}]},
                       {"id": 2, "formatItems": [{"format": 4, "score": 0}]},
                       {"id": 3}]})
        with mock.patch.object(fakes, "call", api):
            self.assertTrue(fakes.guard_radarr("k"))
        puts = {c[1]: c[2] for c in api.calls if c[0] == "PUT"}
        self.assertEqual(sorted(puts), ["qualityprofile/1", "qualityprofile/2", "qualityprofile/3"])
        for profile in puts.values():
            self.assertIn(fakes.SCORE, [i["score"] for i in profile["formatItems"] if i["format"] == 4])
        self.assertEqual(puts["qualityprofile/1"]["formatItems"][0], {"format": 1, "score": 0})

    def test_radarr_left_alone_when_already_guarded(self):
        right = [{"fields": [{"name": "value", "value": fakes.PROGRAM.pattern}]}]
        api = Api({("GET", "customformat"): [{"id": 4, "name": fakes.NAME, "specifications": right}],
                   ("GET", "qualityprofile"): [{"id": 1, "formatItems": [{"format": 4, "score": fakes.SCORE}]}]})
        with mock.patch.object(fakes, "call", api):
            self.assertFalse(fakes.guard_radarr("k"))
        self.assertEqual([c[0] for c in api.calls], ["GET", "GET"])

    def test_radarr_format_mended_when_its_pattern_is_not_bare(self):
        wrong = [{"fields": [{"name": "value", "value": fakes.TERM}]}]
        api = Api({("GET", "customformat"): [{"id": 4, "name": fakes.NAME, "specifications": wrong}]})
        with mock.patch.object(fakes, "call", api):
            self.assertEqual(fakes.radarr_format("k"), (4, True))
        method, path, body = api.calls[1]
        self.assertEqual((method, path, body["id"]), ("PUT", "customformat/4", 4))
        self.assertEqual(body["specifications"][0]["fields"][0]["value"], fakes.PROGRAM.pattern)

    def test_run_app_reports_each_fake(self):
        with mock.patch.dict(fakes.GUARDS, {"sonarr": lambda k: True}), \
                mock.patch.object(fakes, "sweep", return_value=["a.exe"]), mock.patch("builtins.print"):
            self.assertEqual(fakes.run_app("sonarr", "k"),
                             ["sonarr: removed and blocklisted the fake « a.exe », searching again"])


class Plumbing(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        root = Path(self.dir.name)
        (root / "config" / "sonarr").mkdir(parents=True)
        (root / "config" / "sonarr" / "config.xml").write_text("<Config><ApiKey>abc123</ApiKey></Config>")
        (root / "config" / "radarr").mkdir(parents=True)
        (root / "config" / "radarr" / "config.xml").write_text("<Config></Config>")
        (root / ".env").write_text("# c\nWATCHDOG_WEBHOOK_URL='https://hook'\n\nX=1\n")
        patcher = mock.patch.object(fakes, "PROJECT", root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_env_and_keys(self):
        self.assertEqual(fakes.read_env(), {"WATCHDOG_WEBHOOK_URL": "https://hook", "X": "1"})
        self.assertEqual(fakes.api_key("sonarr"), "abc123")
        self.assertIsNone(fakes.api_key("radarr"))
        self.assertIsNone(fakes.api_key("lidarr"))

    def test_env_missing(self):
        (fakes.PROJECT / ".env").unlink()
        self.assertEqual(fakes.read_env(), {})

    def test_call_sends_key_and_json(self):
        answer = mock.MagicMock()
        answer.__enter__.return_value.read.return_value = b'{"a": 1}'
        with mock.patch.object(urllib.request, "urlopen", return_value=answer) as urlopen:
            self.assertEqual(fakes.call("radarr", "k", "PUT", "x/1", {"b": 2}), {"a": 1})
        req = urlopen.call_args[0][0]
        self.assertEqual(req.full_url, "http://localhost:7878/api/v3/x/1")
        self.assertEqual((req.get_method(), req.get_header("X-api-key"), json.loads(req.data)), ("PUT", "k", {"b": 2}))
        answer.__enter__.return_value.read.return_value = b""
        with mock.patch.object(urllib.request, "urlopen", return_value=answer):
            self.assertIsNone(fakes.call("sonarr", "k", "DELETE", "queue/1"))

    def test_post_native_and_slack(self):
        with mock.patch.object(urllib.request, "urlopen") as urlopen:
            fakes.post("https://hook", "hi")
            fakes.post("https://hook/slack", "hi")
        bodies = [json.loads(c[0][0].data) for c in urlopen.call_args_list]
        self.assertEqual([b.get("content") or b.get("text") for b in bodies], ["hi", "hi"])
        self.assertIn("text", bodies[1])

    def test_main_posts_what_was_removed_and_skips_missing_apps(self):
        with mock.patch.object(fakes, "run_app", return_value=["removed x"]) as run_app, \
                mock.patch.object(fakes, "post") as post, mock.patch("sys.stdout", io.StringIO()):
            self.assertEqual(fakes.main(), 0)
        run_app.assert_called_once_with("sonarr", "abc123")
        post.assert_called_once_with("https://hook", "removed x")

    def test_main_survives_an_app_down_and_a_dead_webhook(self):
        with mock.patch.object(fakes, "run_app", side_effect=OSError("refused")), \
                mock.patch("sys.stdout", io.StringIO()) as out:
            self.assertEqual(fakes.main(), 1)
        self.assertIn("sonarr: refused", out.getvalue())
        with mock.patch.object(fakes, "run_app", return_value=["x"]), \
                mock.patch.object(fakes, "post", side_effect=OSError("gone")), \
                mock.patch("sys.stdout", io.StringIO()) as out:
            self.assertEqual(fakes.main(), 0)
        self.assertIn("Discord post failed: gone", out.getvalue())

    def test_main_quiet_without_webhook(self):
        (fakes.PROJECT / ".env").write_text("")
        with mock.patch.object(fakes, "run_app", return_value=["x"]), \
                mock.patch.object(fakes, "post") as post, mock.patch("sys.stdout", io.StringIO()):
            fakes.main()
        post.assert_not_called()


if __name__ == "__main__":
    unittest.main()
