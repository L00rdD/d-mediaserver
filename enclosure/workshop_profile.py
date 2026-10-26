"""Install the "tower" profiles in Photon Workshop (Mac, V4.2.0) for the heavy
stages of the enclosure: compute, base and anything over about 100 ml.

The stock "Heavy" support profile stands 1.6 mm trunks on a 0.8 mm honeycomb
raft with 4 mm holes and no platform foot, and the stock ABS-Like Pro 2 resin
profile lifts 8 mm at 6 mm/s in one go. That held the disk (89 ml) and tore the
supports out of the raft under the compute (242 ml) on 2026-10-14. This adds:

  support "Heavy tower"   = Heavy + solid raft 1.0 mm + platform foot r = 3 mm
                            (1.0 mm = 20 layers, exactly the 5 bottom + 15
                            transition layers, so no raft layer gets the plain
                            2.2 s; a thicker raft warps and lets go)
  support "Heavy compute" = Heavy tower + tips 0.7 mm sunk 0.5 mm into the part
                            + anchors every 2 mm instead of 3 (denser trees),
                            for the compute and the base, whose floor rippled;
                            critical angle 40 instead of 50, so the 45-degree
                            keels, chamfers and gussets added on 2026-10-25
                            print on their own instead of under 150 mm trunks
  resin   "...@ACF@tower" = ABS-Like Pro 2 + lift raised to 10 mm in two stages
                            (4 mm at 3 mm/s, then 6 mm at 6 mm/s), retract
                            4 mm/s, 1 s wait before lift. Anycubic's own M7
                            troubleshooting says "increase lift distance,
                            decrease lift and retract speed"; ACF users warn
                            that a very slow lift separates worse, hence 3 mm/s
                            rather than 2.

and makes "Heavy compute" active. The "tower" resin profile is installed but
NOT made active: it only ever ran on the worn film (hub, 2026-10-15) and
proved nothing, while the stock "normal_print" printed the disk and every
coupon, so the stock profile stays active. Quit Photon Workshop first: it rewrites these files when
it exits and would undo the change. Backups are left next to the originals.

    python3 enclosure/workshop_profile.py
"""
import copy
import datetime
import json
import pathlib
import subprocess
import sys

APP = pathlib.Path.home() / "Library/Application Support/ANYCUBIC/AnycubicPhotonWorkshop_V4.2.0"
MACHINE = APP / "machine_type/Anycubic Photon Mono M7.pwsp"
SUPPORT = APP / "support_type/support_config.json"

SUPPORT_NAME = "Heavy tower"
COMPUTE_NAME = "Heavy compute"
RESIN_SETTING = "tower"
RAFT_HEIGHT = 1.0        # Heavy: 0.8 honeycomb; 20 layers = bottom 5 + transition 15
FOOT_RADIUS = 3.0
TIP_WIDTH = 0.7          # Heavy: 0.55
TIP_DEPTH = 0.5          # Heavy: 0.4
ANCHOR_DISTANCE = 2.0    # Heavy: 3
CRITICAL_ANGLE = 40.0    # Heavy: 50; faces steeper than this get no support
ACTIVE_RESIN = "Anycubic@abs_like_resin_pro2@ACF@normal_print"
WAIT_BEFORE_LIFT = 1.0
LIFT = ({"height": 4.0, "up_speed": 3.0, "down_speed": 4.0},   # slow first stage, until the layer pops off the film
        {"height": 6.0, "up_speed": 6.0, "down_speed": 4.0})   # then fast; 10 mm total (stock 8)


def workshop_running():
    out = subprocess.run(["pgrep", "-f", "AnycubicPhotonWorkshop.app"], capture_output=True, text=True)
    return out.returncode == 0


def backup(path):
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    dst = path.with_name(path.name + f".bak-{stamp}")
    dst.write_bytes(path.read_bytes())
    return dst


def section(profile, key):
    """A support profile is a list of one-key dicts; return the inner dict for `key`."""
    for block in profile:
        if key in block:
            return block[key]
    raise KeyError(key)


def tower_support(heavy):
    """Heavy with a solid, thicker raft and a foot under every trunk."""
    new = copy.deepcopy(heavy)
    section(new, "property")["support_name"] = SUPPORT_NAME
    base = section(new, "base")
    base["baseEnabled"] = True
    base["baseEnableHoles"] = False
    base["baseHeight"] = RAFT_HEIGHT
    foot = section(new, "plateform_connection")
    foot["pltEnabled"] = True
    foot["pltRadius"] = FOOT_RADIUS
    return new


