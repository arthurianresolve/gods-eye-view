# S48 depth-pick attribution - 12 October 2026

The failed [atomic warmup run](../s47-atomic-warmup-38241920477/README.md)
contains a complete CPU profile of the actual failed provider document. An
independent replay of its original samples confirms the producer's top-location
totals. The earlier [document-retirement run](../s47-observation-retirement-38237890055/README.md)
supplies three different completed-document profiles for stack attribution.
These are diagnostic windows, not matched latency measurements.

| Profile              | Window (ms) | `readPixels` sampled self (ms) | `bufferData` sampled self (ms) | `getProgramParameter` sampled self (ms) |
| -------------------- | ----------: | -----------------------------: | -----------------------------: | --------------------------------------: |
| Earlier idle 1       |  18,419.918 |                      3,602.144 |                      1,701.461 |                               6,400.240 |
| Earlier idle 2       |  16,127.154 |                      3,455.493 |                      1,875.974 |                               5,650.290 |
| Earlier motion 1     |  19,473.321 |                      8,197.858 |                      1,370.395 |                               4,022.601 |
| Failed idle 1 warmup |   8,423.294 |                      2,205.398 |                      2,280.802 |                               1,190.527 |

These statistical weights locate synchronous main-thread API calls; they do not
measure GPU execution time. The windows include other JavaScript, idle time,
garbage collection and profiling overhead. They cannot be compared as before/
after performance or used to explain the entire host/page deadline gap.

The failed profile's readback stack is `readPixels` through Cesium depth picking,
then application-bundle frames `d_`, `u_`, and `i` in
`/assets/index-DtMeaZ-z.js`. The preserved zero-based locations are line 1418,
columns 533050, 532560 and 510268. Clean-source builds at `0602cbe2` reproduce
the named bundle and map these frames to `getViewTargetCartesian` at
`src/voice/gevActions.js:4135`, `getViewTargetCartographic` at line 4091, and the
move-end background prewarm callback at line 2669. Root independently resolved
all three coordinates with `source-map-js` and checked that the source map's
embedded authored file exactly matches the checked-out source. The prewarm
callback is therefore the application caller in this failed profile. This does
not establish which caller dominates different documents or workloads.

The ordinary local build reproduces `index-DtMeaZ-z.js` with SHA-256
`4208eca2ad96f41538df9111c3afc4b3a3ac7d6710c5904050d8ec553f8cafc3`.
The separate build with explicit `GEV_APP_COMMIT=0602cbe267449ac1b5f89c5b17996c93cb5a306e`
and source maps emits `index-CUIHVnTU.js`; its three relevant offsets and minified
functions remain the same. Its map hashes to
`27447d34b47cf64a569f5e4de228e51d8b7794fc4b26cba53d29237835a4fcad`.
This is local source reconstruction, not an attestation of the hosted bundle.
Caller-level observations are still required before changing application caching.
Buffer uploads reach geometry construction and primitive updates; their
responsible layers are not yet proven.

The locked Cesium engine already caches pick-position results by window position
until its pick cache is dirtied (`Picking.js`, lines 695-702). An additional
application-level call therefore does not necessarily mean an additional depth
readback. Diagnostic work must distinguish application cache hits, actual pick
calls, completed renders and synchronous elapsed time. No cache TTL, rendering
detail, frame deadline or production default is changed by this review.

Reproduce the independent read-only analysis from the repository root:

```sh
node docs/performance-evidence/s48-depth-pick-attribution/replay.mjs
```

The [replay](replay.mjs) verifies the four original profile hashes, sample and
stack identities, timing bounds and every stored top-location total. It uses
accumulated timestamps and a stable sort before calculating sample weights,
matching the producer's handling of the motion profile's single negative raw
delta. The unsampled tail remains separate. [Derived review](review.json)
contains the resulting totals and leading full API stacks; inclusive stack
weights must not be added to native self totals. Original reports and profile
bytes remain unchanged. This is attribution progress, not completed S48 or
performance acceptance.
