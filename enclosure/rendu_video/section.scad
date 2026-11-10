// Section of the compute's front at x = 0, near the top edge of the screen:
// the screen goes into its pocket from the front and stops on the inner lip.
include <../tower.scad>
part = "none";
t = 0;
s = t <= 0.15 ? 0 : t >= 0.75 ? 1 : let(u = (t - 0.15) / 0.6) u * u * (3 - 2 * u);
zc = compute_h / 2;
module sl() projection(cut = true) rotate([0, 90, 0]) children();
color([0.30, 0.30, 0.34]) linear_extrude(1) sl() compute();
color([0.20, 0.50, 0.95]) translate([0, -(1 - s) * 30, 2]) linear_extrude(1) sl() translate([-screen[0] / 2, -D / 2 + 4.5 - screen_t, zc - screen[1] / 2]) cube([screen[0], screen_t, screen[1]]);
color([0.95, 0.50, 0.10]) translate([0, 0, 3]) linear_extrude(1) sl() translate([0, -inner_d / 2 + screen_t + 1 + 8 + 1.5, zc + screen[1] / 2 + 6]) rotate([90, 0, 0]) screen_clip();
// x' = z after the rotation: labels placed in that frame
color("black") translate([0, 0, 5]) linear_extrude(1) {
    translate([100, -60]) text("AVANT", size = 1.8, font = "Liberation Sans:style=Bold", halign = "center");
    translate([100, -31]) text("INTÉRIEUR", size = 1.8, font = "Liberation Sans:style=Bold", halign = "center");
    translate([108.5, -46.9]) text("lèvre (3 mm sur le cadre) →", size = 1.1, halign = "right");
    translate([117, -32]) text("barrette screen_clip", size = 1.2, halign = "center");
}
color("white") translate([0, -(1 - s) * 30, 6]) linear_extrude(1) translate([100, -50.1]) text("écran (cadre 4 mm)", size = 1.2, halign = "center");
