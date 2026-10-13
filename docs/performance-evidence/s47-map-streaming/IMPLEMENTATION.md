# Production map-streaming workload

This is the remaining S47/S57 workload delivery sequence, reviewed on 13 October
2026. It does not mark either slice complete. GPT-6 Luna implements the packets;
root reviews source, reruns focused checks, and integrates exact-commit evidence.
The frozen comparison baseline remains eb8c682.

| Packet | Deliverable | Current evidence and completion requirement |
| --- | --- | --- |
| M1 fixture corpus | Versioned, seeded, bounded generation of native imagery, nonflat quantized-mesh terrain and a multilevel textured GLB tileset covering a declared Austin route | Implemented through f24b68ad; five focused tests pass independently, including real Cesium parser traversal, encoded geometry bounds, Esri default discard-policy probe and a failed-decode control. Earlier rejected corpora remain recorded. Browser rendering and full-application coverage remain M3. |
| M2 build identity | Fixed public inert fixture key selected only by an explicit named build profile, with configuration digest in the recipe/receipt and verification | Implemented through 05eefdcb; thirteen receipt/capture-provenance tests pass independently. Named profile and exact configuration digest are required on verification. Ignored dotenv inputs are rejected before/after build and verification. Follow-up 4fc34337 rejects an explicit missing CLI value before browser startup; six CLI checks pass independently. Real profiled production builds remain unvalidated. |
| M3 production capture | Native startup and map-stack controls, exact interception routes, common before/after settings, fixed elapsed-time route, readiness and owned cleanup | Partial: native delivery adapter at 263f1e2d and corrected journey/report core through c7b6332f pass independent component checks. Actual CLI and outer validator wiring remains, followed by real browser readiness, coverage and fault controls. |
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

The [native-delivery adapter review](native-delivery-review-263f1e2d.json)
passes 24 focused corpus, receipt and adapter tests, formatting and package
boundaries at QA integration `9129d3ad`. Strict native Esri, OSM, terrain,
Google root/content and synthetic credit-image routes serve manifest bytes.
Unrelated API requests keep their existing owner; wrong methods, aliases,
extra queries, missing assets, cancellation and unexpected acknowledgements
are rejected. A separate root check exercises the actual interception
controller with an acknowledgement transport seam and confirms listener
release. The corpus now contains 72 assets, 1,949,945 bytes, including a declared
synthetic credit image. Its new manifest hash is recorded in the review.
Successful response acknowledgement remains separate from browser decoding
and rendered readiness, both still unobserved here. Production capture and
outer validation are the next implementation packet; this does not complete
M3 or provide a measured performance improvement.

The first production-driver core at `48895dd2` remains unaccepted. Independent
[API and mutation review](driver-review-48895dd2.json) finds an obsolete Cesium
cache property that the test double incorrectly provides. It also reproduces
five false report acceptances: unconfirmed owner release, undrained commands,
changed mid-route resolution, an invented route start and inflated aggregate
acknowledgements. The existing four tests pass despite these failures. Correct
the actual API observation and report invariants before integrating this core;
this review does not provide browser readiness or performance evidence.

Corrections through `c7b6332f`, integrated at `0a504d27`, address these five
report failures and use the actual pinned cache properties. Independent
`Cesium.Camera` evaluation also exposes its equivalent `2-pi` start heading;
the validator now compares angles circularly and its test uses native camera
endpoints. The [correction review](driver-correction-review-c7b6332f.json)
records 28 passing focused tests, formatting, package boundaries and explicit
lint of all seven new map modules. Serialized driver tests still use a page
seam. Actual production CLI wiring, browser delivery/readiness and outer
validation are not established by these component results.

The first CLI/outer wiring `3f4cad81` was rejected before integration. Independent
[wiring review](wiring-review-3f4cad81.json) reproduces the async map responder
skipping the existing flight fallback and the outer validator accepting missing
or wrong provenance. Source review also finds finalized map evidence omitted
from the success envelope. Correct these integration paths and cover the real
producer shape before spending a hosted build on the native map workload.

Correction `98944a06`, integrated at `17f47d05`, awaits the native map responder
before flight fallback, publishes the post-cleanup map evidence in the actual
CLI success report, and validates the complete outer build, renderer, integrity,
sample and owner-release envelope. The [correction review](wiring-correction-review-98944a06.json)
records 59 passing focused tests, all 24 capture-harness lint targets, package
boundaries and formatting. Production builds and actual browser delivery are
the next gate. The hosted smoke builds both revisions with the named profile;
its additional native map capture currently exercises only the candidate.
Baseline native-journey proof and M4 matched comparisons remain separate work.

The [first hosted map attempt](native-38349484331/README.md) at `14472b5b`
fails during the baseline's inherited dense-population preparation. It reaches
neither the candidate CLI nor the native journey. No page/interception errors
are recorded, but probe and worker cleanup are unconfirmed. Retain the raw
failure and investigate the map-specific setup path without changing deadlines
or treating this incomplete report as an application/GPU diagnosis.

The next map-specific setup packet `1058e811` is held for correction before
integration. Root [review](native-smoke-review-1058e811.json) executes the actual
fixture adapter with 72 acknowledged requests and one legitimate cancellation:
all 73 requests balance, with zero pending/error observations, but the new
single-owner validator incorrectly rejects it. Cancellation counts are outcomes,
not a required zero. Source review also finds baseline delivery finalized before
its browser context/interception owner retires. Both variants must publish
post-retirement evidence, with pending and late-response controls retained.

The follow-up `64d86946` also remains rejected: [root review](native-smoke-review-64d86946.json)
finds premature baseline disposal, cancelled-only kinds counted as delivered,
and undefined main-finally references that would prevent report writing.
Correction through `0960fef2`, integrated at `7e7e50d2`, uses shared finalization
after target closure and interception drain/release. It attaches the baseline's
completed setup evidence after cleanup, requires actual acknowledgements for
required kinds, and keeps error evidence in its owning scope. The
[correction review](native-smoke-correction-review-0960fef2.json) records 58
passing focused checks, the expanded 25-file no-undef gate, formatting and
package boundaries. Actual native production journeys on both builds and
rendered fault controls remain the next M3 gate.

The corrected setup reaches the native journey in [run 38353841324](native-38353841324/README.md),
but its visual observer expects scalar intensity properties absent from the
application facade. Actual prototype-method replay proves those values exist
in `getVisualState()`. Correction `02151a21` reads that existing snapshot in
both common and map observers, with 65 independent focused tests passing.
The failed raw report is retained, including confirmed interception retirement
and the secondary unproven credit delivery. Native rendered delivery remains
unaccepted pending a fresh run.

The [next failure](native-38354738080/README.md) exposes an incompatible
execution contract: the 60-second route is awaited within a browser command
whose timeout is 15 seconds. The `e7cd78df`/`1303aaf3` correction, integrated
at `d0f34f05`, starts a page-owned operation and uses short observation calls.
A monotonic 150-second host limit bounds slow polling; cancellation drains
with a five-second timer and terminal disposal requires matching ownership.
Missing acknowledgements remain failures and context closure retains final
ownership when page communication cannot confirm cleanup.

Failure records retain a validated phase, observed map state, actual elapsed
times, expected limits and cancellation/disposal outcomes through CLI and
outer smoke serialization. A completed checkpoint counts the three actual
stack switches, excluding the initial state. Observed cancellation-drain time
is not clipped to its timer deadline. Root passes 82 focused tests, including
slow commands, lost start responses, late cancellation timers, failed disposal
after success, and bounded-report replay. These component checks do not prove
native rendered delivery; the production browser gate remains required.
