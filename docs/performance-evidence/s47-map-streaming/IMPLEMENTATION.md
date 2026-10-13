# Production map-streaming workload

This is the remaining S47/S57 workload delivery sequence, reviewed on 13 October
2026. It does not mark either slice complete. GPT-6 Luna implements the packets;
root reviews source, reruns focused checks, and integrates exact-commit evidence.
The frozen comparison baseline remains eb8c682.

| Packet | Deliverable | Current evidence and completion requirement |
| --- | --- | --- |
| M1 fixture corpus | Versioned, seeded, bounded generation of native imagery, nonflat quantized-mesh terrain and a multilevel textured GLB tileset covering a declared Austin route | Implemented through f24b68ad; five focused tests pass independently, including real Cesium parser traversal, encoded geometry bounds, Esri default discard-policy probe and a failed-decode control. Earlier rejected corpora remain recorded. Browser rendering and full-application coverage remain M3. |
| M2 build identity | Fixed public inert fixture key selected only by an explicit named build profile, with configuration digest in the recipe/receipt and verification | Implemented through 05eefdcb; thirteen receipt/capture-provenance tests pass independently. Named profile and exact configuration digest are required on verification. Ignored dotenv inputs are rejected before/after build and verification. Explicit missing-value capture CLI handling remains under review; real production builds remain unvalidated. |
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

The follow-up `ca2d243e` fixes the root geometry and horizon point by encoding
only the declared route patch, with continuous geographic height sampling.
Independent review still finds seven skirt vertices outside bounds in five
tiles, plus inward-rounded route edges at all eleven levels. The
[skirt/coverage failure control](skirt-coverage-review-ca2d243e.json) preserves
the omitted native worker offsets and incomplete coverage.

Correction `16bfd081` includes each edge's actual Cesium horizontal skirt
offset and rounds external route edges outward. The
[independent encoded-byte audit](terrain-correction-review-16bfd081.json)
passes all 5,780 surface vertices and 408 skirt vertices across twenty terrain
tiles, with valid Austin culling and complete declared coverage at every level.
The corpus is 1,881,234 bytes. Follow-up `d1658578` corrects a typed-array
coercion error in the test decoder and adds actual per-level coverage checks.
The four parser/corpus tests pass independently. Native Esri service metadata,
browser rendering and full-application capture are still separate work; M1 is
not yet the complete production map workload.

Native Esri follow-up `75ce3611`, `15c3e4ed` and `f24b68ad` adds actual
MapServer metadata parsing, native tile URL resolution and the explicit
transparent missing-tile probe requested by Cesium's default discard policy.
The [independent parser review](native-parser-review-f24b68ad.json) records
five passing tests, 71 generated assets and their manifest hash. Successful
HTTP bytes are insufficient: the injected decode failure is rejected. Node
uses a sharp-backed image seam; browser image decoding and actual application
rendering remain M3 requirements. M1 corpus/parser implementation is complete
within that scope, without declaring S47 or S57 complete.

## M3 integration requirements from current source review

Use the production capture CLI and its outer build-smoke validator. A standalone
viewer or direct replacement of the map registry cannot complete this packet.
Keep M4 comparisons separate from the short hosted diagnostic smoke.

1. Pass the named M2 profile through both baseline and candidate builds, their
   initial served checks, the child capture CLI and post-capture verification.
   The ordinary dense smoke must not accidentally activate the inert Google
   key without the same bounded fixture policy. The native startup path must
   consume the generated root document before selecting any alternate stack.
2. Bind exact native request routes to the M1 manifest. The Esri production
   service path uses `ArcGIS` casing, while the logical corpus path uses
   `arcgis`; map these explicitly. Preserve the single `f=json` metadata query
   and the default discard-policy probe. Terrain uses native Re:Earth TMS
   coordinates and the corpus layer metadata. Reject undeclared tile indices,
   extra queries, methods, hosts and paths. Do not count generic offline
   responses as fixture delivery.
3. Resolve GLB content through the actual Cesium resource derived from the
   Google root URL. Its relative `../tiles/` references resolve differently
   from the loopback parser-test URL. Verify inherited query behavior with
   the pinned Cesium resource implementation instead of guessing or rewriting
   receipted fixture bytes. Add a bounded, declared synthetic credit-image
   response for the helper's native credit request; keep provider attribution
   and synthetic-data provenance explicit. Never use a real provider key.
4. Drive the existing `photoreal`, `esri-imagery` and `osm` controls and read
   native active-stack/provider state. Assert successful nonflat terrain and
   actual ready tile/imagery delivery; a flat terrain fallback, an empty tile
   set or a successful network response alone is insufficient. Use a declared
   elapsed-time route within fixture coverage; verify real camera/frustum
   coverage before freezing it. Preserve native SSE, cache budgets, collision,
   drawing buffer, effects and Manual visual settings.
5. Retain request outcomes, byte/hash identity, response coordinates, observed
   tiles/providers, stalls and disposal checkpoints in bounded records. Cache
   hits and request counts are measured outcomes, not required equal totals.
   Optional baseline-only absent diagnostics remain unavailable. Polling and
   teardown retain their existing deadlines and explicit failed states.
6. Cover missing/corrupt bytes, aborted or superseded switches and late
   delivery. Verify actual native state after each transition and drain owned
   requests/listeners during teardown. Unhandled URLs and unexpected fallback
   must fail the report, not silently make it pass.
7. Bind the child report to the same build/profile/corpus, camera route and
   visual observations in the outer validator. Exercise mutations of each
   identity and readiness condition. A short hosted smoke remains
   comparison/performance ineligible; only M4 supplies matched run evidence.

The [M2 independent review](build-profile-review-05eefdcb.json) records the
current source, profile digest and exact validation scope. Default and historical
receipts remain readable without claiming the new dotenv checks.

An [independent pinned-Cesium resource derivation check](native-google-resource-resolution.json)
resolves all 21 generated content references from the native Google root path.
They resolve under `/v1/tiles/`, each retaining the fixed public `key` query,
and all map to declared GLBs. This is URL derivation evidence only; actual
network interception and rendered delivery are still M3 requirements.
