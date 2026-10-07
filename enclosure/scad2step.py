# Export the tower parts as STEP (AP214) from tower.scad, through FreeCAD.
#
#   openscad is used to flatten the SCAD into its CSG tree, FreeCAD rebuilds
#   that tree as real solids (true cylinders, planar faces) and writes STEP.
#
#   /Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd scad2step.py
#   PARTS="lid hub" freecadcmd scad2step.py        # a subset
#
# The base takes about 25 minutes (its lattice is 2400 primitives); the other
# parts take 15 s to 5 min each. Run from the enclosure directory.
import os, shutil, subprocess, sys, tempfile, time, traceback
import FreeCAD, Part, Mesh, Import, importCSG

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
SCAD = os.path.join(HERE, "tower.scad")
OUT = os.path.join(HERE, "step")
STL = os.path.join(HERE, "stl")
PARTS = os.environ.get("PARTS", "screen_clip lid riser hub disk compute base").split()
OPENSCAD = shutil.which("openscad") or "/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD"

p = FreeCAD.ParamGet("User parameter:BaseApp/Preferences/Mod/Part/STEP")
p.SetString("Scheme", "AP214IS")   # AP214, ISO version
p.SetInt("Unit", 0)                # mm
p.SetString("Product", "Mediaserver tower")


def lazy_fuse(lst, name):
    """importCSG.fuse evaluates a two-object fuse eagerly, before the children
    are recomputed, and dies on a null shape in deep trees. Make it lazy."""
    if len(lst) == 0:
        return importCSG.placeholder("group", [], "{}")
    if len(lst) == 1:
        return lst[0]
    f = importCSG.doc.addObject("Part::MultiFuse", name)
    f.Shapes = lst
    f.Placement = FreeCAD.Placement()
    return f


def flatten_2d(csg_text, workdir):
    """Replace the 2D body of every linear_extrude by polygons evaluated by
    OpenSCAD. FreeCAD's importer approximates offset(chamfer = true) and gets
    the lattice booleans slightly wrong; OpenSCAD's own 2D output is exact
    (and far fewer primitives for FreeCAD to fuse). Small bodies without an
    offset are left alone so that circles stay true circles."""
    out, i, n = [], 0, 0
    while True:
        j = csg_text.find("linear_extrude(", i)
        if j < 0:
            out.append(csg_text[i:])
            return "".join(out)
        k = csg_text.index("{", j)
        depth, m = 0, k
        while True:
            c = csg_text[m]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            m += 1
        body = csg_text[k + 1:m]
        out.append(csg_text[i:k + 1])
        prims = body.count("square(") + body.count("circle(") + body.count("polygon(")
        if "offset(" in body or prims > 12:
            n += 1
            out.append("\n" + polygons_2d(body, os.path.join(workdir, "extrude_%03d" % n)) + "\n")
        else:
            out.append(body)
        i = m


def polygons_2d(scad_body, stem):
    """Evaluate a 2D OpenSCAD body and return it as polygon() statements.
    OpenSCAD's SVG export gives one subpath per contour, y pointing down."""
    import re
    with open(stem + ".scad", "w") as f:
        f.write(scad_body)
    r = subprocess.run([OPENSCAD, "-q", "-o", stem + ".svg", stem + ".scad"], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(stem + ".svg"):
        return ""                                   # an empty 2D body: nothing to extrude
    svg = open(stem + ".svg").read()
    points, paths = [], []
    num = lambda v: ("%.6f" % v).rstrip("0").rstrip(".") or "0"
    for d in re.findall(r'd="([^"]*)"', svg):
        for tok in re.findall(r"[MLz]|-?[\d.]+(?:e-?\d+)?,-?[\d.]+(?:e-?\d+)?", d):
            if tok == "M":
                paths.append([])
            elif tok in ("L", "z"):
                pass
            else:
                x, y = tok.split(",")
                paths[-1].append(len(points))
                points.append((float(x), -float(y)))   # SVG y is down
    paths = [pa for pa in paths if len(pa) >= 3]
    if not paths:
        return ""
    return "polygon(points = [%s], paths = [%s], convexity = 10);" % (
        ", ".join("[%s, %s]" % (num(x), num(y)) for x, y in points),
        ", ".join("[%s]" % ", ".join(str(i) for i in pa) for pa in paths))


def p_polygon_action_plus_path(p):
    'polygon_action_plus_path : polygon LPAREN points EQ OSQUARE points_list_2d ESQUARE COMMA paths EQ OSQUARE path_set ESQUARE COMMA keywordargument_list RPAREN SEMICOL'
    # the stock rule keeps only the last path; sort outer contours and holes properly
    v = importCSG.convert_points_list_to_vector(p[6])
    wires = []
    for path in p[12]:
        pts = [v[int(j)] for j in path]
        pts.append(pts[0])
        wires.append(Part.makePolygon(pts))
    obj = importCSG.doc.addObject("Part::Feature", "polygon")
    obj.Shape = Part.makeFace(wires, "Part::FaceMakerBullseye")
    p[0] = [obj]


p_polygon_action_plus_path.__module__ = importCSG.__name__   # ply looks the rule's module up
importCSG.p_polygon_action_plus_path = p_polygon_action_plus_path
importCSG.start = "block_list"   # ply would otherwise start from the rule with the lowest line number: this one
importCSG.fuse = lazy_fuse
os.makedirs(OUT, exist_ok=True)

for part in PARTS:
    t0 = time.time()
    csg = os.path.join(tempfile.mkdtemp(), part + ".csg")
    subprocess.run([OPENSCAD, "-q", "-D", 'part="%s"' % part, "-o", csg, SCAD], check=True)
    text = flatten_2d(open(csg).read(), os.path.dirname(csg))
    with open(csg, "w") as f:
        f.write(text)
    if os.environ.get("DEBUG"):
        print("csg:", csg, file=sys.stderr)
    doc = FreeCAD.newDocument(part)
    importCSG.insert(csg, part)
    doc.recompute()
    # the importer leaves the 2D primitives it copied as orphan roots; the result is the last root
    roots = [o for o in doc.Objects if not o.InList and hasattr(o, "Shape") and not o.Shape.isNull()]
    if not roots:
        print(part, ": the CSG import produced nothing (syntax error in the CSG?)", file=sys.stderr)
        continue
    shape = roots[-1].Shape
    solids = sorted([s for s in shape.Solids if s.Volume > 1], key=lambda s: -s.Volume)
    out = FreeCAD.newDocument(part + "_out")
    obj = out.addObject("Part::Feature", part)
    obj.Shape = solids[0] if len(solids) == 1 else Part.makeCompound(solids)
    dst = os.path.join(OUT, part + ".step")
    Import.export([obj], dst)
    line = "%-12s %5d faces  %d solid(s)  volume %8.0f mm3" % (part, len(obj.Shape.Faces), len(solids), obj.Shape.Volume)
    stl = os.path.join(STL, part + ".stl")
    if os.path.exists(stl):
        line += "  = %.2f%% of the STL" % (100 * obj.Shape.Volume / Mesh.Mesh(stl).Volume)
    print(line + "  (%.0f s)" % (time.time() - t0), file=sys.stderr)
    FreeCAD.closeDocument(doc.Name)
    FreeCAD.closeDocument(out.Name)
