# Cesium dependency patches

The performance work keeps Cesium 1.138.0 and its locked engine 22.3.0. The
inertia patch addresses an independently reproduced input-ownership defect.
The collision-transform candidate avoids a stationary tracked-camera write in
terrain checks. Rendering quality, collision protection and the configured
inertia coefficients remain unchanged.

## Disabled camera input and residual inertia

Cesium's camera event aggregator continues to collect mouse movement while
`ScreenSpaceCameraController.enableInputs` is false. Its per-update reset clears
the current movement flag but retains the last movement. If a drag spans several
disabled updates, enabling input can start inertia from that retained movement,
even though the camera never handled the drag. Calibration's post-update input
handoff prevents queued direct movement but cannot, on its own, prevent this
deferred inertia.

The patch adds a disabled-action branch in `reactToInput`: create the relevant
inertia state as disabled, or disable its existing state. Existing enabled-action
code then re-enables inertia when the camera handles a fresh gesture. Disabling
input also cancels any earlier active inertia; it does not resume after another
tool releases camera ownership. There is no release delay or change to ordinary
enabled navigation, damping, camera transforms, or event routing.

## Stationary tracked-camera terrain checks

With a nonidentity tracked-camera transform, `adjustHeightForTerrain` converts
the camera to world coordinates and back even when no terrain correction is
needed. Repeated real controller updates reproduce changing floating-point
camera positions at fixed target coordinates. A control that omits the
collision path remains identical; disabling collision is a diagnostic control,
not the proposed fix.

The candidate first checks the existing world-space position in 3D mode. If no
height correction is due, it preserves the original terrain-height bookkeeping
and returns without transforming the camera. If correction is due, the original
correction path runs, including minimum zoom distance. Other scene modes retain
their original path. The patch does not round coordinates or relax comparison
tolerances.

`scripts/performance/cesiumTerrainCollisionTransform.test.mjs` compares the
actual source, browser and CommonJS controller implementations. Its stationary
control detects the original transform writes and verifies that the candidate
preserves the exact initial pose. Separate collision cases compare corrected
camera output against the original implementation. These isolated checks do
not yet prove that this mechanism accounts for every hosted camera difference;
the application comparison and its passive scene-boundary trace remain separate.

## Installation and distribution

`patches/cesium-1.138.0-inertia.json` and
`patches/cesium-1.138.0-collision-transform.json` record an ordered patch chain:
exact package versions, input and output file hashes, and replacements for each
supported distribution:

- Engine source used by ESM development and tests.
- Minified and unminified browser bundles.
- Minified and unminified CommonJS bundles.

Production uses the prebuilt browser bundle through `vite-plugin-cesium`.
Patching source alone would leave production unchanged. The release archive must
include both patch manifests and `scripts/apply-cesium-patches.mjs` because its
package file retains the installation hook.

The applier validates the complete chain before writing any file and accepts
only recorded pristine, intermediate or fully patched content. This permits
recovery from an interrupted update without accepting unrecognized bytes. An unexpected
version or file must fail visibly; do not work around that failure by disabling
the check or silently accepting a new hash. A dependency upgrade requires a new
reproduction, review of whether upstream fixed the defect, and compatibility
validation before this patch is replaced or removed.

## Validation scope

The regression compares actual Cesium controller behavior with controlled time.
Disabled drags separated by controller updates must leave the camera unchanged
after release. Ordinary rotate, zoom, and tilt controls must preserve the exact
sampled poses of the pristine implementation, including inertia. A fresh manual
gesture after unlocking must restore navigation normally.

These engine checks do not establish rendered equivalence, Windows frame
delivery, motion-p95 improvement, or a retained-resource plateau. The calibration
rendered comparison, application/tracking gates, and hardware evidence remain
separate requirements in [the performance plan](CESIUM_PERFORMANCE_PLAN.md).

Cesium's upstream source and distributed bundles are licensed under Apache-2.0;
their existing license notices are preserved. The checked-in manifest records
only the narrow replacement, rather than redistributing the full engine.
