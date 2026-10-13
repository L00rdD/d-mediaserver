// Test coupon 3: the HIGHEST corner of the print-oriented lid, roof down. The
// top of the eave hangs 50 mm above the plate there, higher than the 40 mm the
// disk coupon proved, and the roof and the stack are too tall to bring it lower.
// Like coupon 2, a 4 mm pin standing on the plate beside it keeps Workshop from
// dropping the corner to the plate: it stays 19 mm up, so the supports are as
// tall as on the real lid. The pin prints on its own, no supports needed.
intersection() {
    import("stl/print/lid.stl");
    translate([-100, 0, -1]) cube([56, 60, 100]);
}
translate([-60, -10, 0]) cube([4, 4, 10]);
