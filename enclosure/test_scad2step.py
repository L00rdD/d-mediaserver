"""Tests of the pure parts of enclosure/scad2step.py, with FreeCAD and OpenSCAD
mocked (plain python3, no FreeCAD needed): python3 -m unittest enclosure/test_scad2step.py"""

import importlib.util
import os
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


def fake_freecad():
    """Stand-ins for the FreeCAD modules scad2step imports."""
    mods = {name: types.ModuleType(name) for name in ("FreeCAD", "Part", "Mesh", "Import", "importCSG")}
    mods["FreeCAD"].ParamGet = mock.MagicMock()
    mods["FreeCAD"].Placement = mock.MagicMock(return_value="placement")
    mods["Part"].makePolygon = mock.MagicMock(side_effect=lambda pts: ("wire", tuple(pts)))
    mods["Part"].makeFace = mock.MagicMock(return_value="face")
    mods["importCSG"].placeholder = mock.MagicMock(return_value="placeholder")
    mods["importCSG"].doc = mock.MagicMock()
    mods["importCSG"].convert_points_list_to_vector = mock.MagicMock(side_effect=lambda pts: list(pts))
    return mods


def load():
    """Import scad2step with no part to build: only its definitions and patches run."""
    mods = fake_freecad()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scad2step.py")
    spec = importlib.util.spec_from_file_location("scad2step", path)
    module = importlib.util.module_from_spec(spec)
    with mock.patch.dict(sys.modules, mods), mock.patch.dict(os.environ, {"PARTS": ""}), \
            mock.patch("os.makedirs") as makedirs:
        spec.loader.exec_module(module)
    return module, mods, makedirs


s2s, MODS, MAKEDIRS = load()
importCSG = MODS["importCSG"]


class Setup(unittest.TestCase):
    def test_step_settings_and_importer_patches(self):
        param = MODS["FreeCAD"].ParamGet
        param.assert_called_once_with("User parameter:BaseApp/Preferences/Mod/Part/STEP")
        param.return_value.SetString.assert_any_call("Scheme", "AP214IS")
        param.return_value.SetInt.assert_called_once_with("Unit", 0)
        self.assertIs(importCSG.fuse, s2s.lazy_fuse)
        self.assertIs(importCSG.p_polygon_action_plus_path, s2s.p_polygon_action_plus_path)
        self.assertEqual(s2s.p_polygon_action_plus_path.__module__, "importCSG")
        self.assertEqual(importCSG.start, "block_list")
        MAKEDIRS.assert_called_once_with(s2s.OUT, exist_ok=True)
        self.assertEqual(s2s.PARTS, [])


class LazyFuse(unittest.TestCase):
    def test_empty_single_and_many(self):
        self.assertEqual(s2s.lazy_fuse([], "u"), "placeholder")
        importCSG.placeholder.assert_called_with("group", [], "{}")
        self.assertEqual(s2s.lazy_fuse(["a"], "u"), "a")
        fused = s2s.lazy_fuse(["a", "b"], "u")
        importCSG.doc.addObject.assert_called_with("Part::MultiFuse", "u")
        self.assertIs(fused, importCSG.doc.addObject.return_value)
        self.assertEqual(fused.Shapes, ["a", "b"])
        self.assertEqual(fused.Placement, "placement")


class PolygonRule(unittest.TestCase):
    def test_every_path_becomes_a_wire_of_one_face(self):
        p = [None] * 18
        p[6] = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0.2, 0.2, 0), (0.4, 0.2, 0), (0.2, 0.4, 0)]
        p[12] = [["0", "1", "2", "3"], [4, 5, 6]]
        s2s.p_polygon_action_plus_path(p)
        made = [c[0][0] for c in MODS["Part"].makePolygon.call_args_list[-2:]]
        self.assertEqual(made[0], [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 0)])
        self.assertEqual(made[1], [(0.2, 0.2, 0), (0.4, 0.2, 0), (0.2, 0.4, 0), (0.2, 0.2, 0)])
        MODS["Part"].makeFace.assert_called_with([("wire", tuple(made[0])), ("wire", tuple(made[1]))],
                                                 "Part::FaceMakerBullseye")
        obj = importCSG.doc.addObject.return_value
        importCSG.doc.addObject.assert_called_with("Part::Feature", "polygon")
        self.assertEqual(obj.Shape, "face")
        self.assertEqual(p[0], [obj])


