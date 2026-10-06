// Mediaserver tower: a stackable enclosure for the Pi, its hub, its disks,
// a 5" screen and the power strip, printed in resin (Anycubic Photon Mono M7,
// plate 223 x 126 x 230 mm). Every stage is a tray with a plug underneath that
// drops into the stage below; magnets in the corners keep the stack together.
//
// Stages, bottom to top:  base (power strip + bricks)  >  hub  >  compute
// (Pi + screen)  >  disk (one drive each, print as many as needed)  >  lid (fan).
//
// Export: set `part` below (or on the command line: -D 'part="base"') and
// render to STL. "assembly" shows the whole stack, exploded by `explode`.
//
// Printing (ABS-like resin): trays rim up, lid top down, tilted 10 to 15
// degrees on two axes with medium supports under the rim. Walls are 2.5 mm,
// floors 3.5 mm. The floor vents double as drain holes.
//
// Everything is sized generously on purpose: adjust the component block to the
// real parts and the rest follows.

part    = "assembly"; // [assembly, base, hub, compute, disk, lid, screen_clip]
explode = 25;         // gap between stages in the assembly view

/* ---------- shell ---------- */
wall     = 2.5;
floor_t  = 3.5;
r_out    = 8;      // corner radius of the tower
inner_w  = 200;    // left-right, inside
inner_d  = 110;    // front-back, inside
lip_h    = 6;      // plug under each stage
lip_clr  = 0.3;    // clearance between plug and the stage below
magnets  = true;   // 6 x 2 mm disc magnets, 4 per joint
magnet_d = 6.4;
magnet_h = 2.3;
boss_d   = 9.5;    // magnet boss at the inside corners of every rim
boss_in  = 8;      // boss centre, measured from the inside walls

/* ---------- stage heights, floor to rim ---------- */
base_h    = 110;
hub_h     = 34;
compute_h = 124;
disk_h    = 32;
lid_h     = 16;

/* ---------- components, oversized on purpose ---------- */
strip       = [190, 60, 45];  // power strip L x W x H, lying flat, outlets up
hub         = [155, 65, 26];  // 7-port hub, USB ports to the rear
screen      = [140, 100];     // screen with its black frame, W x H
screen_t    = 4;              // frame thickness sunk into the front pocket
screen_lip  = 3;              // front wall overlap on the frame edge
pi          = [85, 56];
pi_holes    = [58, 49];       // Pi 4 mounting holes
pi_stand_h  = 6;
disk_bay    = [130, 95, 26];  // one 2.5" drive in its enclosure, lying flat
fan         = 40; fan_holes = 32; fan_hole_d = 3.2; fan_open = 48;
cable       = [36, 14];       // rear cable pass-through in every floor
vent        = [26, 2.2];      // side vent slot, length x width

W = inner_w + 2 * wall;
D = inner_d + 2 * wall;
$fn = 48;

/* ---------- primitives ---------- */
module rrect(w, d, r) { offset(r = r) offset(delta = -r) square([w, d], center = true); }

// a tray: floor at the bottom of the plug, open at the top
module tray(h, passthrough = true) {
    difference() {
        union() {
            translate([0, 0, -lip_h])
                linear_extrude(lip_h + 0.01)
                    rrect(inner_w - 2 * lip_clr, inner_d - 2 * lip_clr, r_out - wall);
            linear_extrude(h) rrect(W, D, r_out);
        }
        // cavity above the rim of the stage below
        translate([0, 0, -0.01]) linear_extrude(h + 1) rrect(inner_w, inner_d, r_out - wall);
        // cavity inside the plug
        translate([0, 0, -lip_h + floor_t])
            linear_extrude(lip_h) rrect(inner_w - 2 * (wall + lip_clr), inner_d - 2 * (wall + lip_clr), r_out - 2 * wall);
        if (passthrough) rear_passthrough();
        if (magnets) floor_magnets();
    }
    if (magnets) rim_bosses(h);
}

module rear_passthrough() {
    translate([0, inner_d / 2 - cable[1] / 2 - wall - 4, -lip_h - 1])
        linear_extrude(floor_t + 2) rrect(cable[0], cable[1], 4);
}

module corners(inset) {
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (inner_w / 2 - inset), sy * (inner_d / 2 - inset), 0]) children();
}

