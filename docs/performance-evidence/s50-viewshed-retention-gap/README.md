# S50 audit: viewshed volumes still rebuild across visibility changes

S50 engineering remains **partial**. At reviewed application `4b60f453`, unchanged
wireframe positions are reused, but `hideCctvRecordVisuals()` destroys each existing
viewshed primitive. `refreshCoverageStyles()` constructs a replacement when the
unchanged camera is shown again. It also rebuilds volumes for active-tint changes.
The earlier lifecycle worker-count checks cover wireframe jobs; synchronous volume
construction is separate and cannot be inferred from a constant worker total.

The [CPU reproduction](reproduce.mjs) invokes the production rendering/geometry
factories and actual Cesium `Primitive`/`PrimitiveCollection` ownership. It excludes
unrelated wireframe entity materialization and source collection. Three unchanged
hide/re-enable cycles destroy three primitives and create three replacements,
while preserving the exact same frustum-position object. One live volume remains
after each enable; the owned collection is destroyed in `finally`. This demonstrates
redundant construction, not a leak, GPU allocation, rendered equivalence or measured
performance cost. [Observed result](reproduction.json), [source review](review.json).

The hide-record function is identical to current upstream/fork main `9beadbda`.
This is an inherited behavior that remains relevant to the promised S50 work,
not evidence that the latest Street View merge introduced a regression.

Remaining implementation: preserve compatible materialized volumes across
unchanged visibility cycles with explicitly bounded retention; update supported
color attributes without rebuilding when only tint changes; retire obsolete
geometry on real pose/source changes and owner destruction. Verify hidden updates,
re-entry, selection, source replacement and final teardown. Keep the original
appearance and picking behavior and measure construction/resource effects before
acceptance. Do not accumulate one hidden GPU primitive for every camera visited.

The current production cohort is bounded by `COVERAGE_NEIGHBOR_LIMIT = 14`.
A compatible implementation can retain the current cohort while hidden, evict
off-cohort volumes before admitting replacements, and release all volumes on
source/layer destruction. Hidden pose updates must invalidate obsolete geometry;
they must not rebuild a hidden volume repeatedly or expose stale geometry on
re-entry. Tint-only updates need to cover both unprepared primitives and ready
Cesium per-instance attributes without changing translucency or picking.
Validation must include moving through more than fourteen cameras, unchanged
disable/re-enable and workspace restore, hidden edits, active tint changes,
source replacement and complete teardown. CPU construction counts and rendered
pixel/ownership checks establish different facts and both are required.

Run the scoped reproduction at this revision:

```sh
node docs/performance-evidence/s50-viewshed-retention-gap/reproduce.mjs
```

The script intentionally asserts the current gap; after implementation it becomes
a historical negative control. No production source changed in this audit and no
S50 criterion was waived or marked passed.
