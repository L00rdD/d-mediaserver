"""Tests of watchdog/watchdog.py, with every command, file and URL mocked:
python3 -m unittest watchdog/test_watchdog.py"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# loaded by path: run from the repo root, "watchdog" is this folder's package
_spec = importlib.util.spec_from_file_location(
    "watchdog_script", os.path.join(os.path.dirname(os.path.abspath(__file__)), "watchdog.py"))
watchdog = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(watchdog)


def done(code=0, out="", err=""):
    return subprocess.CompletedProcess([], code, out, err)


T = 1_000_000  # a clock far from 0, as time.time() is


class Commands(unittest.TestCase):
    def test_run_captures_text_with_a_timeout(self):
        with mock.patch.object(subprocess, "run", return_value=done()) as run:
            watchdog.run("ls", "/x", timeout=5)
        run.assert_called_once_with(("ls", "/x"), capture_output=True, text=True, timeout=5)

    def test_mounted_active_and_unit(self):
        with mock.patch.object(watchdog, "run", return_value=done(0, " mnt-storage.mount\n")) as run:
            self.assertTrue(watchdog.mounted("/mnt/storage"))
            self.assertTrue(watchdog.active("docker.service"))
            self.assertEqual(watchdog.unit_for("/mnt/storage"), "mnt-storage.mount")
        self.assertEqual(run.call_args_list, [
            mock.call("mountpoint", "-q", "/mnt/storage"),
            mock.call("systemctl", "is-active", "--quiet", "docker.service"),
            mock.call("systemd-escape", "--path", "--suffix=mount", "/mnt/storage"),
        ])
        with mock.patch.object(watchdog, "run", return_value=done(1)):
            self.assertFalse(watchdog.mounted("/x"))
            self.assertFalse(watchdog.active("docker.service"))

    def test_log_prints(self):
        with mock.patch("builtins.print") as p:
            watchdog.log("hi")
        p.assert_called_once_with("hi", flush=True)


class Files(unittest.TestCase):
    def test_read_env(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, ".env").write_text("# comment\n\nA = 1\nB='two'\nC=\"x=y\"\nnoequal\n")
            with mock.patch.object(watchdog, "PROJECT", Path(d)):
                self.assertEqual(watchdog.read_env(), {"A": "1", "B": "two", "C": "x=y"})

    def test_read_env_without_file(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(watchdog, "PROJECT", Path(d)):
            self.assertEqual(watchdog.read_env(), {})

    def test_fstab_drives(self):
        fstab = "\n".join([
            "# UUID=old /mnt/disks/old ext4",
            "",
            "short",
            "UUID=aaa /mnt/disks/disk1 ext4 defaults 0 0",
            "/dev/sdb1 /mnt/disks/disk2 ext4 defaults 0 0",
            "UUID=ddd /mnt/docker ext4 defaults 0 2",
            "UUID=eee /mnt/other ext4 defaults 0 2",
            "/mnt/disks/* /mnt/storage fuse.mergerfs defaults 0 0",
            "proc /proc proc defaults 0 0",
        ])
        with mock.patch.object(Path, "read_text", return_value=fstab):
            self.assertEqual(watchdog.fstab_drives(),
                             [("/mnt/disks/disk1", "aaa"), ("/mnt/disks/disk2", None), ("/mnt/docker", "ddd")])


class Stale(unittest.TestCase):
    def test_drive_back_under_another_device(self):
        with mock.patch.object(watchdog, "run", return_value=done(0, "/dev/sda1\n")) as run, \
                mock.patch.object(Path, "exists", return_value=True), \
                mock.patch.object(os.path, "realpath", side_effect=["/dev/sdb1", "/dev/sda1"]):
            self.assertTrue(watchdog.stale("/mnt/disks/disk1", "aaa"))
        run.assert_called_once_with("findmnt", "-no", "SOURCE", "/mnt/disks/disk1")

    def test_same_device_falls_back_on_reading(self):
        results = [done(0, "/dev/sda1\n"), done(2)]
        with mock.patch.object(watchdog, "run", side_effect=results) as run, \
                mock.patch.object(Path, "exists", return_value=True), \
                mock.patch.object(os.path, "realpath", return_value="/dev/sda1"):
            self.assertTrue(watchdog.stale("/mnt/disks/disk1", "aaa"))
        run.assert_called_with("ls", "/mnt/disks/disk1", timeout=15)

    def test_without_uuid_a_readable_mount_is_fine(self):
        with mock.patch.object(watchdog, "run", return_value=done(0)) as run:
            self.assertFalse(watchdog.stale("/mnt/disks/disk2", None))
        run.assert_called_once_with("ls", "/mnt/disks/disk2", timeout=15)

    def test_a_hanging_read_is_stale(self):
        with mock.patch.object(watchdog, "run", side_effect=subprocess.TimeoutExpired("ls", 15)):
            self.assertTrue(watchdog.stale("/mnt/disks/disk2", None))


class World:
    """A fake host: which paths are mounted, which units are active, which
    UUIDs are plugged in; records every command in order."""

    def __init__(self, mounted=(), plugged=(), docker=True, starts=(), ps="", stale=()):
        self.mounted, self.plugged, self.docker = set(mounted), set(plugged), docker
        self.starts, self.ps, self.stale = set(starts), ps, set(stale)
        self.calls = []

    def run(self, *cmd, timeout=60):
        self.calls.append(cmd)
        if cmd[0] == "mountpoint":
            return done(0 if cmd[-1] in self.mounted else 1)
        if cmd[0] == "systemd-escape":
            return done(0, cmd[-1] + ".mount\n")
        if cmd[:2] == ("systemctl", "is-active"):
            return done(0 if self.docker else 1)
        if cmd[:2] == ("systemctl", "start"):
            return self.start(cmd[2:])
        if cmd[0] == "docker":
            return done(0, self.ps)
        return done()

    def start(self, units):
        if "docker.service" in units:
            self.docker = "docker" in self.starts
            return done()
        path = units[0][:-len(".mount")]
        if path in self.starts:
            self.mounted.add(path)
            return done()
        return done(1, "", " wrong fs type \n")

    def patches(self):
        return [
            mock.patch.object(watchdog, "run", self.run),
            mock.patch.object(watchdog, "stale", lambda t, u: t in self.stale),
            mock.patch.object(Path, "exists", lambda p: str(p).startswith("/dev/disk/by-uuid/")
                              and p.name in self.plugged),
        ]

    def __enter__(self):
        self.active = self.patches()
        for p in self.active:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self.active:
            p.stop()


class Repair(unittest.TestCase):
    def test_stale_drive_plugged_again_is_detached(self):
        drives = [("/mnt/disks/disk1", "aaa"), ("/mnt/disks/disk2", "bbb"), ("/mnt/disks/disk3", None)]
        world = World(mounted=["/mnt/disks/disk1", "/mnt/disks/disk2", "/mnt/disks/disk3"], plugged=["aaa"],
                      stale=["/mnt/disks/disk1", "/mnt/disks/disk2", "/mnt/disks/disk3"])
        problems, actions = {}, []
        with world:
            watchdog.detach_stale(drives, problems, actions)
        self.assertEqual(world.calls[-4:], [
            ("systemctl", "stop", "docker.socket", "docker.service", "containerd.service"),
            ("umount", "-l", "/mnt/storage"),
            ("umount", "-l", "/mnt/disks/disk1"),
            ("umount", "-l", "/mnt/disks/disk3"),
        ])
        self.assertEqual(actions, ["detached the stale mount of disk1, disk3"])
        self.assertEqual(problems, {"drive:disk2": (
            "Drive disk2 (bbb) cannot be read and is unplugged.", watchdog.GRACE)})

    def test_nothing_stale_runs_nothing_more(self):
        world = World(mounted=["/mnt/disks/disk1"])
        problems, actions = {}, []
        with world:
            watchdog.detach_stale([("/mnt/disks/disk1", "aaa"), ("/mnt/disks/disk2", "bbb")], problems, actions)
        self.assertEqual(world.calls, [("mountpoint", "-q", "/mnt/disks/disk1"),
                                       ("mountpoint", "-q", "/mnt/disks/disk2")])
        self.assertEqual((problems, actions), ({}, []))

    def test_mount_drives(self):
        drives = [("/mnt/disks/ok", "o"), ("/mnt/disks/gone", "g"),
                  ("/mnt/disks/back", "b"), ("/mnt/disks/bad", None)]
        world = World(mounted=["/mnt/disks/ok"], plugged=["o", "b"], starts=["/mnt/disks/back"])
        problems, actions = {}, []
        with world:
            watchdog.mount_drives(drives, problems, actions)
        self.assertEqual(actions, ["remounted back"])
        self.assertEqual(problems, {
            "drive:gone": ("Drive gone (g) is unplugged or dead.", watchdog.GRACE),
            "drive:bad": ("Drive bad is plugged in but will not mount: wrong fs type", watchdog.GRACE),
        })
        self.assertIn(("systemctl", "start", "/mnt/disks/back.mount"), world.calls)

    def test_mount_pool(self):
        for starts, actions, problems in [
            (["/mnt/storage"], ["remounted the pool"], {}),
            ([], [], {"pool": ("The pool /mnt/storage is not mounted.", watchdog.GRACE)}),
        ]:
            got_p, got_a = {}, []
            with World(starts=starts):
                watchdog.mount_pool(got_p, got_a)
            self.assertEqual((got_p, got_a), (problems, actions))
        world = World(mounted=["/mnt/storage"])
        with world:
            watchdog.mount_pool({}, [])
        self.assertEqual(world.calls, [("mountpoint", "-q", "/mnt/storage")])

    def test_start_docker(self):
        cases = [
            (dict(docker=True), [], {}),
            (dict(docker=False, mounted=["/mnt/storage"], starts=["docker"]), ["started Docker"], {}),
            (dict(docker=False, mounted=["/mnt/storage"]), [],
             {"docker": ("Docker is stopped: every app is down.", watchdog.GRACE)}),
            (dict(docker=False), [], {"docker": ("Docker is stopped: every app is down.", watchdog.GRACE)}),
        ]
        for kwargs, actions, problems in cases:
            world = World(**kwargs)
            got_p, got_a = {}, []
            with world:
                watchdog.start_docker(got_p, got_a)
            self.assertEqual((got_p, got_a), (problems, actions), kwargs)
            started = ("systemctl", "start", "docker.socket", "docker.service") in world.calls
            self.assertEqual(started, "/mnt/storage" in kwargs.get("mounted", []), kwargs)

    def test_docker_waits_for_its_data_drive(self):
        needs = ["/mnt/storage", "/mnt/docker"]
        world = World(docker=False, mounted=["/mnt/storage"], starts=["docker"])
        problems = {}
        with world:
            watchdog.start_docker(problems, [], needs)
        self.assertNotIn(("systemctl", "start", "docker.socket", "docker.service"), world.calls)
        self.assertEqual(set(problems), {"docker"})
        world = World(docker=False, mounted=needs, starts=["docker"])
        actions = []
        with world:
            watchdog.start_docker({}, actions, needs)
        self.assertEqual(actions, ["started Docker"])

    def test_check_containers(self):
        ps = "\n".join([
            "web\trunning\tUp 3 hours\tms\t",
            "jellyfin\texited\tExited (1) 2 min ago\tms\t",
            "radarr\trunning\tUp 1 hour (unhealthy)\tms\t",
            "loose\texited\tExited (0)\t\t",
            "run-once\texited\tExited (0)\tms\tTrue",
            "short\trunning",
        ])
        problems = {}
        with World(ps=ps):
            watchdog.check_containers(problems)
        self.assertEqual(problems, {
            "container:jellyfin": ("Container jellyfin is exited (Exited (1) 2 min ago).", watchdog.GRACE),
            "unhealthy:radarr": ("Container radarr is unhealthy.", watchdog.GRACE_UNHEALTHY),
        })

    def test_check_home(self):
        problems = {}
        with mock.patch("urllib.request.urlopen") as urlopen:
            watchdog.check_home({}, problems)
        urlopen.assert_called_once_with("http://127.0.0.1:80/", timeout=10)
        self.assertEqual(problems, {})
        with mock.patch("urllib.request.urlopen", side_effect=OSError("refused")):
            watchdog.check_home({"HOME_PORT": "8080"}, problems)
        self.assertEqual(problems, {"home": ("The home page (port 8080) does not answer: refused", watchdog.GRACE)})

    def test_repair_and_check_with_docker_down_skips_the_containers(self):
        world = World(docker=False)
        with world, mock.patch.object(watchdog, "fstab_drives", return_value=[]), \
                mock.patch("urllib.request.urlopen") as urlopen:
            problems, actions = watchdog.repair_and_check({})
        self.assertEqual(set(problems), {"pool", "docker"})
        self.assertEqual(actions, [])
        urlopen.assert_not_called()
        self.assertFalse(any(c[0] == "docker" for c in world.calls))

    def test_repair_and_check_remounts_the_docker_drive_before_docker(self):
        world = World(docker=False, mounted=["/mnt/storage"], plugged=["ddd"],
                      starts=["/mnt/docker", "docker"])
        with world, mock.patch.object(watchdog, "fstab_drives", return_value=[("/mnt/docker", "ddd")]), \
                mock.patch("urllib.request.urlopen"):
            problems, actions = watchdog.repair_and_check({})
        self.assertEqual(actions, ["remounted docker", "started Docker"])
        self.assertEqual(problems, {})

    def test_repair_and_check_all_well(self):
        world = World(mounted=["/mnt/disks/disk1", "/mnt/storage"], plugged=["aaa"],
                      ps="web\trunning\tUp\tms\t")
        with world, mock.patch.object(watchdog, "fstab_drives", return_value=[("/mnt/disks/disk1", "aaa")]), \
                mock.patch("urllib.request.urlopen"):
            self.assertEqual(watchdog.repair_and_check({}), ({}, []))


class Post(unittest.TestCase):
    def sent(self, url):
        with mock.patch("urllib.request.urlopen") as urlopen:
            watchdog.post(url, "hello")
        req = urlopen.call_args[0][0]
        return req, json.loads(req.data)

    def test_native_and_slack_webhooks(self):
        req, body = self.sent("https://discord/api/webhooks/1")
        self.assertEqual(body, {"content": "hello", "username": "Mediaserver watchdog"})
        self.assertEqual(req.get_header("User-agent"), "mediaserver-watchdog")
        _, body = self.sent("https://discord/api/webhooks/1/slack/")
        self.assertEqual(body, {"text": "hello", "username": "Mediaserver watchdog"})

    def test_ping(self):
        with mock.patch("urllib.request.urlopen") as urlopen:
            watchdog.ping(None, True, "x")
            urlopen.assert_not_called()
            watchdog.ping("https://hc/1", True, "all good")
            watchdog.ping("https://hc/1/", False, "bad")
        urls = [c[0][0].full_url for c in urlopen.call_args_list]
        self.assertEqual(urls, ["https://hc/1", "https://hc/1/fail"])
        self.assertEqual(urlopen.call_args_list[1][0][0].data, b"bad")

    def test_ping_failure_is_logged(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("down")), \
                mock.patch.object(watchdog, "log") as log:
            watchdog.ping("https://hc/1", True, "x")
        log.assert_called_once_with("ping failed: down")


class Main(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.state = Path(self.dir.name, "sub", "state.json")
        for p in [
            mock.patch.object(watchdog, "STATE_FILE", self.state),
            mock.patch("socket.gethostname", return_value="dpi"),
            mock.patch.object(watchdog, "ping"),
        ]:
            p.start()
            self.addCleanup(p.stop)
        self.logs = []
        p = mock.patch.object(watchdog, "log", self.logs.append)
        p.start()
        self.addCleanup(p.stop)

    def main(self, now, problems, actions=(), env=None, post=None):
        env = {"WATCHDOG_WEBHOOK_URL": "https://d/1"} if env is None else env
        with mock.patch.object(watchdog, "read_env", return_value=env), \
                mock.patch("time.time", return_value=now), \
                mock.patch.object(watchdog, "repair_and_check", return_value=(dict(problems), list(actions))), \
                mock.patch.object(watchdog, "post", post or mock.Mock()) as posted:
            self.assertEqual(watchdog.main(), 0)
        return posted, json.loads(self.state.read_text())

    def test_first_run_without_state_and_all_good(self):
        posted, state = self.main(1000, {})
        posted.assert_not_called()
        self.assertEqual(state, {"since": {}, "reported": {}})
        self.assertEqual(self.logs, ["all good"])
        watchdog.ping.assert_called_once_with(None, True, "all good")

    def test_corrupt_state_is_ignored(self):
        self.state.parent.mkdir()
        self.state.write_text("{not json")
        _, state = self.main(1000, {})
        self.assertEqual(state, {"since": {}, "reported": {}})

    def test_problem_waits_for_its_grace_then_posts_then_reminds(self):
        pool = {"pool": ("The pool is not mounted.", 120)}
        posted, state = self.main(T, pool)
        posted.assert_not_called()
        self.assertEqual(state, {"since": {"pool": T}, "reported": {}})
        watchdog.ping.assert_called_with(None, True, "The pool is not mounted.")

        posted, state = self.main(T + 180, pool, actions=["remounted disk1"],
                                  env={"WATCHDOG_WEBHOOK_URL": "https://d/1", "WATCHDOG_PING_URL": "p"})
        posted.assert_called_once_with("https://d/1", "\n".join([
            "🔴 **dpi**: something is wrong",
            "- The pool is not mounted. (for 3 min)",
            "🔧 **dpi**: remounted disk1.",
        ]))
        self.assertEqual(state, {"since": {"pool": T}, "reported": {"pool": (T + 180)}})
        watchdog.ping.assert_called_with("p", False, "The pool is not mounted.")
        self.assertEqual(self.logs[-2:], ["remounted disk1", "The pool is not mounted."])

        posted, _ = self.main(T + 600, pool)
        posted.assert_not_called()
        posted, state = self.main((T + 180) + watchdog.REMIND, pool)
        posted.assert_called_once()
        self.assertEqual(state["reported"], {"pool": (T + 180) + watchdog.REMIND})

    def test_back_up_waits_for_the_last_problem(self):
        self.state.parent.mkdir()
        self.state.write_text(json.dumps({"since": {"a": 0, "b": 0}, "reported": {"a": 10, "b": 10}}))
        posted, state = self.main(100, {"b": ("B", 120)})
        posted.assert_not_called()
        self.assertEqual(state, {"since": {"b": 0}, "reported": {"b": 10}})
        posted, state = self.main(200, {})
        posted.assert_called_once_with("https://d/1", "🟢 **dpi**: everything is back up.")
        self.assertEqual(state, {"since": {}, "reported": {}})

    def test_failed_post_keeps_the_state(self):
        self.state.parent.mkdir()
        self.state.write_text(json.dumps({"since": {}, "reported": {"a": 10}}))
        _, state = self.main(200, {}, post=mock.Mock(side_effect=OSError("discord down")))
        self.assertEqual(state, {"since": {}, "reported": {"a": 10}})
        self.assertIn("Discord post failed: discord down", self.logs)

    def test_without_webhook_the_message_is_logged(self):
        self.state.parent.mkdir()
        self.state.write_text(json.dumps({"since": {"x": T}, "reported": {}}))
        posted, state = self.main(T + 600, {"x": ("X", 120)}, env={"AUTOHEAL_WEBHOOK_URL": ""})
        posted.assert_not_called()
        self.assertEqual(state, {"since": {"x": T}, "reported": {"x": T + 600}})
        self.assertIn("🔴 **dpi**: something is wrong\n- X (for 10 min)", self.logs)

        posted, state = self.main(T + 700, {}, env={})
        self.assertEqual(state, {"since": {}, "reported": {}})
        self.assertIn("🟢 **dpi**: everything is back up.", self.logs)


if __name__ == "__main__":
    unittest.main()
