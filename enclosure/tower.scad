// Mediaserver tower: a stackable enclosure for the Pi, its hub, its disks,
// a 5" screen and the power strip, printed in resin (Anycubic Photon Mono M7,
// plate 223 x 126 x 230 mm). Every stage is a tray with a plug underneath that
// drops into the stage below; magnets in the corners keep the stack together.
//
// Look: a lantern pagoda for a living room of katanas and dragons. Every
// stage has latticed windows (asanoha, the hemp-leaf lattice) on its sides
// and its back, cut right through the wall so the tower breathes through
// them; a meander (key fret) band runs along the top and the bottom of every
// stage, the solid fields carry seigaiha waves in relief, lacquered corner
// posts wear three bronze rings per stage, and the lid is a pagoda roof with
// an eave, a ridge and the two exhaust stacks rising from it like finials.
// Two round moon windows with ring grilles feed the base.
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

/* ---------- ornament ---------- */
band_h      = 6;              // meander band height
band_t      = 0.9;            // relief of the ornament
key_p       = 8;              // meander period
lat_pitch   = 9;              // lattice pitch
lat_w       = 1.6;            // lattice bar width
wave_p      = 11;             // seigaiha scale pitch
frame_w     = 3;              // raised frame around each window
roof_h      = 12;             // pagoda roof rise
eave        = 5;              // roof overhang

