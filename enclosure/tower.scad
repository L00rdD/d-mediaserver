// Mediaserver tower: a stackable enclosure for the Pi, its hub, its disks,
// a 5" screen and the power strip, printed in resin (Anycubic Photon Mono M7,
// plate 223 x 126 x 230 mm). Every stage is a tray with a plug underneath that
// drops into the stage below; magnets in the corners keep the stack together.
//
// Look: an ornate hull, the opposite of a plain box. Every face is covered
// with sculpted plating, generated from a seed: tiles of three heights with
// chamfered edges, split like the hull of a ship. Fluted conduit columns with
// three rings per stage hold the corners, smaller conduits run around the
// base and the Pi stage, a stepped exhaust stack with fins and housing rings
// sits over the fan next to a smaller passive stack, two round intake ports
// feed the base, slanted louvres cut through the plating on the sides and the
// back. Every opening is a real one: the tower breathes through all of them.
//
// Stages, bottom to top:  base (power strip + bricks)  >  hub  >  compute
// (Pi + screen)  >  disk (one drive each, print as many as needed)  >  lid (fan).
//
// Export: set `part` below (or on the command line: -D 'part="base"') and
// render to STL. "assembly" shows the whole stack, exploded by `explode`.
//
// Printing (ABS-like resin, dark grey or black): trays rim up, lid top down,
// tilted 10 to 15 degrees on two axes, medium supports under the rim and the
// bosses. Walls are 2.5 mm, floors 3.5 mm. The floor slots double as drains.
//
// Everything is sized generously on purpose: adjust the component block to the
// real parts and the rest follows.

part    = "assembly"; // [assembly, base, riser, hub, compute, disk, lid, screen_clip]
explode = 25;         // gap between stages in the assembly view

/* ---------- shell ---------- */
wall     = 2.5;
floor_t  = 3.5;
chamfer  = 10;     // 45-degree chamfer on the vertical edges
inner_w  = 180;    // left-right, inside: the hub (155) and the strip set it
inner_d  = 100;    // front-back, inside: the Pi behind the screen sets it
lip_h    = 6;      // plug under each stage
lip_clr  = 0.3;    // clearance between plug and the stage below
magnets  = true;   // 6 x 2 mm disc magnets, 4 per joint
magnet_d = 6.4;
magnet_h = 2.3;
col_d    = 11;     // corner columns, full height, half sunk in the corner walls; they carry the magnets

/* ---------- louvres ---------- */
louvre_angle = 60;   // from horizontal
louvre_w     = 2.6;  // slot width
louvre_pitch = 9;    // distance between slots
louvre_end   = 18;   // kept clear at both ends of a wall (magnet bosses live there)
louvre_edge  = 7;    // kept clear above the floor and below the rim
louvre_band  = 40;   // tallest row of slots; taller stages get several rows
louvre_gap   = 8;    // between rows

/* ---------- stage heights, floor to rim ---------- */
base_h    = 130;   // strip 48 + a brick standing on it, up to 80 tall
riser_h   = 30;    // an empty stage, to add room anywhere in the stack
hub_h     = 34;
compute_h = 124;
disk_h    = 32;
lid_h     = 18;

/* ---------- components, oversized on purpose ---------- */
strip       = [175, 65, 48];  // power strip L x W x H, lying flat, outlets up.
                              // A Legrand extra-flat 3-way is 167 x 55 x 38.
hub         = [155, 65, 26];  // 7-port hub, USB ports to the rear
screen      = [140, 100];     // screen with its black frame, W x H
screen_t    = 4;              // frame thickness sunk into the front pocket
screen_lip  = 3;              // front wall overlap on the frame edge
pi          = [85, 56];
pi_holes    = [58, 49];       // Pi 4 mounting holes
pi_stand_h  = 6;
disk_bay    = [120, 90, 26];  // one 2.5" drive in its enclosure, lying flat (Samsung M3: 111 x 82 x 18)
fan         = 40; fan_holes = 32; fan_hole_d = 3.2;
cable       = [36, 14];       // rear cable pass-through in every floor
pipe_d      = 16;             // corner conduits
pipe_out    = 2.5;            // how far they stand proud of the walls
collar_d    = 20; collar_h = 5;
stack_d     = 64;             // exhaust stack over the fan, outer diameter
stack_h     = 14;
port_d      = 42;             // round intake ports on the front of the base
groove      = [1.2, 0.7];     // panel lines, width x depth
bolt_d      = 5;              // raised hex bolt heads
bolt_h      = 1.3;
run_d       = 9;              // the smaller conduits that run around the base and the Pi stage