module rim_bosses(h) {
    corners(boss_in) difference() {
        translate([0, 0, h - 10]) cylinder(d = boss_d, h = 10);
        translate([0, 0, h - magnet_h]) cylinder(d = magnet_d, h = magnet_h + 1);
    }
}

module floor_magnets() {
    corners(boss_in) translate([0, 0, -lip_h - 1]) cylinder(d = magnet_d, h = magnet_h + 1);
}

// horizontal slots through both side walls, hidden from the front
module side_vents(h, rows = 2, n = 3, margin = 10) {
    zs = rows == 1 ? [h / 2] : [for (i = [0 : rows - 1]) margin + i * (h - 2 * margin) / (rows - 1)];
    for (z = zs)
        for (i = [0 : n - 1])
            translate([0, -inner_d / 2 + 18 + i * (inner_d - 36) / max(n - 1, 1), z])
                cube([W + 2, vent[0], vent[1]], center = true);
}

// slots through the floor: air intake and drain holes
module floor_vents(n = 6, len = 60) {
    for (i = [0 : n - 1])
        translate([-inner_w / 2 + 25 + i * (inner_w - 50) / (n - 1), 0, -lip_h - 1])
            linear_extrude(floor_t + 2) rrect(vent[1] + 1, len, 1.5);
}

// four L-shaped stops around a footprint, to keep a part from sliding
module stops(size, at = [0, 0], h = 4, clr = 1, leg = 12) {
    for (sx = [-1, 1], sy = [-1, 1]) {
        cx = at[0] + sx * (size[0] / 2 + clr);
        cy = at[1] + sy * (size[1] / 2 + clr);
        translate([0, 0, -lip_h + floor_t - 0.01]) {
            translate([sx > 0 ? cx - leg : cx, sy > 0 ? cy : cy - 2, 0]) cube([leg, 2, h]);
            translate([sx > 0 ? cx : cx - 2, sy > 0 ? cy - leg : cy, 0]) cube([2, leg, h]);
        }
    }
}

/* ---------- stages ---------- */
module base() {
    difference() {
        tray(base_h, passthrough = false);
        floor_vents();
        side_vents(base_h, rows = 3);
        // mains cord: dropped in from the top, through the rear wall (right side)
        translate([inner_w / 2 - 40, D / 2, 30 + base_h]) cube([16, wall * 3, 2 * base_h], center = true);
        // ethernet and anything else leaving the tower: rear left
        translate([-inner_w / 2 + 40, D / 2, 30 + base_h]) cube([18, wall * 3, 2 * base_h], center = true);
        // rubber feet
        corners(14) translate([0, 0, -lip_h - 0.01]) cylinder(d = 12, h = 1);
    }
    stops(strip, h = 8);
}

module hub_stage() {
    difference() {
        tray(hub_h);
        side_vents(hub_h, rows = 1);
        // the 7 USB ports face the rear
        translate([0, D / 2, hub[2] / 2 + 4]) cube([hub[0] + 6, wall * 3, hub[2] - 2], center = true);
    }
    stops(hub, at = [0, inner_d / 2 - hub[1] / 2 - 3], h = 5);
}

module compute() {
    win = [screen[0] - 2 * screen_lip, screen[1] - 2 * screen_lip];
    zc  = compute_h / 2;               // screen centred on the front face
    pi_at = [inner_w / 2 - pi[0] / 2 - 6, inner_d / 2 - pi[1] / 2 - 3];  // right-rear, ports facing inwards
    difference() {
        union() {
            tray(compute_h);
            // thicker front plate so the frame can sit in a pocket
            translate([0, -inner_d / 2 + screen_t / 2 + 0.5, zc])
                cube([screen[0] + 24, screen_t + 1, screen[1] + 16], center = true);
        }
        side_vents(compute_h, rows = 2);
        // pocket from the outside, then the window through
        translate([0, -D / 2 - 1, zc]) cube([screen[0] + 0.6, 2 + screen_t + 1 + 2, screen[1] + 0.6], center = true);
        translate([0, -D / 2, zc]) cube([win[0], 40, win[1]], center = true);
    }
    // the frame is held from the inside by two clip bars screwed on these bosses
    for (sx = [-1, 1], sz = [-1, 1])
        translate([sx * (screen[0] / 2 + 6), -inner_d / 2 + screen_t + 1, zc + sz * (screen[1] / 2 + 6)])
            rotate([-90, 0, 0]) difference() { cylinder(d = 7, h = 8); cylinder(d = 2.4, h = 9); }
    // Pi standoffs; the USB and ethernet ports face the middle of the stage,
    // every cable stays inside and goes down through the rear pass-through
    translate([pi_at[0], pi_at[1], -lip_h + floor_t - 0.01])
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * pi_holes[0] / 2, sy * pi_holes[1] / 2, 0])
                difference() { cylinder(d = 6, h = pi_stand_h); cylinder(d = 2.4, h = pi_stand_h + 1); }
}

