# Imported EntityCollection clearing

Commit `81fba13c07bcae64757c09892c773b27aba66e17` replaces per-ID imported
entity removal with a shared ownership-aware helper. It uses `removeAll()` only
when every current entity is the exact object recorded by the import layer.
Otherwise it batches removals under event suspension and removes an entry only
when its current ID still resolves to that owned object. This preserves outside
entities, including a replacement that reuses an imported ID.

Two exact-helper Node comparisons used Cesium 1.138.0 and Node v24.16.0. Each
mode ran five alternating pairs after one warmup on each side, with 5,000
imported point entities. The mixed mode also had 100 unrelated entities. Forced
GC was disabled. The timer covers only EntityCollection clearing; this evidence
does not measure browser frames, import activation, or end-to-end UI latency.

| Run                | Mode     | Individual median | Shared helper median | Paired changes                     | Faster pairs |
| ------------------ | -------- | ----------------: | -------------------: | ---------------------------------- | -----------: |
| Primary            | Isolated |         28.322 ms |             8.363 ms | -71.3, -74.6, -70.1, +18.9, -76.2% |          4/5 |
| Primary            | Mixed    |         21.764 ms |            12.883 ms | -67.9, -39.9, -47.6, -68.3, +56.9% |          4/5 |
| Independent repeat | Isolated |         20.010 ms |             8.938 ms | -57.3, -74.5, +24.0, -90.9, -37.8% |          4/5 |
| Independent repeat | Mixed    |         37.978 ms |            13.353 ms | -69.6, +49.0, -67.0, +46.2, -67.7% |          3/5 |
| Guarded invocation | Isolated |         36.450 ms |             8.508 ms | -85.3, -70.4, -83.3, -81.0, +22.1% |          4/5 |
| Guarded invocation | Mixed    |         24.317 ms |            15.476 ms | -49.5, -36.4, -76.4, +44.7, -46.0% |          4/5 |

All pairs confirmed the expected removal count, exact survivor set, and the
collection event counts: individual removal emitted 5,000 events; the helper
emitted one. The timed observer records counts only. Removed-ID hashes are
inferred from the exact setup IDs and their confirmed absence after removal;
the focused tests separately inspect exact removed IDs and verify replacement
survival.

The primary report is
[`entity-collection-removal-81fba13-primary.json`](entity-collection-removal-81fba13-primary.json)
with SHA-256 `8176442b3d2d65d366c120b503042f72018167cda565e71758c808b46991e994`.
The independent repeat is
[`entity-collection-removal-81fba13-independent-repeat.json`](entity-collection-removal-81fba13-independent-repeat.json)
with SHA-256 `5140e2e12c122c5e81b00dffd7370d7752e0185515245317f5766eecbee92f20`.
Both bind runtime SHA-256 `f9e6634f2ae5f70e9e5eb9c4c7952eb5cf2566e6c77bfd3c63a2767fc3b7337d`,
helper SHA-256 `0a9091f60f510b4b6c1c2fd51c653a29e632044296ee30db9475373d83d62b4f`,
and benchmark harness SHA-256
`973ab7650fd08aba76ba69d21e1d9512e3dd346a059d0a5102613ca1095bd425`.
The package-lock SHA-256 at both runs was
`671ba3b201cb29e8fb6662bb785cab51140f3d89c45e50d8b32b638bebbca7a6`.
The guarded invocation then verified committed-clean runtime, helper, harness,
and lockfile bytes both before and after all timed pairs, while confirming
`HEAD` stayed fixed. It records their four hashes in its report and has SHA-256
`f5d9578d686b2ff3e19162dee303ec9396b7c4766680aa77a82acdebe404897a` in
[`entity-collection-removal-81fba13-guarded-run.json`](entity-collection-removal-81fba13-guarded-run.json).
That report ran at harness SHA-256
`72adf0316b1418fe75b13d4c563a23df62dce5628c4a368bb7b46077d508ba0c` on commit
`be6c07efdb659983c3ecaf0ce1a9066439ee8f71`.

Earlier `cb4b59f` measurements used an ID-only batched variant and are
exploratory; they are not attributed to this production helper. The comparison
does not establish a broad application performance gain. Focused ownership
tests, package-boundary check, formatting check, and production build passed
for that historical candidate.

## Outcome: bulk removal rejected

The bulk-removal implementation was rejected after rendered pixel equivalence
failed. Hosted run 38142466903 at `acbd812b6c1ea9e976929db9aefccb18e457c640`
reported `Final pixels differ across equivalent imports`. An independent
decode found 798 changed pixels in the rectangle x=232..407, y=127..238. Both
captures contained 26,631 non-black green pixels, so the mismatch was localized
to point edges/colors rather than missing point coverage. The original report
and exact captures are archived in
[`import-pixels-38142466903/`](import-pixels-38142466903/).

A separate Node reproduction using the real Cesium 1.138.0
`EntityCollection`, `EntityCluster`, and `PointVisualizer` showed that
`removeAll()` changes the Entity-to-point-primitive index assignment after
repopulation: the first clear mapped the first entity to primitive 4,999, while
individual forward removals kept it at index 0. The mapping alternated after
repeated bulk clears. This is consistent with the pixel mismatch, but the
captures do not prove that index order alone caused those changed edge pixels.

Reverse-order batched removal restores the normal point-index assignment, but
changes the `collectionChanged` removed-array order when a caller has already
suspended collection events. Cesium exposes no public suspension-depth query,
so the helper cannot safely choose a different order for that case without
reading private engine state. The runtime therefore keeps ownership-checked,
forward per-ID removal and preserves the existing normal and externally
suspended event order. The earlier latency rows above are historical results
from the rejected helper hash and do not describe the current runtime or justify
the optimization.
