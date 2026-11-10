"""Tests of enclosure/orient.py on small made-up meshes, in a temporary folder:
python3 -m unittest enclosure/test_orient.py"""

import contextlib
import io
import math
import os
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import orient  # noqa: E402


def box(sx, sy, sz, x0=0, y0=0):
    """The 12 triangles of a box from (x0, y0, 0) to (x0 + sx, y0 + sy, sz)."""
    c = [(x, y, z) for x in (x0, x0 + sx) for y in (y0, y0 + sy) for z in (0, sz)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    tris = []
    for a, b, cc, d in faces:
        tris += [(c[a], c[b], c[cc]), (c[a], c[cc], c[d])]
    return tris


def stl_bytes(tris):
    buf = bytearray(80) + struct.pack("<I", len(tris))
    for t in tris:
        buf += struct.pack("<12fH", 0, 0, 0, *t[0], *t[1], *t[2], 0)
    return bytes(buf)


class Geometry(unittest.TestCase):
    def test_rot_identity_flip_and_turn(self):
        self.assertEqual(orient.apply(orient.rot(0, 0, False), (1, 2, 3)), (1, 2, 3))
        self.assertEqual(orient.apply(orient.rot(0, 0, True), (1, 2, 3)), (1, -2, -3))
        x, y, z = orient.apply(orient.rot(90, 0, False), (0, 1, 0))
        self.assertAlmostEqual(y, 0)
        self.assertAlmostEqual(z, 1)
        x, y, z = orient.apply(orient.rot(0, 90, False), (1, 0, 0))
        self.assertAlmostEqual(z, -1)

    def test_bbox_and_fits(self):
        self.assertEqual(orient.bbox([(0, 5, -1), (2, -3, 4)]), ([0, -3, -1], [2, 5, 4]))
        self.assertTrue(orient.fits([211, 114, 222]))
        self.assertFalse(orient.fits([212, 10, 10]))
        self.assertFalse(orient.fits([10, 115, 10]))
        self.assertFalse(orient.fits([10, 10, 223]))

    def test_hanging_tray_takes_its_bottom(self):
        pts = [(0, 0, 1.0), (5, 5, 1.5), (3, 3, 1.7), (9, 9, 20)]
        self.assertEqual(orient.hanging(pts, False), [(0, 0, 1.0), (5, 5, 1.5)])

    def test_hanging_lid_takes_its_eave_corners(self):
        pts = [(93, 0, 18.1), (0, 53, 17.8), (-95, -60, 18), (10, 10, 18), (93, 0, 19)]
        self.assertEqual(orient.hanging(pts, True), [(93, 0, 18.1), (0, 53, 17.8), (-95, -60, 18)])


class Files(unittest.TestCase):
    def test_write_then_read(self):
        tris = [((0, 0, 0), (1, 0, 0), (0, 1, 0)), ((0, 0, 0), (0, 0, 0), (0, 0, 0))]
        with tempfile.TemporaryDirectory() as d:
            path = Path(d, "t.stl")
            orient.write(path, tris)
            data = path.read_bytes()
            self.assertEqual(len(data), 84 + 50 * 2)
            self.assertEqual(struct.unpack_from("<3f", data, 84), (0, 0, 1))
            self.assertEqual(struct.unpack_from("<3f", data, 134), (0, 0, 0))   # degenerate: no normal
            self.assertEqual(orient.read(path), [tuple(tuple(map(float, p)) for p in t) for t in tris])


class Search(unittest.TestCase):
    def test_tray_tilts_as_far_as_allowed(self):
        pts = list({p for t in box(60, 40, 20) for p in t})
        low = orient.hanging(pts, False)
        ax, ay, key, high = orient.search("screen_clip", False, pts, low)
        self.assertEqual((ax, ay), (15, 15))
        self.assertEqual(key, (True, 30))
        self.assertLessEqual(high, orient.HIGH)

    def test_rear_down_and_capped_along(self):
        pts = list({p for t in box(100, 60, 30) for p in t})
        ax, ay, _, _ = orient.search("disk", False, pts, orient.hanging(pts, False))
        self.assertEqual((ax, ay), (-15, 10))

    def test_over_the_limit_the_lowest_corner_wins(self):
        pts = list({p for t in box(200, 100, 10) for p in t})
        with mock.patch.object(orient, "HIGH", 5):
            ax, ay, key, high = orient.search("hub", False, pts, orient.hanging(pts, False))
        self.assertFalse(key[0])
        self.assertEqual(key[1], -high)
        self.assertGreater(high, 5)
        self.assertEqual(ay, orient.MIN_TILT)

    def test_too_big_does_not_fit(self):
        pts = list({p for t in box(300, 10, 10) for p in t})
        self.assertIsNone(orient.search("base", False, pts, orient.hanging(pts, False)))

    def test_fixed_tilt(self):
        pts = list({p for t in box(100, 60, 30) for p in t})
        low = orient.hanging(pts, False)
        ax, ay, key, high = orient.fixed_tilt("lid", False, pts, low)
        self.assertEqual((ax, ay, key), (0, 25, None))
        self.assertAlmostEqual(high, 100 * math.sin(math.radians(25)), places=4)


class Main(unittest.TestCase):
    def test_every_part_is_written_or_reported(self):
        with tempfile.TemporaryDirectory() as d:
            src, out = Path(d, "stl"), Path(d, "stl", "print")
            src.mkdir()
            for name in orient.PARTS:
                tris = {"base": box(400, 10, 10), "lid": box(200, 100, 18, -100, -50)}.get(name, box(60, 40, 20))
                Path(src, f"{name}.stl").write_bytes(stl_bytes(tris))
            printed = io.StringIO()
            with mock.patch.object(orient, "src", src), mock.patch.object(orient, "out", out), \
                    contextlib.redirect_stdout(printed):
                orient.main()
            lines = printed.getvalue().splitlines()
            self.assertEqual(lines[0], "base: does not fit on the plate tilted by 10 degrees or more")
            self.assertEqual(sorted(p.name for p in out.iterdir()),
                             sorted(f"{n}.stl" for n in orient.PARTS if n != "base"))
            self.assertIn("lid: tilted 0 x 25 deg, upside down, ", printed.getvalue())
            self.assertIn("screen_clip: tilted 15 x 15 deg, 66 x 44 x 44 mm, highest support point 26 mm", printed.getvalue())
            placed = orient.read(Path(out, "riser.stl"))
            lo, hi = orient.bbox([p for t in placed for p in t])
            self.assertAlmostEqual(lo[2], 0, places=4)
            self.assertAlmostEqual(lo[0] + hi[0], 0, places=4)
            self.assertAlmostEqual(lo[1] + hi[1], 0, places=4)


if __name__ == "__main__":
    unittest.main()
