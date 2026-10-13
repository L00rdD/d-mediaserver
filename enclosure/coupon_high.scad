// Test coupon 2: the HIGHEST corner of the print-oriented disk stage, the one
// that stands 42 mm above the plate on the tallest supports (the first print
// tore off there). Workshop drops every model to the plate when it generates
// supports, so a 4 mm pin standing on the plate beside the corner pins the STL
// at its real height: the corner stays 26 mm up and gets supports as tall as on
// the real stage. The pin prints on its own, no supports needed.
intersection() {
    import("stl/print/disk.stl");
    translate([-100, -62, -1]) cube([58, 62, 100]);
}
translate([-32, -34, 0]) cube([4, 4, 10]);
