# Bounded CCTV viewshed retention implementation

Reviewed source `bef9481a83a6746f0fa084b9b2a6e5341d2ae805` is integrated as
`2731162b9bf24cf3e8da7ccbb84903fa16744f99`. The eight changed files are identical
between those revisions. This addresses the separately recorded
[unchanged-visibility reconstruction gap](../s50-viewshed-retention-gap/README.md).

The layer retains only its current coverage cohort (at most fourteen volumes),
hides it across disable and wireframe/off mode changes, and evicts volumes outside
the next cohort before adding replacements. Hidden pose/ground changes discard
obsolete geometry without constructing a hidden replacement. Source identity uses
weak owner tokens, so records cannot retain retired terrain/tileset objects through
the new identity field. Selection tint uses supported Cesium per-instance color
attributes without rebuilding the volume.

A pre-ready tint change coalesces to the latest requested state through one owned
post-render observer. Hiding or destroying the volume removes the observer;
re-entry can re-arm it. Readiness retires it even if attribute access throws and
requests one governed redraw after a successful change. No continuous render hold
or shared worker cleanup was introduced.

Root independently passes **110/110** focused tests on the immutable source commit
using Node 24.16.0 on Windows. Suites: `src/data/cctv.test.mjs`, plus the CCTV
`rendering`, `geometryReuse`, `groundRevision` and `source` tests. They cover real
Cesium PrimitiveCollection retention/destruction, sixteen cameras crossing the
fourteen-camera cohort, mode round-trips, latest-tint coalescing, failure cleanup,
hidden edits, production map-owner replacement at identical coordinates, source
reinitialization and owner teardown. Changed-file formatting and diff whitespace
pass on the integrated revision.

Original [test log](focused-tests.log): 10,668 bytes, SHA-256
`7e16f5f732bddeb053397516a8ce07412798757960bcf99fa61a7668b1bebe77`.
These CPU/ownership tests establish reuse and cleanup behavior. They do not
establish rendered equivalence, GPU cost, full-app performance or hardware soak
acceptance. S50 engineering stays partial until remaining requirements and
rendered evidence are reviewed. Integration at `c7c47245` predates this runtime
change; [later standard CI](../integration-dddef9eb/README.md) passes six selected
jobs, and [targeted Windows recovery](../integration-15c0cff3/README.md) separately
passes with the change present. These are distinct tested revisions.

## Rendered component diagnostic

Fixture implementation `c1cd3bcd` (Luna source
`358c293e1671f86b4d6af365c2e92c9af67dec57`), scoped lint correction `b00c27c5`
(source `32d47ee9ae7bd16abac7c80690a054f51ead4743`), and report identity binding
`e7ed8c5712e37f6b815eadc894107a6ec9da746e` (source
`6226b4a00a63a837075d4e7545a8bcf68894953c`) add a selected mode to the existing
calibration fixture and hosted native diagnostic. Default calibration behavior
is retained; no production runtime changes are part of this packet.

The fixed sixteen-camera catalog uses at most fourteen live volumes, a fixed
clock/camera, and actual effective layer settings. It declares the 1200 by 960
viewport separately from the 1200 by 800 WebGL drawing buffer. Four-sample MSAA,
antialiasing and framebuffer preservation remain enabled. The descriptor, camera,
frame and clock are bound to pinned inputs; app and harness commits must match
the requested revision.

The fixture exercises pre-ready tint changes, repeated coverage modes, two
disable/enable cycles retaining the same primitives without additional builds,
cohort eviction, hidden pose edits, and ready tint updates. Fresh captures must
show visible volumes and match an honestly labeled full-layer rebuild control
exactly. Primitive construction/destruction counts and post-render listeners are
checked at equivalent ownership points. Failure images are bounded; stale,
empty, mismatched, wrongly identified or incompletely retired reports fail.

Root passes 38 focused fixture/calibration/rendering/source tests at `c1cd3bcd`,
then all four report tests after the identity follow-up. Four lint configuration
controls and the actual expanded 29-file no-undef check pass, together with
changed-file formatting and package/import boundaries (1,015 modules, 80 portable
entries). Review caught a missing fixture import, an incorrect canvas-size
assumption and the need to scope Vite's injected commit symbol before CI.

[Focused log](rendered-fixture-focused.log): 3,919 bytes, SHA-256
`db15bcda68358432ae67c53364e9f12fd29fb48c2b146cb7ad9f81fa95874bec`.
The first [rendered diagnostic run 38437691743](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38437691743)
tests `e7ed8c57`; its outcome remains pending. This is component evidence and
cannot qualify the physical Windows performance or retention soak.