/* ---------- plating ---------- */
tile_min    = 16;             // no tile smaller than this
tile_gap    = 1.4;            // groove between tiles
tile_depth  = 4;              // how many times a face is split
plate_seed  = 7;              // change for another pattern

W = inner_w + 2 * wall;
D = inner_d + 2 * wall;
$fn = 48;

/* ---------- primitives ---------- */
// rectangle with 45-degree chamfered corners
module cham(w, d, c) { offset(delta = c, chamfer = true) offset(delta = -c) square([w, d], center = true); }

// outer profile of the tower: the chamfered body with a conduit on each corner
module pipes_2d(w, d) {
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (w / 2 - pipe_d / 2 + pipe_out), sy * (d / 2 - pipe_d / 2 + pipe_out)]) circle(d = pipe_d);
}
module hull_2d(w, d, c) { cham(w, d, c); pipes_2d(w, d); }

// a collar on each conduit, the "fitting" between two pipe sections
module collars(z) {
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (W / 2 - pipe_d / 2 + pipe_out), sy * (D / 2 - pipe_d / 2 + pipe_out), z])
            cylinder(d = collar_d, h = collar_h);
}

// a recessed vertical or horizontal line on the front face
module panel_line(x, z, len, vertical = true) {
    translate([x, -D / 2 - 0.01, z]) rotate([90, 0, 0]) mirror([0, 0, 1])
        linear_extrude(groove[1] + 0.01)
            square(vertical ? [groove[0], len] : [len, groove[0]], center = true);
}

// a raised hex bolt head on the front face (x, z) or on the top of the lid (x, y)
module bolt_front(x, z) { translate([x, -D / 2 + 0.01, z]) rotate([90, 0, 0]) cylinder(d = bolt_d, h = bolt_h, $fn = 6); }
module bolt_top(x, y, z) { translate([x, y, z - 0.01]) cylinder(d = bolt_d, h = bolt_h, $fn = 6); }

// a smaller conduit running along both sides and the back at height z (the front stays clear),
// half sunk in the walls, with a junction block where it meets each column
module conduit_run(z) {
    translate([-W / 2, D / 2 + 0.5, z]) rotate([0, 90, 0]) cylinder(d = run_d, h = W);
    for (sx = [-1, 1]) translate([sx * (W / 2 + 0.5), 0, z]) rotate([90, 0, 0]) cylinder(d = run_d, h = D, center = true);
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (W / 2 - pipe_d / 2 + pipe_out), sy * (D / 2 - pipe_d / 2 + pipe_out), z]) cube([13, 13, 13], center = true);
}

// a raised service hatch on the front: a plate with chamfered corners and four bolts
module hatch(x, z, size) {
    translate([x, -D / 2 + 0.01, z]) rotate([90, 0, 0]) linear_extrude(1.5) cham(size[0], size[1], 3);
    for (sx = [-1, 1], sz = [-1, 1]) bolt_front(x + sx * (size[0] / 2 - 5), z + sz * (size[1] / 2 - 4.5));
}

// a round intake port: recessed disc with ring slots cut through the wall
module port(x, z) {
    translate([x, -D / 2, z]) rotate([90, 0, 0]) {
        translate([0, 0, -2]) cylinder(d = port_d, h = 3);                       // recess
        for (r = [7, 12.5, 18]) translate([0, 0, -wall - 3])
            linear_extrude(wall + 5) difference() { circle(r = r + 1.1); circle(r = r - 1.1); }
    }
}

// the four corner columns sit on the chamfered inside corners
module col_xy() {
    cc = chamfer - wall;
    for (sx = [-1, 1], sy = [-1, 1]) translate([sx * (inner_w / 2 - cc / 2), sy * (inner_d / 2 - cc / 2), 0]) children();
}

// the plug under a stage, with its corners cut away around the columns below
module plug_2d() {
    difference() {
        cham(inner_w - 2 * lip_clr, inner_d - 2 * lip_clr, chamfer - wall);
        col_xy() circle(d = col_d + 2 * lip_clr);
    }
}

