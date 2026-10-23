# S58 regional weather image ownership

The provider processes each regional infrared image synchronously into a new
canvas. It now closes the displaced decoded bitmap after that copy, including
when processing throws. Cesium receives the canvas. Raw radar images and images
returned after the frame closes remain on the existing Cesium ownership path.

Implemented in `f90e24f`, with repeated-transfer and error-path regressions in
`e0a13cc6f7a6be11fa45e19bd911dc5b3022d7fa`. The pinned Cesium implementation
requests ImageBitmaps and later drops the uploaded imagery reference; the
application's replacement canvas prevents Cesium from owning the displaced
bitmap. Explicit release fixes that ownership gap. It does not establish how
long garbage collection previously retained those resources.

Code and focused automatic validation are complete for this cleanup. The 70
weather tests and four infrared-processing tests pass. Tests cover 30 equivalent
transfers, processed pixel preservation, one close per displaced source,
readback failure, cancellation, raw pass-through and orientation.

[CI run 38149943934](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38149943934)
passed all seven standard jobs at the exact tested commit: Node 24/26 tests and
production builds, Windows onboarding, three operating-system recovery jobs,
and the application browser journeys. Root checked all 15 recovery records for
preserved settings/workspace assets, zero remaining pages before browser close,
natural process exit and the existing five-second shutdown deadline.

The original downloaded recovery JSON files and run metadata are retained here.
[review.json](review.json) records their SHA-256 hashes and verification scope.
Published layer-token checks were skipped because this was a workflow dispatch;
this patch changes no token allocation. Browser screenshots were not uploaded
by the successful journey job and are not claimed as independently reviewed.

Hardware validation remains pending. These software-rendered recovery runs do
not establish a GPU speedup, a retained-memory plateau, full S58 acceptance, or
the cause of earlier intermittent Windows shutdown timeouts. No visual setting,
weather cadence, rendering engine version or framebuffer default changed.
