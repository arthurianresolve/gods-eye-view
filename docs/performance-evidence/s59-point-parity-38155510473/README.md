# Imported point representation: hosted parity passed

[Run 38155510473](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38155510473)
passes at exact QA revision `cac088465714e7c92c9509fb9986e427b105e107`.
The point-collection path remains opt-in. This proves component correctness
on the declared fixture, not performance benefit or production acceptance.

Root independently decoded all 22 embedded PNGs and recomputed their RGBA
hashes. All eleven Entity/collection image pairs match exactly: ten captures
of 5,000 points and one mixed point/line/polygon capture. All ten point-state
comparisons preserve identity, style, draw order and native picks. Each dense
snapshot reports 5,000 primitives and nine native-pick hits. The mixed scene
resolves the exact intended Entity for each shape; its geometry rows, pick
records and recomputed hashes match. Representative dense and mixed images
were inspected visually, with the mixed image matching the earlier decoded
control byte-for-byte.

Each renderer also passes twelve completed-frame capture checks. Large line
and polygon geometry matches between synchronous/cooperative loading, and
twelve cancellation cycles leave zero imported features, points or pending
jobs. Both mixed readiness checks finish within the existing ten-second
deadline: 2,103.1 ms for Entities and 1,534.3 ms for the collection. They include
worker readiness and native picking and are not activation benchmarks.

[Entity report](import-point-entity.json),
[collection report](import-point-collection.json),
[comparison](import-point-representation-comparison.json), and
[independent review](review.json) retain the exact data and artifact hashes.
Decoded images are in `decoded/`; original PNG witnesses remain embedded.
The [earlier failed ownership evidence](../s59-point-parity-38155141281/README.md)
remains a separate failed run. The subsequent fixture fixes pass the actual
layer into point-state collection and count EntityCluster-owned primitives
through a fail-closed adapter pinned to Cesium 1.138.0.

Chrome 152 used hosted Apple paravirtual Metal, a 640 by 360 drawing buffer,
antialiasing, MSAA and framebuffer preservation. This was one Entity run
followed by one collection run; each contains five sync/cooperative pairs.
Five alternating renderer comparisons, current-dev integration, physical
Windows coverage and full S59 interaction/retention acceptance remain pending.
No speedup or post-GC heap benefit is claimed.
