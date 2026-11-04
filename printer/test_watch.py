"""Tests of printer/watch.py, without network: python3 -m unittest printer/test_watch.py"""

import hashlib
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
import watch  # noqa: E402

PROJECT = {
    "printer_id": 42,
    "print_status": 1,
    "gcode_name": "04_riser",
    "remain_time": "95",
    "start_time": 1793700000,
    "img": "https://cdn.example/riser.png",
    "settings": json.dumps({"progress": 37, "curr_layer": 740, "total_layers": 2000}),
}


def reply(body):
    """What urlopen gives back, used as a context manager."""
    answer = mock.MagicMock()
    answer.__enter__.return_value = io.BytesIO(json.dumps(body).encode())
    return answer


class IsOn(unittest.TestCase):
    def test_first_open_port_is_enough(self):
        with mock.patch.object(socket, "create_connection") as connect:
            self.assertTrue(watch.is_on("M7.lan"))
            connect.assert_called_once()

    def test_tries_every_port_then_says_off(self):
        with mock.patch.object(socket, "create_connection", side_effect=OSError) as connect:
            self.assertFalse(watch.is_on("M7.lan"))
            self.assertEqual(connect.call_count, len(watch.PORTS))


class Signature(unittest.TestCase):
    def test_md5_of_id_time_version_secret_nonce_id(self):
        h = watch.signed_headers("tok", now_ms=1000, nonce="n")
        raw = f"{watch.APP_ID}1000{watch.APP_VERSION}{watch.APP_SECRET}n{watch.APP_ID}"
        self.assertEqual(h["Xx-Signature"], hashlib.md5(raw.encode()).hexdigest())
        self.assertEqual(h["XX-Token"], "tok")
        self.assertEqual(h["Xx-Timestamp"], "1000")

    def test_fresh_nonce_and_time_by_default(self):
        h = watch.signed_headers("tok")
        self.assertTrue(h["Xx-Nonce"])
        self.assertGreater(int(h["Xx-Timestamp"]), 0)


