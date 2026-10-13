// Test coupon 1: the lowest corner of the print-oriented disk stage, same tilt,
// floor lattice, one column, two decorated walls. Print it with the supports and
// exposure meant for the full stage.
intersection() {
    import("stl/print/disk.stl");
    translate([30, -2, -1]) cube([72, 64, 25]);
}
