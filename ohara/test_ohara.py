"""Tests of ohara/ohara.py, without Prowlarr, Transmission or a socket:
python3 -m unittest ohara/test_ohara.py"""

import base64
import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

_spec = importlib.util.spec_from_file_location("ohara", os.path.join(os.path.dirname(os.path.abspath(__file__)), "ohara.py"))
ohara = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ohara)


def png(color=(200, 30, 30)):
    from PIL import Image
    out = io.BytesIO()
    Image.new("RGB", (40, 60), color).save(out, "PNG")
    return out.getvalue()


def cbz(path, names):
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as z:
        for n in names:
            z.writestr(n, png() if n.endswith(".png") else b"x")
    return path


class Library(unittest.TestCase):
    """A temporary library folder for each test."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        patches = {"MANGA": root, "STATE_DIR": root / ".ohara", "INCOMING": root / ".incoming"}
        for name, value in patches.items():
            p = mock.patch.object(ohara, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.root = root
        ohara.found_releases.clear()
        ohara.pages_cache.clear()

    def tearDown(self):
        self.tmp.cleanup()


class Names(unittest.TestCase):
    def test_series_from_release_titles(self):
        cases = {
            "Naruto - T01 à T72 Intégrale + Gaiden [CBZ]  Fr": "Naruto",
            "Sousou no Frieren - Tomes 01 à 13 [CBZ/FR]": "Sousou no Frieren",
            "Berserk v42 (2025) (Digital) (LuCaZ)": "Berserk",
            "[SoM] Dragon Ball Manga Kanzenban v01-34": "Dragon Ball Manga Kanzenban",
            "One.Piece.Tome.105.FRENCH.CBZ": "One Piece",
            "Boruto - Naruto Next Generations Tomes 1 à 16 [FR] [CBZ]": "Boruto - Naruto Next Generations",
            "[Team]": "[Team]",
        }
        for title, series in cases.items():
            self.assertEqual(ohara.guess_series(title), series, title)

    def test_safe_name(self):
        self.assertEqual(ohara.safe_name('a/b:c*  d. '), "a b c d")
        self.assertEqual(ohara.safe_name(" .. "), "Sans titre")

    def test_volume_label(self):
        self.assertEqual(ohara.volume_label("Naruto T05.cbz"), "Tome 5")
        self.assertEqual(ohara.volume_label("Berserk v042.cbz"), "Tome 42")
        self.assertEqual(ohara.volume_label("Frieren - Tome 12.5.cbz"), "Tome 12.5")
        self.assertEqual(ohara.volume_label("Volume 3.pdf"), "Tome 3")
        self.assertEqual(ohara.volume_label("Artbook.cbz"), "Artbook")

    def test_language(self):
        self.assertEqual(ohara.language("Frieren [CBZ/FR]"), "FR")
        self.assertEqual(ohara.language("Naruto VF cbz"), "FR")
        self.assertEqual(ohara.language("Berserk v42 (Digital)"), "EN")
        self.assertEqual(ohara.language("Dragon Ball [PDF]"), "?")
        self.assertEqual(ohara.language("Naruto en couleurs - T01-72 CBZ"), "?")
        self.assertEqual(ohara.language("Naruto en couleurs - T01-72 CBZ", "YggReborn"), "FR")
        self.assertEqual(ohara.language("One Piece 1198 [JP]"), "JP")
        self.assertEqual(ohara.language("ONE PIECE カラー版 第001-106巻"), "JP")
        self.assertEqual(ohara.language("Naruto v01-72 [VIZ]", "YggReborn"), "EN")

    def test_natural_order(self):
        names = ["T10.cbz", "T2.cbz", "T1.cbz"]
        self.assertEqual(sorted(names, key=ohara.natural), ["T1.cbz", "T2.cbz", "T10.cbz"])

    def test_is_manga(self):
        cat = lambda *ids: [{"id": i} for i in ids]
        self.assertTrue(ohara.is_manga({"title": "Naruto Tome 1", "categories": cat(8000)}))
        self.assertTrue(ohara.is_manga({"title": "Something", "categories": cat(7030)}))
        self.assertTrue(ohara.is_manga({"title": "Frieren CBZ", "categories": []}))
        self.assertFalse(ohara.is_manga({"title": "Frieren S01E04 1080p", "categories": cat(5070)}))
        self.assertFalse(ohara.is_manga({"title": "Naruto Tome 1", "categories": cat(2000)}))
        self.assertFalse(ohara.is_manga({"title": "Naruto", "categories": []}))
        self.assertFalse(ohara.is_manga({"title": "Kyonatix - Frieren.zip", "categories": cat(8000)}))
        self.assertFalse(ohara.is_manga({"title": "Frieren Fern Tome 1", "categories": cat(6000, 6070)}))
        self.assertFalse(ohara.is_manga({"title": "Frieren OST [FLAC]", "categories": cat(3000)}))
        self.assertTrue(ohara.is_manga({"title": "Naruto T01-72 [CBZ]", "categories": cat(8000)}))


class MoreNames(unittest.TestCase):
    def test_tome_ranges(self):
        cases = {
            "Naruto - T01 à T72 Intégrale + Gaiden [CBZ]  Fr": (1, 72),
            "Frieren T01 - T14 (scan officiel) [CBZ] Fr": (1, 14),
            "Sousou no Frieren - Tomes 01 à 13 [CBZ/FR]": (1, 13),
            "One Piece - Édition Originale - Tome 98 : Les neuf rônins": (98, 98),
            "[SoM] Dragon Ball Manga Kanzenban v01-34": (1, 34),
            "One Piece T106-114 Scan CBZ": (106, 114),
            "Frieren - Tomes 3 à 5 - Ki-oon": (3, 5),
            "Frieren - Tomes 1 et 2 - Yamada": (1, 2),
            "Boruto T17 & T18  [CBZ] Fr": (17, 18),
            "Berserk v42 (2025) (Digital)": (42, 42),
            "One Piece en couleurs - T001-104 CBZ": (1, 104),
            "Sousou no Frieren Tome 1 à Tome 13 VF": (1, 13),
            "Sousou no Frieren T01 à 6 +Ch.65 à 79 [Scantrad KSS]": (1, 6),
            "Naruto [VON] Manga Volumes 01-73 + Data Books": (1, 73),
            "Odd T09 - T03 [CBZ]": (9, 9),
            "Berserk (01-41+) (Miura)": None,
            "Naruto Intégrale [CBZ]": None,
        }
        for title, expected in cases.items():
            self.assertEqual(ohara.tome_range(title), expected, title)

    def test_norm_speed_and_numbers(self):
        self.assertEqual(ohara.norm("Shingeki no Kyojin : L'Attaque des Titans!"), "shingekinokyojinlattaquedestitans")
        self.assertEqual(ohara.norm("Élan"), "elan")
        self.assertEqual([ohara.speed(n) for n in (25, 4, 1, 0)], ["rapide", "correct", "lent", "bloqué"])
        self.assertEqual(ohara.volume_number("Naruto T05.cbz"), 5.0)
        self.assertIsNone(ohara.volume_number("ScanTrad bonus.cbz"))


class Search(Library):
    RESULTS = [
        {"guid": "a", "title": "Berserk v42 (Digital)", "size": 3e8, "seeders": 100, "indexer": "Nyaa.si", "categories": [{"id": 7030}], "downloadUrl": "http://p/a"},
        {"guid": "b", "title": "Naruto T01 à T72 [CBZ] Fr", "size": 7e9, "seeders": 5, "indexer": "YggReborn", "categories": [{"id": 7000}], "magnetUrl": "magnet:?b"},
        {"guid": "c", "title": "Naruto S01E01 1080p", "categories": [{"id": 5000}]},
        {"guid": "d", "title": "Naruto - Tome 48 [CBZ] Fr", "size": 1e8, "seeders": 0, "indexer": "YggReborn", "categories": [{"id": 7000}]},
        {"guid": "e", "title": "Naruto Shippuden Tomes 1 à 3 FR", "size": 1e8, "seeders": 9, "indexer": "YggReborn", "categories": [{"id": 7000}]},
    ]
    INDEXERS = [{"id": 1, "name": "YggReborn", "enable": True}, {"id": 2, "name": "Nyaa.si", "enable": True}, {"id": 3, "name": "EZTV", "enable": True}]
    FACTS = {"Naruto": {"id": 11, "title": "Naruto"}, "Naruto Shippuden": {"id": 11, "title": "Naruto"}, "Berserk": {"id": 22}}

    def fake_prowlarr(self, calls):
        def fake(url, data=None, headers=None, timeout=60):
            calls.append(url)
            return self.INDEXERS if url.endswith("/indexer") else self.RESULTS
        return fake

    def test_find_releases_keeps_volumes(self):
        calls = []
        with mock.patch.object(ohara, "prowlarr_key", return_value="K"), mock.patch.object(ohara, "http_json", side_effect=self.fake_prowlarr(calls)):
            found = ohara.find_releases("naruto")
        self.assertIn("categories=7000&indexerIds=1&indexerIds=2", calls[1])
        self.assertNotIn("indexerIds=3", calls[1])
        self.assertEqual(len(found), 4)
        naruto = [r for r in found if r["title"].startswith("Naruto T01")][0]
        self.assertEqual((naruto["lang"], naruto["series"], naruto["range"], naruto["speed"]), ("FR", "Naruto", (1, 72), "correct"))
        self.assertEqual(ohara.found_releases[naruto["token"]]["_url"], "magnet:?b")

    def test_search_groups_by_series_best_first(self):
        cbz(self.root / "Naruto" / "Naruto T01.cbz", ["1.png"])
        with mock.patch.object(ohara, "prowlarr_key", return_value="K"), mock.patch.object(ohara, "http_json", side_effect=self.fake_prowlarr([])), \
                mock.patch.object(ohara, "lookup", side_effect=lambda n: self.FACTS.get(n, {})):
            groups = ohara.search("naruto")
        self.assertEqual([g["name"] for g in groups], ["Naruto", "Berserk"])
        naruto = groups[0]
        self.assertTrue(naruto["owned"])
        self.assertEqual(naruto["meta"]["id"], 11)
        self.assertEqual([r["title"][:12] for r in naruto["releases"]], ["Naruto T01 à", "Naruto Shipp", "Naruto - Tom"])
        self.assertNotIn("_url", naruto["releases"][0])
        self.assertFalse(groups[1]["owned"])

    def test_owned_name_by_anilist_id(self):
        ohara.save_state({"series": {"Naruto (VF)": {"anilist": 11}}})
        rel = [{"series": "Naruto Shippuden"}]
        self.assertEqual(ohara.owned_name(rel, {"id": 11}, {}), "Naruto (VF)")
        self.assertEqual(ohara.owned_name(rel, {"id": 99}, {}), "Naruto Shippuden")
        self.assertEqual(ohara.owned_name(rel, {}, {"narutoshippuden": "NS"}), "NS")

    def test_prowlarr_key_from_its_config(self):
        cfg = self.root / "config.xml"
        cfg.write_text("<Config><ApiKey>abc123</ApiKey></Config>")
        with mock.patch.object(ohara, "PROWLARR_CONFIG", str(cfg)):
            self.assertEqual(ohara.prowlarr_key(), "abc123")


class AniList(Library):
    ANSWER = {"data": {"Page": {"media": [{"id": 5, "title": {"romaji": "Sousou no Frieren", "english": None},
                                           "coverImage": {"extraLarge": None, "large": "http://c/l.jpg", "color": "#e4ae5d"},
                                           "volumes": None, "status": "RELEASING", "startDate": {"year": 2020}}]}}}

    def test_fetch(self):
        with mock.patch.object(ohara, "http_json", return_value=self.ANSWER) as call:
            meta = ohara.anilist_fetch("frieren")
        self.assertEqual(meta, {"id": 5, "title": "Sousou no Frieren", "cover": "http://c/l.jpg", "color": "#e4ae5d", "status": "En cours", "volumes": None, "year": 2020})
        self.assertEqual(call.call_args.kwargs["headers"]["User-Agent"], "Ohara/1.0")
        with mock.patch.object(ohara, "http_json", return_value={"data": {"Page": {"media": []}}}):
            self.assertEqual(ohara.anilist_fetch("zzz"), {})

    def test_lookup_is_kept(self):
        with mock.patch.object(ohara, "anilist_fetch", return_value={"id": 5}) as fetch:
            self.assertEqual(ohara.lookup("Frieren"), {"id": 5})
            self.assertEqual(ohara.lookup("frieren!"), {"id": 5})
        fetch.assert_called_once()

    def test_lookup_not_kept_when_anilist_is_down(self):
        with mock.patch.object(ohara, "anilist_fetch", side_effect=OSError):
            self.assertEqual(ohara.lookup("Frieren"), {})
        self.assertEqual(ohara.load_state()["lookups"], {})

    def test_refresh_meta_for_the_library(self):
        cbz(self.root / "Frieren" / "T1.cbz", ["1.png"])
        cbz(self.root / "Unknown" / "T1.cbz", ["1.png"])
        ohara.save_state({"downloads": {"H": {"series": "Naruto"}}})
        with mock.patch.object(ohara, "anilist_fetch", side_effect=lambda n: {"id": 5} if n == "Frieren" else {"id": 7} if n == "Naruto" else {}):
            ohara.refresh_meta()
        state = ohara.load_state()
        self.assertEqual(state["series"]["Frieren"]["anilist"], 5)
        self.assertNotIn("Unknown", state["series"])
        self.assertEqual(state["lookups"]["unknown"], {})
        self.assertEqual(state["lookups"]["naruto"], {"id": 7})


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class Transmission(Library):
    def test_rpc_takes_the_session_id_then_retries(self):
        answers = [
            urllib.error.HTTPError("u", 409, "conflict", {"X-Transmission-Session-Id": "S1"}, None),
            FakeResponse(json.dumps({"result": "success", "arguments": {"x": 1}}).encode()),
        ]
        sent = []

        def fake(req, timeout=30):
            sent.append(req.headers.get("X-transmission-session-id"))
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a

        with mock.patch("urllib.request.urlopen", side_effect=fake):
            self.assertEqual(ohara.rpc("session-get", {}), {"x": 1})
        self.assertEqual(sent[1], "S1")

    def test_rpc_errors(self):
        bad = FakeResponse(json.dumps({"result": "duplicate torrent"}).encode())
        with mock.patch("urllib.request.urlopen", return_value=bad), self.assertRaises(RuntimeError):
            ohara.rpc("torrent-add", {})
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("u", 500, "x", {}, None)), self.assertRaises(urllib.error.HTTPError):
            ohara.rpc("torrent-add", {})
        refuse = urllib.error.HTTPError("u", 409, "x", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=[refuse, refuse]), self.assertRaises(RuntimeError):
            ohara.rpc("torrent-add", {})

    def test_torrent_source(self):
        self.assertEqual(ohara.torrent_source("magnet:?xt=1"), {"filename": "magnet:?xt=1"})
        opener = mock.Mock()
        opener.open.return_value = FakeResponse(b"d4:info")
        with mock.patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(ohara.torrent_source("http://p/1"), {"metainfo": base64.b64encode(b"d4:info").decode()})
        opener.open.side_effect = ohara.MagnetFound("magnet:?xt=2")
        with mock.patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(ohara.torrent_source("http://p/2"), {"filename": "magnet:?xt=2"})

    def test_redirect_to_a_magnet_is_caught(self):
        h = ohara.KeepRedirect()
        with self.assertRaises(ohara.MagnetFound):
            h.redirect_request(None, None, 302, "", {}, "magnet:?xt=3")
        req = mock.Mock(full_url="http://p/1", headers={}, get_method=lambda: "GET", unredirected_hdrs={}, origin_req_host="p", data=None)
        with mock.patch("urllib.request.HTTPRedirectHandler.redirect_request", return_value="next") as up:
            self.assertEqual(h.redirect_request(req, None, 302, "", {}, "http://p/2"), "next")
        up.assert_called_once()

    def test_grab_adds_and_remembers(self):
        ohara.found_releases["t1"] = {"title": "Naruto [CBZ]", "series": "Naruto", "range": None, "_url": "magnet:?n"}
        with mock.patch.object(ohara, "rpc", return_value={"torrent-added": {"hashString": "H1"}}) as rpc, mock.patch.object(ohara, "lookup", return_value={}):
            done = ohara.grab("t1", "Naruto: Gaiden")
        self.assertEqual(done, {"series": "Naruto Gaiden", "hash": "H1"})
        args = rpc.call_args[0][1]
        self.assertEqual(args["filename"], "magnet:?n")
        self.assertTrue(args["download-dir"].startswith(ohara.TRANSMISSION_INCOMING + "/"))
        self.assertEqual(ohara.load_state()["downloads"]["H1"]["series"], "Naruto Gaiden")

    def test_grab_and_follow(self):
        ohara.found_releases["t2"] = {"title": "Frieren T01-T14", "series": "Frieren", "range": (1, 14), "_url": "magnet:?f"}
        with mock.patch.object(ohara, "rpc", return_value={"torrent-duplicate": {"hashString": "H2"}}), mock.patch.object(ohara, "lookup", return_value={"id": 5}):
            ohara.grab("t2", "", follow=True, query="frieren")
        state = ohara.load_state()
        self.assertEqual(state["series"]["Frieren"], {"follow": True, "query": "frieren", "anilist": 5})
        self.assertEqual(state["downloads"]["H2"]["range"], [1, 14])
        ohara.set_follow("Frieren", False)
        self.assertFalse(ohara.load_state()["series"]["Frieren"]["follow"])

    def test_grab_unknown_token(self):
        with self.assertRaises(KeyError):
            ohara.grab("nope", "x")

    def test_cancel(self):
        ohara.save_state({"downloads": {"H1": {}}, "progress": {}})
        with mock.patch.object(ohara, "rpc") as rpc:
            ohara.cancel("H1")
        rpc.assert_called_once_with("torrent-remove", {"ids": ["H1"], "delete-local-data": True})
        self.assertEqual(ohara.load_state()["downloads"], {})

    def test_torrents(self):
        self.assertEqual(ohara.torrents([]), [])
        with mock.patch.object(ohara, "rpc", return_value={"torrents": [{"hashString": "H"}]}):
            self.assertEqual(ohara.torrents(["H"]), [{"hashString": "H"}])

    def test_safe_torrents(self):
        with mock.patch.object(ohara, "torrents", side_effect=OSError):
            self.assertEqual(ohara.safe_torrents(["H"]), [])


class Import(Library):
    def test_archives_are_moved_and_zip_becomes_cbz(self):
        src = self.root / ".incoming" / "f1"
        cbz(src / "Naruto" / "Naruto T01.cbz", ["1.png"])
        cbz(src / "Naruto" / "Naruto T02.zip", ["1.png"])
        (src / "Naruto" / "Naruto T03.pdf").write_bytes(b"%PDF")
        (src / "readme.nfo").write_text("x")
        (self.root / "Naruto").mkdir()
        cbz(self.root / "Naruto" / "Naruto T01.cbz", ["1.png"])
        (src / "Naruto" / "Bonus.cbz").write_bytes(b"x")
        (self.root / "Naruto" / "Bonus.cbz").write_bytes(b"x")
        self.assertEqual(ohara.import_download(src, "Naruto"), 3)
        names = sorted(p.name for p in (self.root / "Naruto").iterdir())
        self.assertEqual(names, ["Bonus (2).cbz", "Bonus.cbz", "Naruto T01.cbz", "Naruto T02.cbz", "Naruto T03.pdf"])

    def test_tomes_already_there_are_left_out(self):
        cbz(self.root / "Frieren" / "Frieren T01.cbz", ["1.png"])
        src = self.root / ".incoming" / "f9"
        for n in (1, 2):
            cbz(src / f"Frieren - Tome {n:02d}.cbz", ["1.png"])
        self.assertEqual(ohara.import_download(src, "Frieren"), 1)
        self.assertEqual(sorted(p.name for p in (self.root / "Frieren").iterdir()), ["Frieren - Tome 02.cbz", "Frieren T01.cbz"])

    def test_cbr_is_unpacked_with_7zip(self):
        src = self.root / ".incoming" / "f2"
        src.mkdir(parents=True)
        (src / "Vol 1.cbr").write_bytes(b"rar")

        def fake_7z(cmd, check, capture_output):
            out = Path(cmd[3][2:])
            out.mkdir()
            (out / "p1.png").write_bytes(png())

        with mock.patch("subprocess.run", side_effect=fake_7z):
            self.assertEqual(ohara.import_download(src, "Berserk"), 1)
        with zipfile.ZipFile(self.root / "Berserk" / "Vol 1.cbz") as z:
            self.assertEqual(z.namelist(), ["p1.png"])

    def test_plain_images_become_one_volume_per_folder(self):
        src = self.root / ".incoming" / "f3"
        for folder in ("Tome 2", "Tome 1"):
            (src / folder).mkdir(parents=True)
            for n in (10, 2, 1):
                (src / folder / f"{n}.jpg").write_bytes(b"j")
        self.assertEqual(ohara.import_download(src, "Frieren"), 2)
        with zipfile.ZipFile(self.root / "Frieren" / "Tome 1.cbz") as z:
            self.assertEqual(z.namelist(), ["1.jpg", "2.jpg", "10.jpg"])

    def test_images_at_the_top(self):
        src = self.root / ".incoming" / "Oneshot"
        src.mkdir(parents=True)
        (src / "1.jpg").write_bytes(b"j")
        self.assertEqual(ohara.import_download(src, "Oneshot"), 1)
        self.assertTrue((self.root / "Oneshot" / "Oneshot.cbz").exists())

    def test_check_downloads_files_the_finished_ones(self):
        ohara.save_state({"downloads": {"H1": {"series": "Naruto", "title": "t", "folder": "f1"}, "H2": {"series": "X", "title": "t", "folder": "f2"}}, "progress": {}})
        cbz(self.root / ".incoming" / "f1" / "T1.cbz", ["1.png"])
        live = [{"hashString": "H1", "percentDone": 1}, {"hashString": "H2", "percentDone": 0.4}, {"hashString": "H9", "percentDone": 1}]
        with mock.patch.object(ohara, "torrents", return_value=live), mock.patch.object(ohara, "rpc") as rpc:
            ohara.check_downloads()
        rpc.assert_called_once_with("torrent-remove", {"ids": ["H1"], "delete-local-data": True})
        self.assertTrue((self.root / "Naruto" / "T1.cbz").exists())
        self.assertFalse((self.root / ".incoming" / "f1").exists())
        self.assertEqual(list(ohara.load_state()["downloads"]), ["H2"])

    def test_watch_survives_errors(self):
        with mock.patch.object(ohara, "check_downloads", side_effect=OSError("down")), \
                mock.patch.object(ohara.time, "sleep", side_effect=StopIteration), self.assertRaises(StopIteration):
            ohara.watch()


class Reading(Library):
    def setUp(self):
        super().setUp()
        cbz(self.root / "Naruto" / "Naruto T02.cbz", ["b/10.png", "b/2.png", "__MACOSX/._2.png", "b/.hidden.png", "notes.txt"])
        cbz(self.root / "Naruto" / "Naruto T01.cbz", ["1.png", "2.png"])
        (self.root / "Naruto" / "Naruto T03.pdf").write_bytes(b"%PDF")
        cbz(self.root / "Naruto" / "Naruto T04.cbz", ["1.png"])
        (self.root / "Empty").mkdir()
        (self.root / ".ohara").mkdir(exist_ok=True)

    def test_pages_in_reading_order(self):
        self.assertEqual(ohara.pages(self.root / "Naruto" / "Naruto T02.cbz"), ["b/2.png", "b/10.png"])
        data, name = ohara.page_bytes(self.root / "Naruto" / "Naruto T02.cbz", 1)
        self.assertEqual(name, "b/10.png")
        self.assertTrue(data.startswith(b"\x89PNG"))

    def test_volume_path_stays_in_the_library(self):
        self.assertEqual(ohara.volume_path("Naruto/Naruto T01.cbz").name, "Naruto T01.cbz")
        for bad in ("../etc/passwd", "Naruto", ".ohara/state.json", "Naruto/none.cbz"):
            with self.assertRaises(KeyError):
                ohara.volume_path(bad)

    def test_library_and_progress(self):
        ohara.save_progress("Naruto/Naruto T01.cbz", 1, 2)
        ohara.save_progress("Naruto/Naruto T02.cbz", 0, 2)
        with mock.patch.object(ohara, "safe_torrents", return_value=[]):
            lib = ohara.library()
        self.assertEqual([s["name"] for s in lib["series"]], ["Naruto"])
        vols = lib["series"][0]["volumes"]
        self.assertEqual([v["label"] for v in vols], ["Tome 1", "Tome 2", "Tome 3", "Tome 4"])
        self.assertEqual([v["done"] for v in vols], [True, False, False, False])
        self.assertFalse(vols[2]["readable"])
        self.assertEqual(lib["series"][0]["read"], 1)
        self.assertEqual(lib["last"]["id"], "Naruto/Naruto T02.cbz")
        self.assertEqual(lib["last"]["series"], "Naruto")

    def test_downloads_in_the_library(self):
        ohara.save_state({"downloads": {"H1": {"series": "A", "title": "a"}, "H2": {"series": "B", "title": "b"}, "H3": {"series": "C", "title": "c"}, "H4": {"series": "D", "title": "d"}}, "progress": {}})
        live = [
            {"hashString": "H1", "percentDone": 0.5, "eta": 60},
            {"hashString": "H2", "percentDone": 1},
            {"hashString": "H3", "percentDone": 0.1, "error": 3, "errorString": "no space"},
        ]
        with mock.patch.object(ohara, "safe_torrents", return_value=live):
            d = {x["hash"]: x for x in ohara.library()["downloads"]}
        self.assertEqual((d["H1"]["pct"], d["H1"]["state"], d["H1"]["eta"]), (50, "downloading", 60))
        self.assertEqual(d["H2"]["state"], "done")
        self.assertEqual((d["H3"]["state"], d["H3"]["error"]), ("error", "no space"))
        self.assertEqual(d["H4"]["state"], "unknown")
        self.assertIsNone(d["H1"]["cover"])

    def test_volume_pages_and_next_readable(self):
        ohara.save_progress("Naruto/Naruto T02.cbz", 1, 2)
        info = ohara.volume_pages("Naruto/Naruto T02.cbz")
        self.assertEqual(info, {"id": "Naruto/Naruto T02.cbz", "series": "Naruto", "label": "Tome 2", "count": 2, "page": 1, "next": "Naruto/Naruto T04.cbz"})
        self.assertIsNone(ohara.volume_pages("Naruto/Naruto T04.cbz")["next"])

    def test_cover_is_made_once(self):
        path = self.root / "Naruto" / "Naruto T01.cbz"
        first = ohara.cover(path)
        self.assertTrue(first.startswith(b"\xff\xd8"))
        with mock.patch.object(ohara, "page_bytes", side_effect=AssertionError("not again")):
            self.assertEqual(ohara.cover(path), first)

    def test_status_for_the_home_card(self):
        with mock.patch.object(ohara, "safe_torrents", return_value=[]):
            s = ohara.status()
        self.assertEqual((s["series"], s["volumes"], s["new"], s["downloads"], s["last"]), (1, 4, 4, [], None))

    def test_broken_state_file(self):
        (self.root / ".ohara" / "state.json").write_text("{")
        self.assertEqual(ohara.load_state(), {"downloads": {}, "progress": {}, "series": {}, "lookups": {}})


class Http(Reading):
    def call(self, method, path, body=None):
        h = ohara.Handler.__new__(ohara.Handler)
        h.path, h.command, h.request_version, h.requestline = path, method, "HTTP/1.1", ""
        raw = json.dumps(body).encode() if body is not None else b""
        h.headers = {"Content-Length": str(len(raw))}
        h.rfile, h.wfile = io.BytesIO(raw), io.BytesIO()
        h.client_address = ("192.168.1.20", 5000)
        h.server = mock.Mock()
        h.close_connection = True
        getattr(h, "do_" + method)()
        head, _, payload = h.wfile.getvalue().partition(b"\r\n\r\n")
        return int(head.split()[1]), head.decode(), payload

    def test_pages_api(self):
        code, _, body = self.call("GET", "/api/pages?vol=Naruto%2FNaruto%20T01.cbz")
        self.assertEqual((code, json.loads(body)["count"]), (200, 2))
        code, head, body = self.call("GET", "/api/page?vol=Naruto/Naruto%20T01.cbz&n=1")
        self.assertEqual(code, 200)
        self.assertIn("image/png", head)
        self.assertEqual(self.call("GET", "/api/page?vol=../x&n=0")[0], 404)

    def test_cover_and_file(self):
        code, head, _ = self.call("GET", "/api/cover?vol=Naruto/Naruto%20T01.cbz")
        self.assertIn("image/jpeg", head)
        code, head, body = self.call("GET", "/api/file?vol=Naruto/Naruto%20T03.pdf")
        self.assertEqual((code, body), (200, b"%PDF"))
        self.assertIn("application/pdf", head)

    def test_library_status_and_progress(self):
        with mock.patch.object(ohara, "safe_torrents", return_value=[]):
            self.assertEqual(self.call("GET", "/api/library")[0], 200)
            code, head, _ = self.call("GET", "/api/status.json")
        self.assertIn("Access-Control-Allow-Origin: *", head)
        self.assertEqual(self.call("POST", "/api/progress", {"vol": "Naruto/Naruto T01.cbz", "page": 1, "count": 2})[0], 200)
        self.assertEqual(ohara.load_state()["progress"]["Naruto/Naruto T01.cbz"]["page"], 1)

    def test_search_grab_cancel(self):
        with mock.patch.object(ohara, "search", return_value=[{"token": "t"}]) as search:
            self.assertEqual(json.loads(self.call("GET", "/api/search?q=naruto")[2]), [{"token": "t"}])
            self.assertEqual(json.loads(self.call("GET", "/api/search?q=")[2]), [])
        search.assert_called_once_with("naruto")
        with mock.patch.object(ohara, "grab", return_value={"series": "N", "hash": "H"}):
            self.assertEqual(json.loads(self.call("POST", "/api/grab", {"token": "t", "series": "N"})[2])["hash"], "H")
        with mock.patch.object(ohara, "cancel") as cancel:
            self.assertEqual(self.call("POST", "/api/cancel", {"hash": "H"})[0], 200)
        cancel.assert_called_once_with("H")

    def test_errors_become_json(self):
        with mock.patch.object(ohara, "search", side_effect=OSError("prowlarr down")):
            code, _, body = self.call("GET", "/api/search?q=x")
        self.assertEqual((code, json.loads(body)["error"]), (502, "prowlarr down"))

    def test_static_pages(self):
        code, head, body = self.call("GET", "/")
        self.assertEqual(code, 200)
        self.assertIn(b"Ohara", body)
        self.assertIn("text/html", head)
        self.assertEqual(self.call("GET", "/read")[0], 200)
        self.assertIn("text/javascript", self.call("GET", "/reader.js")[1])
        self.assertEqual(self.call("GET", "/../ohara.py")[0], 404)
        self.assertEqual(self.call("GET", "/nothing.css")[0], 404)

    def test_log_is_quiet(self):
        ohara.Handler.log_message(None, "x")


class Follow(Library):
    def rel(self, title, seeders=5, lang="FR"):
        return {"title": title, "series": ohara.guess_series(title), "range": ohara.tome_range(title), "lang": lang, "seeders": seeders, "token": title}

    def test_next_release_brings_the_next_tome(self):
        for n in (1, 2, 3):
            cbz(self.root / "Frieren" / f"T{n:02d}.cbz", ["1.png"])
        state = {"downloads": {"H": {"series": "Frieren", "range": [4, 4]}, "X": {"series": "Other", "range": [1, 9]}, "Y": {"series": "Frieren"}}}
        releases = [
            self.rel("Frieren T01 à T14 FR", seeders=20),
            self.rel("Frieren T06 - T14 FR", seeders=50),
            self.rel("Frieren T05 FR", seeders=2),
            self.rel("Frieren T05 - T06 FR", seeders=0),
            self.rel("Frieren T15 eng", lang="EN"),
            self.rel("Frieren Artbook FR"),
        ]
        self.assertEqual(ohara.next_release("Frieren", releases, state)["title"], "Frieren T01 à T14 FR")
        self.assertEqual(ohara.next_release("Frieren", releases[1:], state)["title"], "Frieren T05 FR")
        self.assertIsNone(ohara.next_release("Frieren", releases[3:], state))

    def test_check_follows_grabs_for_followed_series_only(self):
        cbz(self.root / "Frieren" / "T01.cbz", ["1.png"])
        ohara.save_state({"series": {"Frieren": {"follow": True, "query": "frieren", "anilist": 5}, "Naruto": {"follow": False}}})
        found = [self.rel("Sousou no Frieren T02 FR"), self.rel("Frieren Anthology T03 FR"), self.rel("Frieren T01 FR")]
        facts = {"Sousou no Frieren": {"id": 5}, "Frieren Anthology": {"id": 6}, "Frieren": {"id": 5}}
        with mock.patch.object(ohara, "find_releases", return_value=found) as find, mock.patch.object(ohara, "lookups", return_value=facts), \
                mock.patch.object(ohara, "grab") as grab:
            ohara.check_follows()
        find.assert_called_once_with("frieren")
        grab.assert_called_once_with("Sousou no Frieren T02 FR", "Frieren")
        self.assertGreater(ohara.load_state()["followed_at"], 0)

    def test_follows_are_due_every_twelve_hours(self):
        self.assertTrue(ohara.follows_due())
        ohara.save_state({"followed_at": ohara.time.time()})
        self.assertFalse(ohara.follows_due())
        with mock.patch.object(ohara, "check_downloads") as downloads, mock.patch.object(ohara, "check_follows") as follows:
            ohara.tick()
        downloads.assert_called_once()
        follows.assert_not_called()

    def test_series_info_missing_new_and_followed(self):
        for n in (1, 2, 5):
            cbz(self.root / "Frieren" / f"Frieren T{n:02d}.cbz", ["1.png"])
        old = self.root / "Frieren" / "Frieren T01.cbz"
        os.utime(old, (0, 0))
        ohara.save_state({"series": {"Frieren": {"follow": True}}, "lookups": {"frieren": {"id": 5, "cover": "c"}},
                          "progress": {"Frieren/Frieren T02.cbz": {"page": 3, "pages": 10, "at": 1}}})
        info = ohara.series_info(self.root / "Frieren", ohara.load_state())
        self.assertEqual((info["follow"], info["meta"]["cover"], info["missing"]), (True, "c", [3, 4]))
        self.assertEqual([v["new"] for v in info["volumes"]], [False, False, True])
        self.assertEqual(info["new"], 1)


class Main(Library):
    def test_main_starts_the_watch_and_the_server(self):
        with mock.patch.object(ohara.threading, "Thread") as thread, mock.patch.object(ohara, "ThreadingHTTPServer") as server:
            ohara.main()
        self.assertEqual(thread.return_value.start.call_count, 2)
        server.return_value.serve_forever.assert_called_once()
        self.assertTrue((self.root / ".incoming").is_dir())


if __name__ == "__main__":
    unittest.main()