/* ---------- colours, for the renders only ---------- */
c_body = "#26262b";   // anthracite resin
c_trim = "#b8955a";   // bronze dry-brushed on the reliefs

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
    color(c_trim) for (sx = [-1, 1], sy = [-1, 1])
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
    color(c_body) translate([x, -D / 2, z]) rotate([90, 0, 0]) {
        translate([0, 0, -2]) cylinder(d = port_d, h = 3);                       // recess
        for (r = [7, 12.5, 18]) translate([0, 0, -wall - 3])
            linear_extrude(wall + 5) difference() {
                circle(r = r + 1.1); circle(r = r - 1.1);
                for (a = [45, 135]) rotate(a) square([2.4, 2 * port_d], center = true);   // spokes hold the rings
            }
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

// corner columns from z0 to z1
module columns(z0, z1) {
    col_xy() translate([0, 0, z0]) cylinder(d = col_d, h = z1 - z0);
}

// magnet pockets at the ends of the columns, cut from the whole stage
// (the column is half sunk in the wall, so a pocket cut from the column alone
// would leave a crescent of wall inside it)
module pockets(z0, z1, top = true) {
    if (magnets) col_xy() {
        if (top) translate([0, 0, z1 - magnet_h]) cylinder(d = magnet_d, h = magnet_h + 1);
        translate([0, 0, z0 - 1]) cylinder(d = magnet_d, h = magnet_h + 1);
    }
}

// a tray: floor at the bottom of the plug, open at the top. The plug sits
// inside the footprint of the cavity above it, so a ring `tie_h` tall at the
// foot of the walls joins the walls to the plug and the floor.
tie_h = 1.5;
module tray(h, passthrough = true) {
    difference() {
        union() {
            difference() {
                union() {
                    translate([0, 0, -lip_h]) linear_extrude(lip_h + 0.01) plug_2d();
                    linear_extrude(h) hull_2d(W, D, chamfer);
                    collars(h / 2 - collar_h / 2);
                }
                color(c_body) translate([0, 0, tie_h]) linear_extrude(h + 1) cham(inner_w, inner_d, chamfer - wall);
                color(c_body) translate([0, 0, -lip_h + floor_t])
                    linear_extrude(lip_h) cham(inner_w - 2 * (wall + lip_clr), inner_d - 2 * (wall + lip_clr), chamfer - 2 * wall);
                if (passthrough) rear_passthrough();
            }
            columns(0, h);
        }
        pockets(0, h);
    }
}

module rear_passthrough() {
    color(c_body) translate([0, inner_d / 2 - cable[1] / 2 - wall - 4, -lip_h - 1])
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
    color(c_body) for (i = [0 : n - 1])
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

/* ---------- ornament, all 2D patterns lie in XY with the origin at their centre ---------- */
// key fret (meander) band, len x h
module meander2d(len, h) {
    t = h / 5;
    n = ceil(len / key_p) + 1;
    intersection() {
        square([len, h], center = true);
        translate([-len / 2, -h / 2]) for (i = [0 : n - 1]) translate([i * key_p, 0]) {
            square([t, h]);                                   // riser
            translate([0, h - t]) square([key_p * 0.75, t]);  // top run
            translate([key_p * 0.75 - t, h * 0.4]) square([t, h * 0.6]);
            translate([key_p * 0.3, h * 0.4]) square([key_p * 0.45, t]);
            translate([key_p * 0.3, 0]) square([t, h * 0.4 + t]);
            translate([key_p * 0.3, 0]) square([key_p * 0.7, t]);   // bottom run
        }
    }
}

// asanoha lattice: the openings between bars running at 0, 60 and 120 degrees
module lattice2d(w, h) {
    difference() {
        square([w, h], center = true);
        for (a = [0, 60, 120]) rotate(a) for (i = [-30 : 30]) translate([0, i * lat_pitch]) square([3 * (w + h), lat_w], center = true);
    }
}

// seigaiha: overlapping scales of three rings, clipped to w x h
module waves2d(w, h) {
    intersection() {
        square([w, h], center = true);
        for (j = [-ceil(h / wave_p / 2) - 1 : ceil(h / wave_p / 2) + 1], i = [-ceil(w / wave_p) - 1 : ceil(w / wave_p) + 1])
            translate([i * wave_p + (j % 2 == 0 ? 0 : wave_p / 2), j * wave_p * 0.5])
                for (r = [wave_p / 2, wave_p / 2 - 2.2, wave_p / 2 - 4.4]) if (r > 0.8) difference() { circle(r = r); circle(r = r - 1); }
    }
}

// place a 2D pattern on a face: side = "L", "R", "B" (back), "F" (front),
// at height z (centre), extruded outwards by `t` (positive) or cut inwards
module on_face(side, u, z, t) {
    if (side == "F") translate([u, -D / 2 + 0.01, z]) rotate([90, 0, 0]) linear_extrude(t) children();
    if (side == "B") translate([u, D / 2 - 0.01, z]) rotate([90, 0, 180]) linear_extrude(t) children();
    if (side == "L") translate([-W / 2 + 0.01, u, z]) rotate([90, 0, -90]) linear_extrude(t) children();
    if (side == "R") translate([W / 2 - 0.01, u, z]) rotate([90, 0, 90]) linear_extrude(t) children();
}
// the same, but cutting through the wall
module through_face(side, u, z) {
    d = wall * 3 + 8;
    color(c_body) union() {
    if (side == "F") translate([u, -D / 2 + d / 2, z]) rotate([90, 0, 0]) linear_extrude(d) children();
    if (side == "B") translate([u, D / 2 - d / 2, z]) rotate([90, 0, 180]) linear_extrude(d) children();
    if (side == "L") translate([-W / 2 + d / 2, u, z]) rotate([90, 0, -90]) linear_extrude(d) children();
    if (side == "R") translate([W / 2 - d / 2, u, z]) rotate([90, 0, 90]) linear_extrude(d) children();
    }
}

face_w = W - 2 * (pipe_d - pipe_out) - 4;   // usable width of the front and the back, between the posts
face_d = D - 2 * (pipe_d - pipe_out) - 4;   // usable width of a side

// meander bands along the top and the bottom of a stage, on all four faces
// short stages (under 40 mm) only get the top band, to leave room for a window
module bands(h, front = true) {
    color(c_trim) for (z = h < 40 ? [h - 3 - band_h / 2] : [3 + band_h / 2, h - 3 - band_h / 2]) {
        for (sd = ["L", "R"]) on_face(sd, 0, z, band_t) meander2d(face_d, band_h);
        on_face("B", 0, z, band_t) meander2d(face_w, band_h);
        if (front) on_face("F", 0, z, band_t) meander2d(face_w, band_h);
    }
}

// a latticed window with its raised frame; `cut` = true gives the openings
module window(side, u, z, w, h, cut = false) {
    if (cut) through_face(side, u, z) lattice2d(w, h);
    else color(c_trim) on_face(side, u, z, 1.5) difference() { square([w + 2 * frame_w, h + 2 * frame_w], center = true); square([w, h], center = true); }
}

// windows on both sides and the back of a stage, sized to what is left
// between the bands; short stages get a single row of lattice
module windows(h, cut = false) {
    zb = h < 40 ? 3 : 3 + band_h;                 // below the window
    zt = h - 3 - band_h;                           // above it
    wh = zt - zb - 2 * frame_w - 2;
    zc = (zt + zb) / 2;
    if (wh >= 8) {
        for (sd = ["L", "R"]) window(sd, 0, zc, face_d - 22, wh, cut);
        window("B", 0, zc, face_w - 22, wh, cut);
    }
}

// the centre and height of the solid field on the front of a short stage
function field_z(h) = h < 40 ? (h - 3 - band_h + 3) / 2 : h / 2;
function field_h(h) = h < 40 ? h - 3 - band_h - 3 - 4 : h - 2 * (3 + band_h) - 4;

// three rings per stage on the corner posts
module post_rings(h) {
    color(c_trim) for (sx = [-1, 1], sy = [-1, 1])
        translate([sx * (W / 2 - pipe_d / 2 + pipe_out), sy * (D / 2 - pipe_d / 2 + pipe_out), 0])
            for (z = [4, h - 4 - (collar_h - 1)]) translate([0, 0, z]) cylinder(d = collar_d - 1, h = collar_h - 1);
}

/* ---------- stages ---------- */
module base() {
    difference() {
        union() {
            color(c_body) tray(base_h, passthrough = false);
            post_rings(base_h);
            bands(base_h);
            windows(base_h);
            // waves on the front, around the moon windows
            color(c_body) on_face("F", 0, base_h / 2, band_t) difference() {
                square([face_w, base_h - 2 * (3 + band_h) - 4], center = true);
                for (x = [-inner_w / 2 + 40, -inner_w / 2 + 90]) translate([x, 34 - base_h / 2]) circle(d = port_d + 12);
            }
            color(c_trim) on_face("F", 0, base_h / 2, band_t * 2) intersection() {
                waves2d(face_w - 4, base_h - 2 * (3 + band_h) - 8);
                difference() { square([face_w, base_h], center = true); for (x = [-inner_w / 2 + 40, -inner_w / 2 + 90]) translate([x, 34 - base_h / 2]) circle(d = port_d + 12); }
            }
        }
        windows(base_h, cut = true);
        floor_vents();
        // two intake ports low on the front, left side
        port(-inner_w / 2 + 40, 34);
        port(-inner_w / 2 + 90, 34);
        // mains cord: dropped in from the top, through the rear wall (right side)
        color(c_body) translate([inner_w / 2 - 40, D / 2, 30 + base_h]) cube([16, wall * 3, 2 * base_h], center = true);
        // ethernet and anything else leaving the tower: rear left
        color(c_body) translate([-inner_w / 2 + 40, D / 2, 30 + base_h]) cube([18, wall * 3, 2 * base_h], center = true);
        // rubber feet
        corners(16) translate([0, 0, -lip_h - 0.01]) cylinder(d = 12, h = 1);
    }
    color(c_body) stops(strip, h = 8);
    color(c_body) conduit_run(16);
    // a ring around each moon window
    color(c_trim) for (x = [-inner_w / 2 + 40, -inner_w / 2 + 90])
        translate([x, -D / 2 + 0.01, 34]) rotate([90, 0, 0]) difference() { cylinder(d = port_d + 10, h = 2.4); translate([0, 0, -1]) cylinder(d = port_d + 1, h = 5); }
}

// an empty stage: slip one under any stage that needs more height
module riser() {
    difference() {
        union() { color(c_body) tray(riser_h); post_rings(riser_h); bands(riser_h); windows(riser_h); color(c_trim) on_face("F", 0, field_z(riser_h), band_t * 2) waves2d(face_w - 4, field_h(riser_h)); }
        windows(riser_h, cut = true);
    }
}

module hub_stage() {
    difference() {
        union() { color(c_body) tray(hub_h); post_rings(hub_h); bands(hub_h); windows(hub_h); color(c_trim) on_face("F", 0, field_z(hub_h), band_t * 2) waves2d(face_w - 4, field_h(hub_h)); }
        windows(hub_h, cut = true);
        // the 7 USB ports face the rear
        color(c_body) translate([0, D / 2, hub[2] / 2 + 4]) cube([hub[0] + 2, wall * 3, hub[2] - 2], center = true);
    }
    color(c_body) stops(hub, at = [0, inner_d / 2 - hub[1] / 2 - 3], h = 5);
}

module compute() {
    win   = [screen[0] - 2 * screen_lip, screen[1] - 2 * screen_lip];
    zc    = compute_h / 2;               // screen centred on the front face
    pi_at = [inner_w / 2 - pi[0] / 2 - 6, inner_d / 2 - pi[1] / 2 - 3];  // right-rear, ports facing inwards
    bez   = [screen[0] + 16, screen[1] + 16];   // raised bezel, 3 mm proud, two corners cut
    difference() {
        union() {
            color(c_body) tray(compute_h);
            post_rings(compute_h);
            bands(compute_h);
            windows(compute_h);
            // waves above and below the screen
            for (sz = [-1, 1]) {
                fh = (compute_h - bez[1]) / 2 - (3 + band_h) - 6;
                if (fh > 6) color(c_trim) on_face("F", 0, zc + sz * (bez[1] / 2 + 3 + fh / 2), band_t * 2) waves2d(face_w - 4, fh);
            }
            // thicker front plate so the frame can sit in a pocket
            color(c_body) translate([0, -inner_d / 2 + screen_t / 2 + 0.5, zc])
                cube([screen[0] + 30, screen_t + 1, screen[1] + 16], center = true);   // wide enough to meet the corner columns
            // bezel
            color(c_trim) translate([0, -D / 2, zc]) rotate([90, 0, 0]) difference() {
                linear_extrude(3) cham(bez[0], bez[1], 4);
                for (s = [-1, 1]) translate([s * bez[0] / 2, s * bez[1] / 2, -1]) rotate(45) cube([18, 18, 6], center = true);
            }
        }
        windows(compute_h, cut = true);
        // pocket from the outside, then the window through
        color(c_body) translate([0, -D / 2 - 3, zc]) cube([screen[0] + 0.6, 2 * (3 + screen_t + 0.5), screen[1] + 0.6], center = true);
        color(c_body) translate([0, -D / 2, zc]) cube([win[0], 40, win[1]], center = true);
    }
    color(c_body) conduit_run(compute_h - 12);
    // the frame is held from the inside by two clip bars screwed on these bosses
    color(c_body) for (sx = [-1, 1], sz = [-1, 1])
        translate([sx * (screen[0] / 2 + 6), -inner_d / 2 + screen_t + 1, zc + sz * (screen[1] / 2 + 6)])
            rotate([-90, 0, 0]) difference() { cylinder(d = 7, h = 8); cylinder(d = 2.4, h = 9); }
    // Pi standoffs; the USB and ethernet ports face the middle of the stage,
    // every cable stays inside and goes down through the rear pass-through
    color(c_body) translate([pi_at[0], pi_at[1], -lip_h + floor_t - 0.01])
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * pi_holes[0] / 2, sy * pi_holes[1] / 2, 0])
                difference() { cylinder(d = 6, h = pi_stand_h); cylinder(d = 2.4, h = pi_stand_h + 1); }
}

