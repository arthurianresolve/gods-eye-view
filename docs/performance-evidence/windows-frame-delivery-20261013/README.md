# Windows frame delivery: 13 October 2026

The existing local WebGL diagnostic completed its five-second run through the
user's Chrome UI at 13:12:05 UTC. The [downloaded report](webgl-frame-delivery.json)
is preserved byte-for-byte: 4,808 bytes, SHA-256
`a926c6dab7bb27f2aff018d225eb08ad42164afed44525ba1e90c5f1e2b201da`.

The page reports app and harness identity
`a92c69217e95c3a61d74d81c9e8f4274b14c7f1d`, Windows Chrome 154.0.0.0, and
ANGLE Intel UHD Graphics 620 using Direct3D 11. This is the existing diagnostic
build, not the current QA candidate or a full-application build validation.

With 5,000 static cyan points, antialiasing and drawing-buffer preservation on,
the 640 x 360 WebGL canvas delivers 301 frames in 5,002.3 ms. Maximum frame gap
is 20.4 ms. No context loss, focus change or visibility change is recorded.
The viewport is 874 x 529; the canvas remains entirely within it.

Page focus and visibility are reported, but desktop foreground/occlusion
verification remains unavailable. The report download completed; the browser
control connection detached while waiting for the download notification, so a
post-run screenshot could not be captured. The downloaded JSON agrees with the
completed report displayed in the page before detachment.

This is short scheduling/component evidence only. It does not establish the
cause of earlier stalls, current application frame-capture correctness, matched
performance improvement, retained-heap stability or a 60-minute hardware soak.
Historical failures are retained independently.
