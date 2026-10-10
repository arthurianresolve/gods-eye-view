# Cesium dependency patches

The performance work keeps Cesium 1.138.0 and its locked engine 22.3.0. The
inertia patch addresses an independently reproduced input-ownership defect,
without changing rendering quality or the configured inertia coefficients.

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

## Installation and distribution

`patches/cesium-1.138.0-inertia.json` records exact package versions, pristine and
patched file hashes, and the replacement for each supported distribution:

- Engine source used by ESM development and tests.
- Minified and unminified browser bundles.
- Minified and unminified CommonJS bundles.

Production uses the prebuilt browser bundle through `vite-plugin-cesium`.
Patching source alone would leave production unchanged. The release archive must
include both the patch manifest and `scripts/apply-cesium-patches.mjs` because its
package file retains the installation hook.

The applier accepts only the recorded pristine or patched content. An unexpected
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
