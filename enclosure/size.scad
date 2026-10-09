// Size reference: the tower stacked as it will stand, next to the Noctua
// 40 mm fan and a 33 cl can, with its height and width marked.
//
//   openscad --render -o renders/size.png --imgsize=1400,1200 size.scad
include <tower.scad>
part    = "none";
explode = 0;

total_h = base_h + hub_h + compute_h + 2 * disk_h + lid_h + roof_h + stack_h + 2;
ink = "#d8d8d8";

module label(s, size = 9) { color(ink) rotate([90, 0, 0]) linear_extrude(0.5) text(s, size = size, halign = "center", valign = "center"); }

// vertical dimension line on the left of the tower
module height_mark(x, h) {
    color(ink) {
        translate([x, -D / 2, 0]) cube([1.2, 1, h]);
        for (z = [0, h - 1.2]) translate([x - 6, -D / 2, z]) cube([13.2, 1, 1.2]);
    }
    translate([x - 22, -D / 2, h / 2]) rotate([0, -90, 0]) label(str(round(h / 10), " cm"), 11);
}

assembly();

// the Noctua NF-A4x10: 40 x 40 x 10 mm, beige frame, brown blades
translate([W / 2 + 45, -D / 2 + 10, 0]) {
    color("#d9c7a7") difference() {
        cube([40, 10, 40]);
        translate([20, -1, 20]) rotate([-90, 0, 0]) cylinder(d = 37, h = 12);
    }
    color("#7a4b36") translate([20, 5, 20]) rotate([-90, 0, 0]) {
        cylinder(d = 14, h = 6, center = true);
        for (a = [0 : 360 / 9 : 359]) rotate(a) translate([8, -2.5, -2]) cube([10, 5, 4]);
    }
    translate([20, 0, -12]) label("Noctua 40 mm", 6);
}

// a 33 cl can, 66 x 115 mm
translate([W / 2 + 130, -D / 2 + 33, 0]) {
    color("#b0302c") cylinder(d = 66, h = 115);
    color("#c8c8c8") translate([0, 0, 115]) cylinder(d1 = 66, d2 = 56, h = 6);
    translate([0, -34, -12]) label("canette 33 cl", 6);
}

height_mark(-W / 2 - 25, total_h);
color(ink) translate([0, -D / 2 - 30, 0]) linear_extrude(0.5) text(str(round(W) / 10, " x ", round(D) / 10, " cm au sol"), size = 10, halign = "center", valign = "center");
color("#3a3a40") translate([-W / 2 - 80, -D / 2 - 60, -2]) cube([W + 330, D + 120, 2]);