class CloudGet(unittest.TestCase):
    def test_returns_data_with_params(self):
        with mock.patch("urllib.request.urlopen", return_value=reply({"data": [1]})) as get:
            self.assertEqual(watch.cloud_get("/x", "tok", page="1"), [1])
            self.assertTrue(get.call_args[0][0].full_url.endswith("/x?page=1"))

    def test_expired_token_comes_as_a_message(self):
        with mock.patch("urllib.request.urlopen", return_value=reply({"data": None, "msg": "Token expired"})):
            with self.assertRaises(watch.TokenRejected):
                watch.cloud_get("/x", "tok")

    def test_other_empty_answers_pass(self):
        with mock.patch("urllib.request.urlopen", return_value=reply({"data": None, "msg": "ok"})):
            self.assertIsNone(watch.cloud_get("/x", "tok"))

    def test_http_401_is_a_rejected_token(self):
        err = urllib.error.HTTPError("u", 401, "no", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(watch.TokenRejected):
                watch.cloud_get("/x", "tok")

    def test_other_http_errors_go_up(self):
        err = urllib.error.HTTPError("u", 500, "down", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(urllib.error.HTTPError):
                watch.cloud_get("/x", "tok")


class Job(unittest.TestCase):
    def test_printing_job(self):
        job = watch.job_of(PROJECT)
        self.assertEqual(job["state"], "printing")
        self.assertTrue(job["active"])
        self.assertEqual((job["progress"], job["layer"], job["layers"]), (37, 740, 2000))
        self.assertEqual(job["remaining_min"], 95)
        self.assertEqual(job["started_at"], "2026-11-03T10:00:00+00:00")
        self.assertEqual(job["name"], "04_riser")

    def test_finished_job_reads_device_message(self):
        job = watch.job_of({"print_status": 2, "device_message": {"filename": "lid", "progress": 100}})
        self.assertEqual((job["state"], job["active"], job["name"], job["progress"]), ("done", False, "lid", 100))
        self.assertIsNone(job["started_at"])
        self.assertIsNone(job["image"])

    def test_no_job(self):
        self.assertIsNone(watch.job_of({}))

    def test_odd_fields(self):
        self.assertEqual(watch.as_dict("not json"), {})
        self.assertEqual(watch.as_dict("[1]"), {})
        self.assertIsNone(watch.number("abc"))
        self.assertEqual(watch.job_of({"print_status": 77})["state"], "unknown")

    def test_latest_job_of_this_printer(self):
        other = dict(PROJECT, printer_id=7, gcode_name="other")
        with mock.patch.object(watch, "cloud_get", return_value=[other, PROJECT]):
            self.assertEqual(watch.latest_job("tok", 42)["name"], "04_riser")
        with mock.patch.object(watch, "cloud_get", return_value=None):
            self.assertIsNone(watch.latest_job("tok", 42))


class FindPrinter(unittest.TestCase):
    PRINTERS = [{"id": 1, "name": "Kobra"}, {"id": 2, "name": "Atelier", "model": "Photon Mono M7"}]

    def find(self, wanted="", printers=PRINTERS):
        with mock.patch.object(watch, "cloud_get", return_value=printers):
            return watch.find_printer("tok", wanted)

    def test_by_name(self):
        self.assertEqual(self.find("kobra"), (1, "Kobra"))

    def test_m7_first(self):
        self.assertEqual(self.find(), (2, "Atelier"))

    def test_else_the_first(self):
        self.assertEqual(self.find(printers=[{"id": "5", "model": "X"}]), (5, "X"))

    def test_none(self):
        self.assertIsNone(self.find(printers=None))


class CloudPart(unittest.TestCase):
    def test_no_token(self):
        self.assertEqual(watch.cloud_part("", None), ({"cloud": "no token", "job": None}, None))

    def test_ok_and_printer_kept(self):
        with mock.patch.object(watch, "find_printer", return_value=(42, "M7")) as find, \
                mock.patch.object(watch, "latest_job", return_value={"name": "a"}):
            part, printer = watch.cloud_part("tok", None)
            self.assertEqual(part, {"cloud": "ok", "name": "M7", "job": {"name": "a"}})
            watch.cloud_part("tok", printer)
            find.assert_called_once()

    def test_no_printer(self):
        with mock.patch.object(watch, "find_printer", return_value=None):
            self.assertEqual(watch.cloud_part("tok", None)[0]["cloud"], "no printer on the account")

    def test_token_rejected_forgets_the_printer(self):
        with mock.patch.object(watch, "latest_job", side_effect=watch.TokenRejected("x")), mock.patch("builtins.print"):
            self.assertEqual(watch.cloud_part("tok", (42, "M7")), ({"cloud": "token rejected", "job": None}, None))

    def test_cloud_down_keeps_the_printer(self):
        with mock.patch.object(watch, "latest_job", side_effect=OSError("down")), mock.patch("builtins.print"):
            self.assertEqual(watch.cloud_part("tok", (42, "M7")), ({"cloud": "unreachable", "job": None}, (42, "M7")))


class Round(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        for patcher in (mock.patch.object(watch, "STATUS", self.dir), mock.patch("builtins.print")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def written(self):
        with open(os.path.join(self.dir, "printer.json")) as f:
            return json.load(f)

    def test_off_asks_nothing_of_the_cloud(self):
        with mock.patch.object(watch, "is_on", return_value=False), \
                mock.patch.object(watch, "cloud_part") as cloud:
            self.assertEqual(watch.round_once((42, "M7"), True), ((42, "M7"), False))
            cloud.assert_not_called()
        status = self.written()
        self.assertFalse(status["online"])
        self.assertIsNone(status["job"])
        self.assertIn("checked_at", status)

    def test_on_adds_the_cloud(self):
        with mock.patch.object(watch, "is_on", return_value=True), \
                mock.patch.object(watch, "cloud_part", return_value=({"cloud": "ok", "name": "M7", "job": {"x": 1}}, (42, "M7"))):
            self.assertEqual(watch.round_once(None, None), ((42, "M7"), True))
        status = self.written()
        self.assertTrue(status["online"])
        self.assertEqual((status["name"], status["job"]), ("M7", {"x": 1}))


class Main(unittest.TestCase):
    def test_loops_and_survives_a_failed_round(self):
        rounds = [OSError("disk"), ((1, "M7"), True)]
        sleeps = []

        def sleep(s):
            sleeps.append(s)
            if len(sleeps) == 2:
                raise KeyboardInterrupt

        with mock.patch.object(watch, "round_once", side_effect=rounds), \
                mock.patch.object(watch.time, "sleep", side_effect=sleep), \
                mock.patch("builtins.print"):
            with self.assertRaises(KeyboardInterrupt):
                watch.main()
        self.assertEqual(sleeps, [watch.OFF_INTERVAL, watch.INTERVAL])


if __name__ == "__main__":
    unittest.main()