// corner columns from z0 to z1, a magnet pocket at both ends
module columns(z0, z1) {
    col_xy() difference() {
        translate([0, 0, z0]) cylinder(d = col_d, h = z1 - z0);
        if (magnets) {
            translate([0, 0, z1 - magnet_h]) cylinder(d = magnet_d, h = magnet_h + 1);
            translate([0, 0, z0 - 1]) cylinder(d = magnet_d, h = magnet_h + 1);
        }
    }
}

// a tray: floor at the bottom of the plug, open at the top
module tray(h, passthrough = true) {
    difference() {
        union() {
            translate([0, 0, -lip_h]) linear_extrude(lip_h + 0.01) plug_2d();
            linear_extrude(h) hull_2d(W, D, chamfer);
            collars(h / 2 - collar_h / 2);
        }
        translate([0, 0, -0.01]) linear_extrude(h + 1) cham(inner_w, inner_d, chamfer - wall);
        translate([0, 0, -lip_h + floor_t])
            linear_extrude(lip_h) cham(inner_w - 2 * (wall + lip_clr), inner_d - 2 * (wall + lip_clr), chamfer - 2 * wall);
        if (passthrough) rear_passthrough();
    }
    columns(0, h);
}

module rear_passthrough() {
    translate([0, inner_d / 2 - cable[1] / 2 - wall - 4, -lip_h - 1])
        linear_extrude(floor_t + 2) cham(cable[0], cable[1], 3);
}

module corners(inset) {
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (inner_w / 2 - inset), sy * (inner_d / 2 - inset), 0]) children();
}

// a field of slanted slots cut through a wall that runs along x at y = 0.
// `len` is the wall length, `h` the stage height. Tall stages get several
// rows of slots; the slots lean the same way everywhere and share the same
// pitch, so the pattern reads as one across the stack.
module louvre_field(len, h, edge = louvre_edge, end = louvre_end, bottom = -1) {
    b    = bottom < 0 ? edge : bottom;                     // where the rows start
    hh   = h - b - edge;                                   // vertical room
    rows = max(1, floor((hh + louvre_gap) / (louvre_band + louvre_gap)));
    rh   = (hh - (rows - 1) * louvre_gap) / rows;          // height of one row
    if (rh > 8) {
        run = rh / tan(louvre_angle);                      // horizontal run of one slot
        L   = rh / sin(louvre_angle);                      // slot length
        n   = floor((len - 2 * end - run) / louvre_pitch) + 1;
        if (n > 0)
            for (r = [0 : rows - 1], i = [0 : n - 1])
                translate([-len / 2 + end + run / 2 + i * louvre_pitch, 0, b + r * (rh + louvre_gap) + rh / 2])
                    rotate([0, -(90 - louvre_angle), 0])
                        cube([louvre_w, 20, L], center = true);
    }
}

// louvres on both sides and the back
module louvres(h, bottom = -1, edge = louvre_edge) {
    for (sx = [-1, 1])
        translate([sx * W / 2, 0, 0]) rotate([0, 0, 90]) louvre_field(inner_d, h, edge = edge, bottom = bottom);
    translate([0, D / 2, 0]) louvre_field(inner_w, h, edge = edge, bottom = bottom);
}

// slots through the floor: air intake and drain holes
module floor_vents(n = 9, len = 70) {
    for (i = [0 : n - 1])
        translate([-inner_w / 2 + 22 + i * (inner_w - 44) / (n - 1), 0, -lip_h - 1])
            linear_extrude(floor_t + 2) cham(louvre_w, len, 1);
}

// engraved 45-degree hazard stripes on the front face, `size` = [width, height]
module hazard(x, z, size) {
    translate([x, -D / 2 + 0.7, z]) rotate([90, 0, 0])
        linear_extrude(2) intersection() {
            square(size, center = true);
            for (i = [-12 : 12]) translate([i * 8, 0]) rotate(45) square([3, 60], center = true);
        }
}

