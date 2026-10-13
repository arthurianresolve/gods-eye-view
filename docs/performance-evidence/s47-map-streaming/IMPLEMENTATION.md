# Production map-streaming workload

This is the remaining S47/S57 workload delivery sequence, reviewed on 13 October
2026. It does not mark either slice complete. GPT-6 Luna implements the packets;
root reviews source, reruns focused checks, and integrates exact-commit evidence.
The frozen comparison baseline remains eb8c682.

| Packet | Deliverable | Current evidence and completion requirement |
| --- | --- | --- |
| M1 fixture corpus | Versioned, seeded, bounded generation of native imagery, nonflat quantized-mesh terrain and a multilevel textured GLB tileset covering a declared Austin route | Initial 06f82b08 packet rejected by independent review: all 21 tileset content URLs return 404, child transforms compound absolute Earth coordinates, and provider ancestors/metadata are incomplete. Corrections in progress. Require real URL/transform and ancestor traversal controls; browser rendering remains separate. |
| M2 build identity | Fixed public inert fixture key selected only by an explicit named build profile, with configuration digest in the recipe/receipt and verification | Not implemented. Unknown profiles, arbitrary values and mismatched profile/receipt must fail. Handle ignored dotenv inputs before/after building and during verification; do not modify ordinary application configuration. |
| M3 production capture | Native startup and map-stack controls, exact interception routes, common before/after settings, fixed elapsed-time route, readiness and owned cleanup | Not implemented. Actual CLI and outer validator must both accept the same report. Include missing/corrupt assets, cancellation, supersession and late-response controls. |
| M4 matched comparison | Both revisions use the same fixture/profile, five runs with 30-second warmup and 60-second measurement, with cold activation separate | Pending M1-M3. Preserve detail settings and observed coverage; use real primary Windows rendering for hardware acceptance. Hosted diagnostics are supplemental. |

## Existing application boundaries

The baseline and candidate already feed Google's native 3D Tiles startup result
to the application's map controller. The fixed imagery registry uses the Esri
MapServer endpoint and OSM; keyless terrain uses the Re:Earth quantized-mesh
provider. Exercise those paths and the application's map-stack controls. Do not
replace them with a standalone controller or inject a private registry entry.

The pinned Cesium helper requests the Google root tileset URL and passes the
response to its normal 3D Tiles parser. A synthetic fixture response must prove
compatibility with that parser. Its Google credit image has a separate exact
asset URL that also needs a bounded policy entry. No real key or live provider
request is needed. Reject undeclared hosts, paths, queries and tile coordinates;
serve only generated local bytes.

The [Vite input audit](vite-env-input-audit.json) demonstrates that an ignored
production-local dotenv file is loaded even with the marker absent from the
process environment. Git cleanliness alone omits those ignored files. This
identifies an input the new build profile must reject or bind; it does not show
that any earlier hosted fresh checkout was contaminated. No credential files
were inspected. Reject incompatible files instead of deleting user files.

## Measurement invariants

Record fixture/profile hashes, provider classes, route, source ownership,
viewport, drawing buffer, exact visual/detail parameters, requested/delivered
tile coordinates, response hashes/bytes, observed coverage, loading stalls and
cleanup. Request counts, cache hits and cancellation totals are outcomes: a
valid optimization may change them. Do not require equal request counts or
lower maximum detail to make a comparison pass. Keep provider attribution and
synthetic-data provenance explicit.

The small existing S57 streamed-tile component fixture remains useful ownership
evidence; it is not the complete production map workload. M1 parser tests alone
cannot establish browser readiness, visual equivalence, GPU performance or
resource stability. Disk capacity is currently constrained, so generation stays
bounded and no expanded fixture tree, local dependency install or full local
build is required for M1.

[Independent initial-corpus reproduction](initial-fixture-review-06f82b08.json)
uses the actual Cesium parsed content resources and computed transforms. The
four passing original tests did not cover these requirements. Commit 06f82b08
is not integrated or accepted; preserve this failure as the correction control.

The [encoded root geometry control](initial-geometry-review-06f82b08.json)
also exposes degree/radian confusion in initial mesh dimension construction.
Twenty-four of twenty-five root vertices fall outside their declared region;
maximum measured height exceeds 21 km. Correction acceptance must evaluate
every encoded vertex through the actual composed node transform and assert
its geographic/height bounds, including children. An origin-only transform
check would miss this defect.

The `d8d2f17b` correction repairs content URLs, relative transforms and GLB
coordinates, but independent encoded-terrain review finds another failure:
255 of 289 level-zero vertices are outside the header bounding sphere, by up
to 21,282.701 metres. The corner-only bound collapses at the poles. Its zero
horizon fallback is also rejected as visible by Cesium's ellipsoid occluder
for an Austin camera above visibly exposed terrain. The
[raw bounds audit](terrain-bounds-review-d8d2f17b.json) preserves this rejected
candidate. Correction must use actual encoded geometry and verify culling,
ancestor traversal and shared-edge continuity; parser success alone is insufficient.
