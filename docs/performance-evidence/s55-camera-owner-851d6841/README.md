# Tracking camera ownership checks

Commit `851d6841` (reviewed Luna source `30e364ef`) adds behavior tests for the
existing `applyTrackedCameraFrame` implementation. It does not change runtime
camera behavior. Root passes **83 tests in eight files**, including both owned
tracked-time reproductions, camera handoff, cockpit, readout, model regime and
click behavior. [files.json](files.json) binds the retained logs and review.

The new checks execute the production callback and Cesium ENU transform. They
verify one initial handoff write, no extra camera/position/offset work on safe
subsequent frames, independent owners of shared controller zoom settings, and
listener/settings restoration on explicit disposal, target replacement and viewer
destruction. These are Node behavior checks with a camera double, not a rendered
tracking or latency measurement.

The isolated negative control changes only the handoff guard so every update
writes a transform. The new test fails with `2 !== 1`, as intended. Its diff and
raw failed log are retained. That mutation was not applied to production source.

Root verifies all thirteen civil and twelve military source/dependency hashes
against the accepted `47dbee4` and `afe83bc` component comparisons. Those original
five-repeat, 124-frame reports retain their original revisions and scope: equal
output hashes and clock reads reduced from 372 to 248 per repetition. They do
not establish current application motion p95, GPU performance or visual output.

This packet closes a missing test in the camera-ownership audit. S55 remains
partial pending its complete engineering disposition and current integrated
tracking validation; physical Windows and final-candidate qualification remain
pending. Future changes to the compared paths need their own affected validation.