// engraved text on the front face
module engrave(txt, x, z, size = 7) {
    translate([x, -D / 2 + 0.7, z]) rotate([90, 0, 0])
        linear_extrude(2) text(txt, size = size, font = font, halign = "center", valign = "center");
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

/* ---------- plating ---------- */
// one tile: a chamfered plate raised by one of three heights; the tall ones
// get a sunken inner panel, the wide low ones a row of ribs, a few a port hole
module tile(x, y, w, h, v) {
    g  = tile_gap;
    lvl = v < 0.35 ? 0.8 : v < 0.8 ? 1.6 : 2.4;
    tw = w - 2 * g; th = h - 2 * g;
    if (tw > 6 && th > 6)
        translate([x + g, y + g, 0]) difference() {
            hull() {
                linear_extrude(lvl - 0.7) square([tw, th]);
                translate([0.7, 0.7, 0]) linear_extrude(lvl) square([tw - 1.4, th - 1.4]);
            }
            if (lvl > 2 && tw > 22 && th > 18)                     // sunken inner panel
                translate([4, 4, lvl - 0.8]) linear_extrude(2) square([tw - 8, th - 8]);
            if (lvl > 1 && lvl < 2 && tw > 34 && th > 12)          // three ribs
                for (i = [1 : 3]) translate([tw * i / 4 - 0.9, 3, lvl - 0.6]) linear_extrude(2) square([1.8, th - 6]);
            if (lvl < 1 && v < 0.12 && tw > 14 && th > 14)         // a port hole
                translate([tw / 2, th / 2, lvl - 0.6]) cylinder(d = 6, h = 2);
        }
}

// split a rectangle into tiles, again and again, from a seed
module tiles(x, y, w, h, seed, depth = 0) {
    r = rands(0, 1, 4, seed);
    can = (w > 2 * tile_min) || (h > 2 * tile_min);
    if (depth < tile_depth && can && (depth < 2 || r[0] < 0.8)) {
        along_w = (w > 2 * tile_min) && (!(h > 2 * tile_min) || (w >= h ? r[1] < 0.75 : r[1] < 0.25));
        f = 0.35 + 0.3 * r[2];
        if (along_w) {
            tiles(x, y, w * f, h, seed * 7 + 1, depth + 1);
            tiles(x + w * f, y, w * (1 - f), h, seed * 7 + 2, depth + 1);
        } else {
            tiles(x, y, w, h * f, seed * 7 + 3, depth + 1);
            tiles(x, y + h * f, w, h * (1 - f), seed * 7 + 4, depth + 1);
        }
    } else tile(x, y, w, h, r[3]);
}

// a plated panel of w x h lying flat, origin at its centre
module plate_panel(w, h, seed) { translate([-w / 2, -h / 2, 0]) tiles(0, 0, w, h, seed); }

// plating on the four faces of a stage of height h; the front panel is cut
// by whatever the stage passes as children (bezel, ports)
module plating(h, seed, front = true) {
    pw = W - 2 * (pipe_d - pipe_out) - 6;    // between the corner columns
    pd = D - 2 * (pipe_d - pipe_out) - 6;
    ph = h - 4;
    for (sx = [-1, 1]) translate([sx * (W / 2 - 0.01), 0, h / 2]) rotate([90, 0, sx * 90]) plate_panel(pd, ph, seed + 1 + sx);
    translate([0, D / 2 - 0.01, h / 2]) rotate([90, 0, 180]) plate_panel(pw, ph, seed + 5);
    if (front) difference() {
        translate([0, -D / 2 + 0.01, h / 2]) rotate([90, 0, 0]) plate_panel(pw, ph, seed + 9);
        children();
    }
}

// two more rings per stage on the corner conduits, and flutes along them
module column_rings(h) {
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (W / 2 - pipe_d / 2 + pipe_out), sy * (D / 2 - pipe_d / 2 + pipe_out), 0])
            for (z = [5, h - 5 - (collar_h - 1)]) translate([0, 0, z]) cylinder(d = collar_d - 1.5, h = collar_h - 1);
}
module column_flutes(h) {
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (W / 2 - pipe_d / 2 + pipe_out), sy * (D / 2 - pipe_d / 2 + pipe_out), 0])
            for (a = [0 : 30 : 359]) rotate(a) translate([pipe_d / 2, 0, -1]) cylinder(d = 1.8, h = h + 2);
}

