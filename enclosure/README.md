# Tower enclosure

A stackable enclosure for the whole stack, so it can sit next to the box in
the living room: Pi, 7-port hub, 5" screen, 2.5" drives and the power strip
with its bricks. Designed for resin printing on an Anycubic Photon Mono M7
(plate 223 × 126 × 230 mm); every stage fits the plate on its own.

The look: a lantern pagoda, made for a living room of katanas and dragons
rather than a grey box next to the router. Every stage has latticed windows
(asanoha, the hemp-leaf lattice) on its sides and its back, cut right
through the wall so the tower breathes through them. The two tall stages,
base and compute, get two tiers of smaller windows instead, split by a meander
band and set in fields of waves, so their walls keep the rhythm of the short
stages; the screen's bezel carries a meander too. A meander band runs
along the top and the bottom of every stage, the solid fields carry seigaiha
waves in relief, the corner posts wear three rings per stage, and the lid is
a pagoda roof with an eave and a ridge, the two exhaust stacks rising from
it like finials. Two round moon windows with ring grilles feed the base.
Every opening is a real one. The floors of the riser, hub, compute and disk
stages are latticed too (same triangle grid, 2 mm bars, solid under the
stops, the Pi standoffs and the cable pass-through), so the lid fan draws air
up through the whole tower, from the base slots to the roof.

![tower](renders/color.png)

Anthracite resin, with bronze dry-brushed on the reliefs (`renders/color.png`;
the colours are set at the top of `tower.scad`, for the renders only).
Eight colour schemes to compare are in `renders/colours/`.

## Stages, bottom to top

| Stage | Height | Holds |
| :--- | :--- | :--- |
| `base` | 130 mm | 3-outlet power strip lying flat (up to 175 × 65 × 48 mm; a Legrand extra-flat 3-way is 167 × 55 × 38), both bricks plugged in, standing up to 80 mm tall. Mains cord and Ethernet leave through two slots in the rear wall. Air comes in through the floor slots, on rubber feet. |
| `riser` | 30 mm | Empty. Slip one under any stage that needs more height, for a taller brick or a thicker drive. |
| `hub` | 34 mm | The 7-port hub, USB ports facing the rear through a slot. |
| `compute` | 124 mm | The screen, sunk in a pocket of the front face and held from inside by two `screen_clip` bars. The Pi 4 on four 14 mm standoffs at the left rear: USB and Ethernet face the middle, USB-C and micro-HDMI face the back of the screen (about 30 mm of room, so angled plugs), GPIO to the rear wall. Every cable stays inside. |
| `disk` | 32 mm | One 2.5" drive in its enclosure. Print one per drive, stack as many as needed. |
| `lid` | 18 mm + roof | Pagoda roof. 40 mm exhaust fan under the finned main stack; the smaller stack vents passively. |

Each stage has a plug underneath that drops into the stage below. A column
in each inside corner, half sunk in the walls, stands 8 mm tall at each end
of the stage with a 6 × 2 mm magnet pocket; the plug is notched around
the columns of the stage below, so column meets column and the magnets hold.
To save resin the corner conduits are hollow between the column ends, each
drained into the stage by two 2.5 mm holes, and the pagoda roof is a 3 mm
shell over the lid plate, drained by four 3 mm holes in the plate. A 36 × 14 mm pass-through at the rear of every
floor lets the cables run up and down the tower. The lattice pitch and the bands are the same on every stage, so the
ornament reads as one across the stack; the front only gets the two moon
windows, low on the base, and the screen.

Outer size: 190 × 110 mm over the pipes, about 385 mm tall with two disk stages and the stack. The footprint is set by the hub (155 mm), the strip and the screen; a disk stage is the same size as every other stage so that they stack.

## Files

