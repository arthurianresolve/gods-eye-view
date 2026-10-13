# Rendered viewshed comparison: extra control construction

[Run 38437691743](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38437691743)
at `e7ed8c5712e37f6b815eadc894107a6ec9da746e` remains **failed**. It uses the
free hosted macOS ANGLE Metal / Apple Paravirtual renderer and the pinned v2
component fixture. The report records no page errors or external requests.

The retained and full-layer rebuild views produce exactly identical RGBA hashes:
`cb686830b11cc58975ca042a2c65db6131e577e6240fa557ab6178ab2c86f729`, with zero
changed pixels. Visible volumes change 73,796 pixels relative to wireframe-only
mode. Settings match, including the 1200 by 800 drawing buffer and four-sample
MSAA. These facts support rendered equivalence for this fixed component view,
not full-application or physical Windows qualification.

Mode round-trips and two disable/enable cycles retain the same fourteen volume
identities with zero additional constructions. Pre-ready and ready tint checks
pass. The live-volume peak stays fourteen, and no duplicate live camera IDs are
observed. Final teardown records 35 created, 35 removed and 35 destroyed volumes;
equivalent layer-only post-render listener counts are 3 before and 3 after.
Overlay/governor teardown reduces that count to 2 before viewer destruction.

The strict validator rejects **15 constructions** in the rebuild control, which
expects fourteen. Hidden pose re-entry also records two constructions. The
current report does not identify which geometry revision caused the extra build.
Investigate late footprint/pose resolution versus an unchanged-geometry rebuild;
do not raise the expected count. This failure remains visible even though the
pixel, visibility reuse and teardown observations succeed.

Subsequent production-factory reproduction establishes one concrete duplicate
build mechanism: resolving footprint measurement from unknown to known with
unchanged zero-height supports replaces a volume despite identical Cartesian
vertices. The aggregate original report cannot identify its exact camera or
attribute its extra build retrospectively.

Reviewed runtime fix `641cdd3fb585a07f75b86cb59fd3c4786c51b9ff` (Luna source
`11ef385383bc2867904460b0117682f29f76327b`) separates observation metadata from
rendered geometry equivalence. Metadata refreshes while positions and the real
Cesium primitive remain identical; changed support heights still rebuild, and
a hidden volume is evicted on source-owner replacement. Root passes all 30
`geometryReuse.test.mjs` and `groundRevision.test.mjs` tests plus formatting and
diff checks. The strict rendered fourteen-build control still needs a fresh
run; its expected count has not changed.

Artifact `11832814362`: [original report](hosted-native-renderer.json), 40,573
bytes, SHA-256
`e5a2c1b29e457e5fc83bfe781dd89ae5b47fd05860a064e2da66335bd2367631`.