/* ---------- stages ---------- */
module base() {
    difference() {
        union() {
            tray(base_h, passthrough = false);
            column_rings(base_h);
            plating(base_h, plate_seed)
                for (x = [-inner_w / 2 + 40, -inner_w / 2 + 90]) translate([x, -D / 2, 34]) rotate([90, 0, 0]) cylinder(d = port_d + 16, h = 20, center = true);
        }
        column_flutes(base_h);
        floor_vents();
        louvres(base_h, bottom = 30);
        // two intake ports low on the front, left side
        port(-inner_w / 2 + 40, 34);
        port(-inner_w / 2 + 90, 34);
        // mains cord: dropped in from the top, through the rear wall (right side)
        translate([inner_w / 2 - 40, D / 2, 30 + base_h]) cube([16, wall * 3, 2 * base_h], center = true);
        // ethernet and anything else leaving the tower: rear left
        translate([-inner_w / 2 + 40, D / 2, 30 + base_h]) cube([18, wall * 3, 2 * base_h], center = true);
        // rubber feet
        corners(16) translate([0, 0, -lip_h - 0.01]) cylinder(d = 12, h = 1);
    }
    stops(strip, h = 8);
    conduit_run(16);
    // bezel ring and bolts around each intake port
    for (x = [-inner_w / 2 + 40, -inner_w / 2 + 90]) {
        translate([x, -D / 2 + 0.01, 34]) rotate([90, 0, 0]) difference() { cylinder(d = port_d + 10, h = 2); translate([0, 0, -1]) cylinder(d = port_d + 1, h = 4); }
        for (a = [45 : 90 : 315]) bolt_front(x + (port_d / 2 + 2.5) * cos(a), 34 + (port_d / 2 + 2.5) * sin(a));
    }
}

// an empty stage: slip one under any stage that needs more height
module riser() {
    difference() {
        union() { tray(riser_h); column_rings(riser_h); plating(riser_h, plate_seed + 20); }
        column_flutes(riser_h);
        louvres(riser_h);
    }
}

module hub_stage() {
    difference() {
        union() { tray(hub_h); column_rings(hub_h); plating(hub_h, plate_seed + 40); }
        column_flutes(hub_h);
        louvres(hub_h);
        // the 7 USB ports face the rear
        translate([0, D / 2, hub[2] / 2 + 4]) cube([hub[0] + 2, wall * 3, hub[2] - 2], center = true);
    }
    stops(hub, at = [0, inner_d / 2 - hub[1] / 2 - 3], h = 5);
}

module compute() {
    win   = [screen[0] - 2 * screen_lip, screen[1] - 2 * screen_lip];
    zc    = compute_h / 2;               // screen centred on the front face
    pi_at = [inner_w / 2 - pi[0] / 2 - 6, inner_d / 2 - pi[1] / 2 - 3];  // right-rear, ports facing inwards
    bez   = [screen[0] + 16, screen[1] + 16];   // raised bezel, 3 mm proud, two corners cut
    difference() {
        union() {
            tray(compute_h);
            column_rings(compute_h);
            plating(compute_h, plate_seed + 60)
                translate([0, -D / 2, zc]) cube([bez[0] + 8, 20, bez[1] + 8], center = true);
            // thicker front plate so the frame can sit in a pocket
            translate([0, -inner_d / 2 + screen_t / 2 + 0.5, zc])
                cube([screen[0] + 24, screen_t + 1, screen[1] + 16], center = true);
            // bezel
            translate([0, -D / 2, zc]) rotate([90, 0, 0]) difference() {
                linear_extrude(3) cham(bez[0], bez[1], 4);
                for (s = [-1, 1]) translate([s * bez[0] / 2, s * bez[1] / 2, -1]) rotate(45) cube([18, 18, 6], center = true);
            }
        }
        column_flutes(compute_h);
        louvres(compute_h, edge = 22, bottom = 8);
        // pocket from the outside, then the window through
        translate([0, -D / 2 - 3, zc]) cube([screen[0] + 0.6, 2 * (3 + screen_t + 0.5), screen[1] + 0.6], center = true);
        translate([0, -D / 2, zc]) cube([win[0], 40, win[1]], center = true);
    }
    conduit_run(compute_h - 12);
    for (sx = [-1, 1], sz = [-1, 1]) translate([0, -3, 0]) bolt_front(sx * (bez[0] / 2 - 14), zc + sz * (bez[1] / 2 - 4.5));
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
        union() { tray(disk_h); column_rings(disk_h); plating(disk_h, plate_seed + 80); }
        column_flutes(disk_h);
        louvres(disk_h);
    }
    stops(disk_bay, at = [-inner_w / 2 + disk_bay[0] / 2 + 6, 0], h = 6);
}

