"""Turn the STLs in stl/ into print-ready copies in stl/print/, already oriented
for the Anycubic Photon Mono M7 (plate 223 x 126 mm, 230 mm tall).

Trays print rim up, the lid roof down. Each part is tilted on two axes, as
much as the plate allows up to 15 degrees, so no layer is a whole floor at
once. The tall stages only fit tilted along the length of the plate: across
it they lean by a few degrees at most. Open the result in Photon Workshop, add
supports, save.

    python3 enclosure/orient.py
"""
import math
import pathlib
import struct

PLATE = (223, 126, 230)
MARGIN = 6            # kept free around the part on the plate, for the support feet and the raft
LIFT = 8              # room left under the part for the supports
MAX_TILT = 15
MIN_TILT = 10       # along the plate; across it any tilt from 0 is accepted

# part -> flip it upside down first
PARTS = {"base": False, "riser": False, "hub": False, "compute": False,
         "disk": False, "lid": True, "screen_clip": False}
# The first disk print (2026-10-12) tore off its supports at the highest corner:
# 58 mm up on 1.2 mm trunks, on the rear side where the floor is solid around the
# cable pass-through (the largest solid area of any layer). So the disk leans
# less along the plate, and across it the lattice side goes up and the solid
# rear band goes down: the highest corner drops from 58 to 42 mm, the rear band
# tops out at 31 mm.
MAX_ALONG = {"disk": 10}      # cap on the tilt along the plate, per part
REAR_DOWN = {"disk", "riser", "hub"}   # tilt across the plate with the rear (+y) side low
# The test coupon of that highest corner printed clean (2026-10-13), so 40 mm
# from the lowest point of the part to the highest point that hangs on supports
# is the proven limit: every part now tilts as far as it can without going over
# it. For the trays that point is a corner of the plug underneath; for the lid,
# printed roof down, it is a corner of the eave, which cannot come under 46 mm
# (the roof and the stack are that tall), so the lid takes the lowest it can get.
HIGH = 40

here = pathlib.Path(__file__).parent
src, out = here / "stl", here / "stl" / "print"


def read(path):
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    tris = []
    for i in range(n):
        v = struct.unpack_from("<12f", data, 84 + 50 * i)
        tris.append((v[3:6], v[6:9], v[9:12]))
    return tris


def rot(ax, ay, flip):
    a, b = math.radians(ax), math.radians(ay)
    rx = [[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]]
    ry = [[math.cos(b), 0, math.sin(b)], [0, 1, 0], [-math.sin(b), 0, math.cos(b)]]
    f = [[1, 0, 0], [0, -1, 0], [0, 0, -1]] if flip else [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    mul = lambda p, q: [[sum(p[i][k] * q[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    return mul(ry, mul(rx, f))


def apply(m, p):
    return tuple(m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] for i in range(3))


def bbox(pts):
    lo = [min(p[i] for p in pts) for i in range(3)]
    hi = [max(p[i] for p in pts) for i in range(3)]
    return lo, hi


def fits(size):
    return (size[0] + 2 * MARGIN <= PLATE[0] and size[1] + 2 * MARGIN <= PLATE[1]
            and size[2] + LIFT <= PLATE[2])


def write(path, tris):
    buf = bytearray(80) + struct.pack("<I", len(tris))
    for t in tris:
        u = [t[1][i] - t[0][i] for i in range(3)]
        v = [t[2][i] - t[0][i] for i in range(3)]
        nrm = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        ln = math.sqrt(sum(c * c for c in nrm)) or 1
        buf += struct.pack("<12fH", *(c / ln for c in nrm), *t[0], *t[1], *t[2], 0)
    path.write_bytes(buf)


out.mkdir(exist_ok=True)
def hanging(pts, flip):
    """The points whose height above the plate sets the tallest supports: the
    bottom of the plug for a tray, the top of the eave for the lid."""
    if flip:
        return [p for p in pts if abs(p[2] - 18) < 0.3 and (abs(p[0]) > 92 or abs(p[1]) > 52)]
    z0 = min(p[2] for p in pts)
    return [p for p in pts if p[2] - z0 < 0.6]


for name, flip in PARTS.items():
    tris = read(src / f"{name}.stl")
    pts = list({p for t in tris for p in t})
    low = hanging(pts, flip)
    best = None
    sx = -1 if name in REAR_DOWN else 1
    for ay in range(MAX_ALONG.get(name, MAX_TILT), MIN_TILT - 1, -1):
        for ax in range(sx * MAX_TILT, sx * -1, -sx):
            m = rot(ax, ay, flip)
            lo, hi = bbox([apply(m, p) for p in pts])
            size = [hi[i] - lo[i] for i in range(3)]
            if not fits(size):
                continue
            high = max(apply(m, p)[2] for p in low) - lo[2]
            # under the limit, the most tilt wins; over it, the lowest corner
            key = (high <= HIGH, abs(ax) + ay if high <= HIGH else -high)
            if best is None or key > best[2]:
                best = (ax, ay, key, high)
    if not best:
        print(f"{name}: does not fit on the plate tilted by {MIN_TILT} degrees or more")
        continue
    m = rot(best[0], best[1], flip)
    moved = [tuple(apply(m, p) for p in t) for t in tris]
    lo, hi = bbox([p for t in moved for p in t])
    centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]
    moved = [tuple(tuple(p[i] - centre[i] for i in range(3)) for p in t) for t in moved]
    write(out / f"{name}.stl", moved)
    size = [hi[i] - lo[i] for i in range(3)]
    print(f"{name}: tilted {best[0]} x {best[1]} deg{', upside down' if flip else ''}, "
          f"{size[0]:.0f} x {size[1]:.0f} x {size[2]:.0f} mm, highest support point {best[3]:.0f} mm")
