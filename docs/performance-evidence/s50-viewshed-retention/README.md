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
acceptance. The rendered retained-versus-rebuild component comparison remains
under implementation, so S50 engineering stays partial. Current integration CI
at `c7c47245` predates this runtime change and is not its integration evidence.