module lid() {
    difference() {
        union() {
            translate([0, 0, -lip_h]) linear_extrude(lip_h + 0.01) plug_2d();
            linear_extrude(lid_h) hull_2d(W, D, chamfer);
            // exhaust stack, with a stepped foot and two housing rings around it
            translate([0, 0, lid_h - 0.01]) cylinder(d = stack_d, h = stack_h);
            translate([0, 0, lid_h - 0.01]) cylinder(d = stack_d + 10, h = 4);
            for (d = [stack_d + 22, stack_d + 36]) translate([0, 0, lid_h - 0.01]) difference() { cylinder(d = d, h = 1.5); translate([0, 0, -1]) cylinder(d = d - 4, h = 4); }
            // a second, smaller stack at the rear left: a passive vent
            translate([-inner_w / 2 + 42, 14, lid_h - 0.01]) { cylinder(d = 30, h = stack_h - 4); cylinder(d = 38, h = 3); }
        }
        // the stacks are tubes, open through the lid
        translate([0, 0, lid_h - floor_t - 1]) cylinder(d = stack_d - 2 * wall, h = stack_h + floor_t + 2);
        translate([-inner_w / 2 + 42, 14, lid_h - floor_t - 1]) cylinder(d = 30 - 2 * wall, h = stack_h + floor_t + 2);
        // hollow underneath, the fan hangs from the top plate
        translate([0, 0, -lip_h - 1])
            linear_extrude(lip_h + lid_h - floor_t + 1)
                cham(inner_w - 2 * (wall + lip_clr), inner_d - 2 * (wall + lip_clr), chamfer - 2 * wall);
        // passive louvres on the right of the stack
        intersection() {
            translate([inner_w / 2 - 36, 0, lid_h - floor_t - 1]) linear_extrude(floor_t + 2) cham(40, inner_d - 34, 4);
            for (i = [-16 : 16])
                translate([i * louvre_pitch, 0, lid_h - floor_t - 1]) rotate(30)
                    linear_extrude(floor_t + 2) square([louvre_w, 300], center = true);
        }
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * fan_holes / 2, sy * fan_holes / 2, lid_h - floor_t - 1]) cylinder(d = fan_hole_d, h = floor_t + 2);
    }
    columns(0, lid_h - floor_t + 0.01);
    // radial fins and a hub close the stacks: the grilles over the openings
    translate([0, 0, lid_h - floor_t]) {
        for (a = [0 : 30 : 359]) rotate(a) translate([stack_d / 2 - wall - 20, -1, 0]) cube([20.5, 2, stack_h + floor_t - 3]);
        difference() { cylinder(d = 18, h = stack_h + floor_t - 3); translate([0, 0, 1.5]) cylinder(d = 14, h = 20); }
    }
    translate([-inner_w / 2 + 42, 14, lid_h - floor_t]) {
        for (a = [0 : 45 : 359]) rotate(a) translate([15 - wall - 9, -0.8, 0]) cube([9.5, 1.6, stack_h + floor_t - 6]);
        cylinder(d = 7, h = stack_h + floor_t - 6);
    }
    // bolts around the stack foot
    for (a = [0 : 60 : 359]) bolt_top((stack_d / 2 + 5 + 3) * cos(a), (stack_d / 2 + 8) * sin(a), lid_h + 4);
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
    z1 = base_h + g;
    z2 = z1 + hub_h + g;
    z3 = z2 + compute_h + g;
    z4 = z3 + disk_h + g;
    z5 = z4 + disk_h + g;
    color("#9a9aa3") {
        base();
        translate([0, 0, z1]) hub_stage();
        translate([0, 0, z2]) compute();
        translate([0, 0, z3]) disk();
        translate([0, 0, z4]) disk();
        translate([0, 0, z5]) lid();
    }
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
if (part == "riser")       riser();
if (part == "hub")         hub_stage();
if (part == "compute")     compute();
if (part == "disk")        disk();
if (part == "lid")         lid();
if (part == "screen_clip") screen_clip();
