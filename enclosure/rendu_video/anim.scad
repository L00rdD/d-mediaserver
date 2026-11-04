// Assembly animation of the tower: the stages stack one after another and the
// screen goes into its pocket from the front. Parts are imported from ../stl.
include <../tower.scad>
part = "none";
t = 0;
function seg(a, b) = t <= a ? 0 : t >= b ? 1 : let(u = (t - a) / (b - a)) u * u * (3 - 2 * u);
function drop(a, b, h = 140) = (1 - seg(a, b)) * h;
function shown(a) = t >= a;
z1 = base_h; z2 = z1 + hub_h; z3 = z2 + compute_h; z4 = z3 + disk_h; z5 = z4 + disk_h;
body = [0.34, 0.33, 0.36];
module stl(n) import(str("../stl/", n, ".stl"));
// base and what it holds
color(body) stl("base");
color([0.85, 0.85, 0.80]) translate([-strip[0] / 2, -strip[1] / 2, -lip_h + floor_t]) cube(strip);
color([0.95, 0.95, 0.95]) for (x = [-50, 10]) translate([x, -15, -lip_h + floor_t + strip[2]]) cube([40, 30, 60]);
// hub
if (shown(0.10)) translate([0, 0, z1 + drop(0.10, 0.22)]) {
    color(body) stl("hub");
    color([0.55, 0.55, 0.60]) translate([-hub[0] / 2, inner_d / 2 - hub[1] - 3, -lip_h + floor_t]) cube(hub);
}
// compute, its Pi
if (shown(0.22)) translate([0, 0, z2 + drop(0.22, 0.34)]) {
    color(body) stl("compute");
    color([0.10, 0.55, 0.25]) translate([-inner_w / 2 + 6, inner_d / 2 - pi[1] - 9, -lip_h + floor_t + pi_stand_h]) cube([pi[0], pi[1], 1.6]);
}
// screen, from the front into its pocket
if (shown(0.34)) translate([0, -(1 - seg(0.34, 0.50)) * 90, z2]) {
    color([0.05, 0.05, 0.07]) translate([-screen[0] / 2, -D / 2 + 4.5 - screen_t, compute_h / 2 - screen[1] / 2]) cube([screen[0], screen_t, screen[1]]);
    color([0.25, 0.55, 0.95]) translate([-screen[0] / 2 + 6, -D / 2 + 4.5 - screen_t - 0.2, compute_h / 2 - screen[1] / 2 + 6]) cube([screen[0] - 12, 0.3, screen[1] - 12]);
}
// two disk stages with their drive
for (k = [0, 1]) if (shown(0.50 + k * 0.10)) translate([0, 0, (k == 0 ? z3 : z4) + drop(0.50 + k * 0.10, 0.60 + k * 0.10)]) {
    color(body) stl("disk");
    color([0.75, 0.75, 0.78]) translate([-inner_w / 2 + disk_x + 4, -disk_bay[1] / 2 + 4, -lip_h + floor_t]) cube([111, 82, 18]);
}
// lid
if (shown(0.70)) translate([0, 0, z5 + drop(0.70, 0.82)]) color(body) stl("lid");