module disk() {
    difference() {
        union() { color(c_body) tray(disk_h); post_rings(disk_h); bands(disk_h); windows(disk_h); color(c_trim) on_face("F", 0, field_z(disk_h), band_t * 2) waves2d(face_w - 4, field_h(disk_h)); }
        windows(disk_h, cut = true);
    }
    color(c_body) stops(disk_bay, at = [-inner_w / 2 + disk_bay[0] / 2 + 6, 0], h = 6);
}

module lid() {
    sx2 = -inner_w / 2 + 42; sy2 = 14;          // the small stack
    top = lid_h + roof_h;                        // roof ridge height
    difference() {
        union() {
            color(c_body) translate([0, 0, -lip_h]) linear_extrude(lip_h + 0.01) plug_2d();
            color(c_body) linear_extrude(lid_h) hull_2d(W, D, chamfer);
            // one meander band around the lid
            color(c_trim) for (sd = ["L", "R"]) on_face(sd, 0, lid_h / 2, band_t) meander2d(face_d, band_h);
            color(c_trim) for (sd = ["F", "B"]) on_face(sd, 0, lid_h / 2, band_t) meander2d(face_w, band_h);
            // the eave, then the roof rising to a ridge
            color(c_body) translate([0, 0, lid_h - 3]) linear_extrude(3) cham(W + 2 * eave, D + 2 * eave, chamfer + eave);
            color(c_body) hull() {
                translate([0, 0, lid_h - 0.01]) linear_extrude(0.02) cham(W + 2 * eave - 4, D + 2 * eave - 4, chamfer + eave);
                translate([0, 0, top - 0.01]) linear_extrude(0.02) cham(W - 70, 14, 4);
            }
            color(c_trim) translate([0, 0, top - 0.01]) linear_extrude(3) cham(W - 60, 8, 2);   // ridge
            // the exhaust stack rises from the roof like a finial, in three tiers
            color(c_body) translate([0, 0, lid_h]) cylinder(d = stack_d + 12, h = roof_h + 3);
            color(c_trim) translate([0, 0, lid_h]) cylinder(d = stack_d + 4, h = roof_h + 6);
            color(c_body) translate([0, 0, lid_h]) cylinder(d = stack_d, h = roof_h + stack_h + 2);
            color(c_trim) translate([0, 0, top + stack_h - 1]) cylinder(d = stack_d + 6, h = 3);
            // a second, smaller stack: a passive vent
            color(c_body) translate([sx2, sy2, lid_h]) cylinder(d = 30, h = roof_h + stack_h - 4);
            color(c_trim) translate([sx2, sy2, lid_h]) cylinder(d = 38, h = roof_h - 2);
        }
        // the stacks are tubes, open through the roof and the plate
        color(c_body) translate([0, 0, lid_h - floor_t - 1]) cylinder(d = stack_d - 2 * wall, h = roof_h + stack_h + floor_t + 6);
        color(c_body) translate([sx2, sy2, lid_h - floor_t - 1]) cylinder(d = 30 - 2 * wall, h = roof_h + stack_h + floor_t + 2);
        // hollow underneath, the fan hangs from the top plate
        color(c_body) translate([0, 0, -lip_h - 1])
            linear_extrude(lip_h + lid_h - floor_t + 1)
                cham(inner_w - 2 * (wall + lip_clr), inner_d - 2 * (wall + lip_clr), chamfer - 2 * wall);
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx * fan_holes / 2, sy * fan_holes / 2, lid_h - floor_t - 1]) cylinder(d = fan_hole_d, h = floor_t + 2);
        pockets(0, lid_h, top = false);
    }
    color(c_body) difference() { columns(0, lid_h - floor_t + 0.01); pockets(0, lid_h, top = false); }
    // radial fins and a hub close the stacks: the grilles over the openings
    color(c_trim) translate([0, 0, lid_h - floor_t]) {
        for (a = [0 : 30 : 359]) rotate(a) translate([8, -1, 0]) cube([stack_d / 2 - wall - 8 + 0.5, 2, roof_h + stack_h + floor_t - 1]);   // from the hub into the tube wall
        difference() { cylinder(d = 18, h = roof_h + stack_h + floor_t - 1); translate([0, 0, 1.5]) cylinder(d = 14, h = 40); }
    }
    color(c_trim) translate([sx2, sy2, lid_h - floor_t]) {
        for (a = [0 : 45 : 359]) rotate(a) translate([3, -0.8, 0]) cube([15 - wall - 3 + 0.5, 1.6, roof_h + stack_h + floor_t - 6]);
        cylinder(d = 7, h = roof_h + stack_h + floor_t - 6);
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
    z1 = base_h + g;
    z2 = z1 + hub_h + g;
    z3 = z2 + compute_h + g;
    z4 = z3 + disk_h + g;
    z5 = z4 + disk_h + g;
    {
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