def compute_support(tower):
    """Heavy tower with fatter tips sunk deeper and anchors closer together."""
    new = copy.deepcopy(tower)
    section(new, "property")["support_name"] = COMPUTE_NAME
    top = section(new, "top_connection")
    top["topContactWidth"] = TIP_WIDTH
    top["topDistanceInPart"] = TIP_DEPTH
    anchors = section(new, "anchors")
    anchors["anchorDistance"] = ANCHOR_DISTANCE
    anchors["horizontalSurfaceAnchorDistance"] = ANCHOR_DISTANCE
    anchors["criticalAngle"] = CRITICAL_ANGLE
    return new


def install_support():
    data = json.loads(SUPPORT.read_text())
    heavy = next(p for p in data["factory_support"] if section(p, "property")["support_name"] == "Heavy")
    tower = tower_support(heavy)
    compute = compute_support(tower)
    # Workshop keeps the profiles made in its own UI under "default_support"
    # (checked 2026-10-14 with a profile saved by hand); anything put in
    # "user_support" is dropped at the next launch.
    users = data.setdefault("default_support", [])
    users[:] = [p for p in users if section(p, "property")["support_name"] not in (SUPPORT_NAME, COMPUTE_NAME, "test")]
    users += [tower, compute]
    data["config_support"]["active_support"] = COMPUTE_NAME
    SUPPORT.write_text(json.dumps(data, indent=4, ensure_ascii=False))
    return tower, compute


def install_resin():
    data = json.loads(MACHINE.read_text())
    ext = data["machine_extern"]
    stock = next(r for r in ext["factory_resins"] if r["property"]["resin_name"] == "abs_like_resin_pro2")
    new = copy.deepcopy(stock)
    prop = new["property"]
    prop["setting_name"] = RESIN_SETTING
    prop["name"] = f"{prop['brand_name']}@{prop['resin_name']}@{prop['film_name']}@{RESIN_SETTING}"
    ex = new["slice_extpara"]
    ex["multi_state_used"] = 1
    ex["multi_state_paras"]["normal_0"] = dict(LIFT[0])
    ex["multi_state_paras"]["normal_1"] = dict(LIFT[1])
    sp = new["slicepara"]
    sp["zup_height"] = LIFT[0]["height"] + LIFT[1]["height"]   # the single-stage fields, kept consistent
    sp["zdown_speed"] = LIFT[1]["down_speed"]
    sp["wait_before_lift"] = WAIT_BEFORE_LIFT
    users = ext.setdefault("user_resins", [])
    users[:] = [r for r in users if r["property"]["name"] != prop["name"]]
    users.append(new)
    ext["active_resins"] = [ACTIVE_RESIN]
    MACHINE.write_text(json.dumps(data, indent=4, ensure_ascii=False))
    return prop["name"], sp, ex


if __name__ == "__main__":
    if workshop_running():
        sys.exit("Photon Workshop is running: quit it first (it rewrites its profiles on exit).")
    for f in (MACHINE, SUPPORT):
        print("backup:", backup(f))
    tower, compute = install_support()
    base, foot = section(tower, "base"), section(tower, "plateform_connection")
    print(f"support '{SUPPORT_NAME}': raft {base['baseHeight']} mm, holes {base['baseEnableHoles']}, "
          f"foot {foot['pltEnabled']} r={foot['pltRadius']} mm")
    top, anchors = section(compute, "top_connection"), section(compute, "anchors")
    print(f"support '{COMPUTE_NAME}': same + tips {top['topContactWidth']} mm sunk {top['topDistanceInPart']} mm, "
          f"anchors every {anchors['anchorDistance']:.0f} mm, critical angle {anchors['criticalAngle']:.0f} deg  (active)")
    name, sp, ex = install_resin()
    st = ex["multi_state_paras"]
    print(f"resin '{name}': {sp['exposure_time']:.1f} s, bottom {sp['bott_layers']} x {sp['bott_time']:.0f} s, "
          f"lift {st['normal_0']['height']:.0f} mm at {st['normal_0']['up_speed']:.0f} mm/s then "
          f"{st['normal_1']['height']:.0f} mm at {st['normal_1']['up_speed']:.0f} mm/s, "
          f"retract {st['normal_1']['down_speed']:.0f} mm/s, wait before lift {sp['wait_before_lift']:.0f} s, "
          f"transition layers {ex['transition_layercount']}  (installed, active resin: {ACTIVE_RESIN.split('@')[-1]})")
