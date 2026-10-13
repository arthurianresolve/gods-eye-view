# Production map-streaming workload

This is the remaining S47/S57 workload delivery sequence, reviewed on 13 October
2026. It does not mark either slice complete. GPT-6 Luna implements the packets;
root reviews source, reruns focused checks, and integrates exact-commit evidence.
The frozen comparison baseline remains eb8c682.

| Packet | Deliverable | Current evidence and completion requirement |
| --- | --- | --- |
| M1 fixture corpus | Versioned, seeded, bounded generation of native imagery, nonflat quantized-mesh terrain and a multilevel textured GLB tileset covering a declared Austin route | Implementation in progress. Require deterministic byte/hash regeneration and validation through installed Cesium parsers where supported; actual browser rendering remains a separate gate. |
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