module disk() {
    difference() {
        tray(disk_h);
        side_vents(disk_h, rows = 1);
    }
    stops(disk_bay, at = [-inner_w / 2 + disk_bay[0] / 2 + 6, 0], h = 6);
}

module lid() {
    difference() {
        union() {
            translate([0, 0, -lip_h])
                linear_extrude(lip_h + 0.01)
                    rrect(inner_w - 2 * lip_clr, inner_d - 2 * lip_clr, r_out - wall);
            linear_extrude(lid_h) rrect(W, D, r_out);
        }
        // hollow underneath, the fan hangs from the top plate
        translate([0, 0, -lip_h - 1])
            linear_extrude(lip_h + lid_h - floor_t + 1)
                rrect(inner_w - 2 * (wall + lip_clr), inner_d - 2 * (wall + lip_clr), r_out - 2 * wall);
        // exhaust grille: honeycomb over the fan
        intersection() {
            translate([0, 0, lid_h - floor_t - 1]) cylinder(d = fan_open, h = floor_t + 2);
            for (i = [-5 : 5], j = [-5 : 5])
                translate([i * 6.2 + (j % 2 == 0 ? 0 : 3.1), j * 5.4, lid_h - floor_t - 1])
                    cylinder(d = 5, h = floor_t + 2, $fn = 6);
        }
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * fan_holes / 2, sy * fan_holes / 2, lid_h - floor_t - 1]) cylinder(d = fan_hole_d, h = floor_t + 2);
        if (magnets) corners(boss_in) translate([0, 0, -lip_h - 1]) cylinder(d = magnet_d, h = magnet_h + 1);
    }
}

// two of these hold the screen frame against its pocket
module screen_clip() {
    difference() {
        cube([screen[0] + 24, 8, 3], center = true);
        for (sx = [-1, 1]) translate([sx * (screen[0] / 2 + 6), 0, 0]) cylinder(d = 3.2, h = 10, center = true);
    }
}

/* ---------- assembly ---------- */
module assembly() {
    g = explode;
    color("white")          base();
    z1 = base_h + g;
    translate([0, 0, z1])                 color("white")      hub_stage();
    z2 = z1 + hub_h + g;
    translate([0, 0, z2])                 color("white")      compute();
    z3 = z2 + compute_h + g;
    translate([0, 0, z3])                 color("white")      disk();
    z4 = z3 + disk_h + g;
    translate([0, 0, z4])                 color("white")      disk();
    z5 = z4 + disk_h + g;
    translate([0, 0, z5])                 color("white")      lid();
    // ghosts of the parts, to check the room
    %translate([-strip[0] / 2, -strip[1] / 2, -lip_h + floor_t]) cube(strip);
    %translate([-hub[0] / 2, inner_d / 2 - hub[1] - 3, z1 - lip_h + floor_t]) cube(hub);
    %translate([-screen[0] / 2, -D / 2, z2 + compute_h / 2 - screen[1] / 2]) cube([screen[0], screen_t, screen[1]]);
    %translate([inner_w / 2 - pi[0] - 6, inner_d / 2 - pi[1] - 3, z2 - lip_h + floor_t + pi_stand_h]) cube([pi[0], pi[1], 20]);
    %translate([-inner_w / 2 + 6, -disk_bay[1] / 2, z3 - lip_h + floor_t]) cube(disk_bay);
    %translate([-inner_w / 2 + 6, -disk_bay[1] / 2, z4 - lip_h + floor_t]) cube(disk_bay);
}

if (part == "assembly")    assembly();
if (part == "base")        base();
if (part == "hub")         hub_stage();
if (part == "compute")     compute();
if (part == "disk")        disk();
if (part == "lid")         lid();
if (part == "screen_clip") screen_clip();