- `tower.scad`: the parametric model. Open it in [OpenSCAD](https://openscad.org),
  pick a `part` at the top (or `openscad -D 'part="base"' -o base.stl tower.scad`).
  `assembly` shows the stack exploded, with ghosts of the parts to check the room.
- `stl/`: one STL per part, exported from the current parameters.
  `stl/print/` holds the same parts already oriented and tilted for the Photon
  Mono M7 plate: open them in Photon Workshop, add supports and save. Made by
  `python3 orient.py`; re-run it after re-exporting the STLs.
  Two test coupons cut from the oriented disk stage, to check supports and
  exposure for a fraction of the resin: `stl/print/disk-coupon.stl` is the low
  corner (`coupon.scad`), `stl/print/disk-coupon-high.stl` the highest corner,
  42 mm above the plate on the tallest supports (`coupon_high.scad`; a small pin
  standing on the plate beside it keeps it 26 mm up, since Workshop drops models
  to the plate when it generates supports; do not move it down). The high
  corner printed clean on 2026-10-13, so `orient.py` now tilts every part as far
  as it can while keeping its highest supported point within those 40 mm (42 with
  the Workshop lift). Only the lid cannot: roof down, the top of its eave stands
  at least 46 mm up, 50 mm as oriented. `stl/print/lid-coupon.stl`
  (`coupon_lid.scad`) is that corner, held 19 mm up by the same kind of pin.
- `step/`: the same parts as STEP (AP214), real solids for CAD tools rather than
  meshes. Made by `scad2step.py`, which runs OpenSCAD for the 2D profiles and
  [FreeCAD](https://www.freecad.org) for the solids and the export; the header of
  the script says how to run it. Re-run it after changing the model, like the STLs.
- `renders/`: reference pictures.

## Before printing

Everything is sized generously. Measure the real parts and adjust the
`components` block at the top of `tower.scad`, then re-export:

| Parameter | What to measure |
| :--- | :--- |
| `strip` | Power strip L × W × H, lying flat. The base height must be at least strip height + brick height; otherwise add a `riser`. |
| `hub` | Hub L × W × thickness. |
| `screen`, `screen_t` | Screen with its frame W × H, and the frame thickness that sits in the pocket. |
| `disk_bay` | Largest drive L × W × thickness. |
| `fan` | 40 mm fan assumed (Noctua NF-A4x10 5V PWM). |

Print settings for ABS-like resin: trays rim up, lid top down, tilted 10 to 15°
on two axes, heavy supports (Photon Workshop "Heavy": 0.55 mm tips, 1.6 mm
trunks, cross bars every 5 mm), dense under the floor pads, the columns and the
highest corner; exposure at the Workshop profile (2.2 s per 50 µm layer, 5
bottom layers at 35 s, black ABS-Like Pro 2). The first disk print, on light
supports, tore off at its highest corner.

The compute stage failed on 2026-10-14 with that profile as shipped: the raft
stayed on the plate, but the supports tore out of it at one end and the whole
floor came out rippled. The stock "Heavy" raft is a 0.8 mm honeycomb with 4 mm
holes and the trunks stand on it with no foot (platform foot off), and the lift
was the stock 8 mm at 6 mm/s with no pause. That held the disk (89 ml) and not
the compute (242 ml plus supports, twice the layers). For the compute, the base
and anything over about 100 ml, change the profile before slicing:

| Workshop setting | Stock "Heavy" | "Heavy tower" (lid) | "Heavy compute" (compute, base) |
| :--- | :--- | :--- | :--- |
| Raft holes | on, 4 mm | off (solid raft) | off |
| Raft thickness | 0.8 mm (16 layers) | 1.0 mm (20 layers: the 5 bottom + 15 transition layers, no raft layer at plain exposure) | 1.0 mm |
| Platform foot (support bottom) | off | on, 3 mm radius | on, 3 mm radius |
| Tip contact / depth in the part | 0.55 / 0.4 mm | unchanged | 0.7 / 0.5 mm |
| Anchor spacing (support density) | 3 mm | unchanged | 2 mm |
| Lift (resin profile "tower") | 8 mm at 6 mm/s, one stage | 10 mm in two stages: 4 mm at 3 mm/s, then 6 mm at 6 mm/s | same |
| Retract | 6 mm/s | 4 mm/s | same |
| Wait before lift | 0 s | 1 s | same |
| Exposure | 2.2 s, bottom 5 × 35 s | unchanged | unchanged |

`workshop_profile.py` installs the two support profiles and the resin profile
(quit Workshop first, it rewrites its files on exit). The numbers follow what
large-print users and Anycubic's own M7 troubleshooting report: supports tear
at the raft when the lift is too short for the film to let go, so the lift
distance goes up before anything else; a slow first stage helps most people
but ACF users warn that a crawl separates worse, hence 3 mm/s rather than 2;
a raft thicker than the bottom + transition layers warps and lets go, hence
1.0 mm; ABS-Like Pro 2 stays flexible while printing and wants fat tips. Keep
the room and the resin at 25 °C or more (the M7 has no heater; under 20 °C
Anycubic says +30 % exposure and -30 % Z speed), and check the plate with a
ruler against a light: dished plates are common on the M7 line and fail at the
centre first. The compute profile is
the stiffer one because it is the compute's floor that rippled: fatter tips
sunk deeper, trees closer together. The hub proves nothing the disk has not: it
is the same tray within 2 mm and 4 ml. Nothing over 89 ml has printed yet, so
the compute goes from the proven disk straight to 242 ml on a profile that has
never run: a known risk, taken to check the fit of the real parts first. Walls are 2 mm, floors 2.5 mm; the floor slots and
the floor lattice double as drain holes. The lattice openings are about 7 mm
triangles, easy to drain and to clean with a brush. The lid prints roof down:
the stacks, the eave and the fins need supports.

Print order: the stages that hold the parts first, to check the fit, the roof
last.

| # | File in `stl/print/` | Tilt | Height on the plate | Resin (without supports) | Highest supported point |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `disk.stl` (printed 2026-10-13, clean) | 6° × 10°, rear low | 78 mm | 89 ml | 40 mm (proven by the coupon) |
| 2 | `disk.stl` again, for the second drive | | | 89 ml | |
| 3 | `compute.stl` (failed 2026-10-14 on stock Heavy), on "Heavy compute" | 0° × 11° | 163 mm | 242 ml | 34 mm |
| 4 | `base.stl`, on "Heavy compute" | 0° × 10° | 166 mm | 253 ml | 31 mm |
| 5 | `hub.stl` (same tray as the disk) | 4° × 11°, rear low | 80 mm | 85 ml | 40 mm |
| 6 | `lid-coupon.stl` | as the lid | 54 mm | 24 ml | 50 mm |
| 7 | `lid.stl`, once the coupon is clean, on "Heavy tower" | 0° × 10°, roof down | 73 mm | 193 ml | 50 mm |
| – | `screen_clip.stl` × 2 | 15° × 13° | 42 mm | 4 ml each | small, any support |
| – | `riser.stl`, only if a stage lacks height | 6° × 10°, rear low | 77 mm | 84 ml | 40 mm |

The base and the compute stage are too wide to tilt across the plate at all,
but their supports stay lower than the disk's; they are the tallest and the
heaviest prints, which is why they come last. Count about 1 l of resin for the
standard tower, plus 20 to 30 % for the supports.

## Hardware

- 40 magnets 6 × 2 mm for the standard stack (8 per joint: 4 at the top of the
  stage below, 4 at the bottom of the stage above; 4 more per extra stage), glued
  with the poles checked; or half of them replaced by 6 × 2 mm steel discs
- 4 M2.5 × 6 screws for the Pi, 4 M3 × 8 for the screen clips, 4 M3 × 20 for the fan
- 4 self-adhesive rubber feet, 12 mm
- Noctua NF-A4x10 5V PWM fan, driven from the Pi GPIO
- Short cables: micro-HDMI to HDMI and USB-C (Pi power), both with a 90° plug at the Pi end; USB-A to micro-USB (screen)
- Optional: a 5 V addressable LED strip (WS2812) on the Pi GPIO, stuck inside behind the louvres