SVG = '''<svg><path d="M 1,-2 L 3.5,-2 L 3.5,-4.25 z
M 0,0 L 1e-07,0 z" />
<path d="M 10,10 L 11,10 L 11,11 L 10,11 z M -1.5,2 L -1,2.000001 L -1,3 z"/></svg>'''


class Polygons2D(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.stem = os.path.join(self.dir.name, "extrude_001")

    def openscad(self, svg, code=0):
        def run(cmd, capture_output, text):
            self.assertEqual(cmd, [s2s.OPENSCAD, "-q", "-o", self.stem + ".svg", self.stem + ".scad"])
            if svg is not None:
                with open(self.stem + ".svg", "w") as f:
                    f.write(svg)
            return subprocess.CompletedProcess(cmd, code, "", "")
        return mock.patch("subprocess.run", side_effect=run)

    def test_svg_paths_become_one_polygon(self):
        with self.openscad(SVG):
            out = s2s.polygons_2d("offset(1) square(3);", self.stem)
        with open(self.stem + ".scad") as f:
            self.assertEqual(f.read(), "offset(1) square(3);")
        self.assertEqual(out, (
            "polygon(points = [[1, 2], [3.5, 2], [3.5, 4.25], [0, -0], [0, -0], [10, -10], [11, -10], "
            "[11, -11], [10, -11], [-1.5, -2], [-1, -2.000001], [-1, -3]], "
            "paths = [[0, 1, 2], [5, 6, 7, 8], [9, 10, 11]], convexity = 10);"))

    def test_openscad_failure_or_no_contour_gives_nothing(self):
        with self.openscad(None):
            self.assertEqual(s2s.polygons_2d("x", self.stem), "")
        with self.openscad(SVG, code=1):
            self.assertEqual(s2s.polygons_2d("x", self.stem), "")
        with self.openscad('<svg><path d="M 0,0 L 1,0 z"/></svg>'):
            self.assertEqual(s2s.polygons_2d("x", self.stem), "")


class Flatten2D(unittest.TestCase):
    def flatten(self, text):
        calls = []

        def polygons(body, stem):
            calls.append((body, stem))
            return "P%d;" % len(calls)

        with mock.patch.object(s2s, "polygons_2d", side_effect=polygons):
            return s2s.flatten_2d(text, "/w"), calls

    def test_without_extrusion_the_text_is_unchanged(self):
        self.assertEqual(self.flatten("cube(1);"), ("cube(1);", []))

    def test_offset_and_big_bodies_are_replaced_small_ones_kept(self):
        small = "circle(r = 2);"
        big = "union() {" + "square(1);" * 13 + "}"
        text = ("a; linear_extrude(height = 1) {offset(r = 1) { square(2); }} b; "
                "linear_extrude(height = 2) {" + small + "} c; "
                "linear_extrude(height = 3) {" + big + "} d;")
        out, calls = self.flatten(text)
        self.assertEqual(out, ("a; linear_extrude(height = 1) {\nP1;\n} b; "
                               "linear_extrude(height = 2) {" + small + "} c; "
                               "linear_extrude(height = 3) {\nP2;\n} d;"))
        self.assertEqual(calls, [("offset(r = 1) { square(2); }", "/w/extrude_001"),
                                 (big, "/w/extrude_002")])

    def test_twelve_primitives_are_still_small(self):
        body = "square(1);" * 6 + "circle(1);" * 3 + "polygon(p);" * 3
        out, calls = self.flatten("linear_extrude(h) {" + body + "}")
        self.assertEqual((out, calls), ("linear_extrude(h) {" + body + "}", []))


if __name__ == "__main__":
    unittest.main()
