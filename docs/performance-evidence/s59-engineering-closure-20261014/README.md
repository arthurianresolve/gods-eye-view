# S59 cooperative-ingestion engineering closure

This record closes the S59 implementation checklist on the current `dev`
source. It does not claim final browser interaction or release qualification.

The current path now covers each engineering requirement:

- `consumeInBatches` owns one scheduled wake at a time, targets four
  milliseconds of application work between yields, checks cancellation and
  retires its timer, listener and iterator on every exit.
- Byte-backed input is decoded in cancellable 64 KiB chunks. GeoJSON top-level
  structure and features, CSV records and the restricted XML token stream are
  scanned cooperatively before existing normalization rules are applied.
- Imported line and polygon Cartesian preparation yields before Cesium objects
  are created. Replacement, abort, clear and destroy retire partial work and
  prevent stale completion from repopulating the scene.
- Workspace refresh is single-flight with one latest pending pass. Import,
  saved-query, query-result and comparison-result owners reject stale work and
  keep selection scoped to the current workspace.
- Query and comparison rows are built through the shared bounded consumer.
  Layer counts, metadata and workspace storage text are written only when their
  displayed value changes.
- The application catalog is immutable after construction. There is no dynamic
  catalog mutation producer that needs an additional refresh/backpressure path.

The sixteen-coordinate preparation experiment is intentionally absent from the
runtime. Its retained five-pair comparison lowered the median largest batch to
about four milliseconds but more than doubled median completion time for both
large line and polygon fixtures. Commit `65fa2e4e` reverts it. The plan permits
recording and rejecting an optimization that does not demonstrate a repeatable
net benefit.

Validation on the clean `d838802e` starting revision passed 84 focused tests
with no failures or skips:

```text
node --test src/ui/textUpdate.test.mjs src/ui/layerPanel.test.mjs \
  src/ui/workspaceLibraryImport.test.mjs \
  src/imports/cooperative.test.mjs src/imports/geojsonCsv.test.mjs \
  src/imports/kmlGpx.test.mjs src/imports/previewCancellation.test.mjs \
  src/imports/runtimeLayer.test.mjs
```

The exact source hashes and result are recorded in [review.json](review.json).
Final qualification still requires the complete large-file browser journey,
local-control p95 at or below 100 ms, loaded replay-seek p95 at or below 250 ms,
visual completeness and the frozen-candidate retention/release gates. Those are
S60 evidence and do not reopen S59 engineering.
