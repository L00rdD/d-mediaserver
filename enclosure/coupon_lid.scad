// Test coupon 3: the HIGHEST corner of the print-oriented lid, roof down.
// Since 2026-10-31 the lid is hollow and leans 25 degrees along the plate
// (orient.py, FIXED): its corner starts 39 mm above the plate and the top of
// the eave hangs about 82 mm up, twice the 40 mm the disk coupon proved.
// Like coupon 2, a 4 mm pin standing on the plate beside it keeps Workshop from
// dropping the corner to the plate, so the supports are as tall as on the real
// lid. The pin prints on its own, no supports needed.
intersection() {
    import("stl/print/lid.stl");
    translate([-100, 0, -1]) cube([53, 60, 120]);
}
translate([-60, -10, 0]) cube([4, 4, 10]);
