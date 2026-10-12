# S48 shader-program lifecycle attribution

Code is implemented on an isolated QA branch based on integrated `dev` at `5bbcd0de`. Root independent focused validation and all seven standard CI jobs pass at `3384b8bd`. The retention repair at `e54eaded` passes 159 independent local checks and preserves hash-bound per-parameter data in a fresh failed hosted capture. Six complete contexts show 143 first-use link checks and no repeated same-parameter query; the seventh reached context has unavailable data. Standard CI for this repair is still running. This packet does not change production rendering defaults or establish a performance improvement.

## Evidence motivating the diagnostic

The failed [current-dev capture at `73018ec5`](../s48-current-dev-capture/hosted-38270552137/review.json) contains three complete CPU profiles. Root recomputed the native `getProgramParameter` sample weights from the original profile nodes, sample IDs and time deltas, verifying each file against its preserved SHA-256 and byte-length reference:

| Profile           | Profile window | `getProgramParameter` sampled weight |
| ----------------- | -------------: | -----------------------------------: |
| Idle 1            |  20,539.521 ms |                         6,914.735 ms |
| Idle 2            |  18,667.636 ms |                         6,974.395 ms |
| Scripted motion 1 |  24,086.851 ms |                         7,475.291 ms |

These are statistical main-thread stack weights that include synchronous native waiting. They do not measure GPU duration or precise CPU execution time. The profiles cover warmup through measurement-boundary completion and are separate from run-level motion-p95 comparisons.

Luna's source review, independently checked by root against the installed Cesium 1.138.0 / engine 22.3.0 files, finds:

- `ShaderProgram.initialize` returns when an initialized program already exists. Initial creation reads link status, active-uniform count and active-attribute count.
- `_bind` and the vertex-attribute getter can trigger that first initialization. The recorded parent stacks include both drawing and primitive-update paths.
- `ShaderCache` reuses programs by the vertex/fragment source cache keys and sorted attribute locations.
- Optional shader validation reads `VALIDATE_STATUS`; the context's validation flag defaults to false. The SpectorJS editor has a separate explicit rebuild path whose execution is not established here.

The source and stacks favor initialization and first-use synchronization as the next hypothesis to test. The historical profiles contain neither GL program identities nor the query's `pname`, so they cannot settle whether every sampled query was the first one for that program.

[The source audit](source-audit.json) records exact source/profile hashes, package versions, findings and limitations. Recompute file identities and sampled weights with `node docs/performance-evidence/s48-shader-program-attribution/source-audit.mjs`. Source interpretation remains an inspected finding rather than an assertion proved by that replay script.

## Required observer contract

An explicitly enabled observer will count program creation, linking, parameter queries and deletion on the owned Cesium context. Bounded per-program and per-parameter rows will separate first and repeated queries and record whether linking was called or confirmed before a query. Timing describes synchronous method-call elapsed time. No shader strings, provider data, extra GL queries, extra renders or readbacks are needed.

The observation window is the owned document's context acquisition through its existing cleanup callback. This lifetime scope must remain explicit; it cannot be substituted for the historical CPU-profile windows or a measurement-only interval. Context replacement, relinking, calls borrowed by another context, exceptions, partial installation, overflow and changed wrapper ownership require tests using the actual serialized page hook. Truncated attribution and unsuccessful resource cleanup must remain distinct. Disabled capture leaves this observer uninstalled.

## Integration boundaries

The capture CLI exposes `--shader-program-attribution` only for the dense-investigation fixture. The outer smoke runner accepts `--capture-shader-program-attribution enabled`; the manual CI input is `capture_shader_program_attribution`, defaulting to false. The observer wraps only the captured Cesium context and keeps at most 128 program rows and four distinct parameter rows per program. Overflow is recorded and cannot pass complete attribution validation. Counters describe calls; they do not count unique omitted programs.

The report binds each observer summary to the exact diagnostic document identity and its method-restoration evidence. Only declared numeric fields and enums are retained. Borrowed calls on another context and calls through a retained wrapper after disposal forward without recording. Relinking clears the prior confirmed-link state. Instrumented captures remain comparison-ineligible, and the existing frame, cleanup and child-process deadlines remain unchanged. Standard integration passes at `3384b8bd`; the failed rendered diagnostics and subsequent evidence-retention repair are recorded separately below.

S48 and the unresolved physical Windows frame/capture failure remain open. The failed historical capture retains its failed status.

## Local validation

Root independently ran fifteen Node 24.16.0 suites: **151 passed, zero failures, zero skips**. The [validation record](local-validation.json) binds the exact command and unchanged source hashes before and after execution; the [raw TAP output](local-validation.log.gz) is compressed without editing. Coverage includes the exact serialized page hook, the shared envelope builder, smoke validation, actual CLI rejection, existing renderer retirement and interception failure paths, weather and infrastructure fixtures, and depth-pick/profiling controls. Luna separately passed formatting for 1,600 files, changed-module syntax, import directions and package boundaries.

Review corrections preserve thrown GL values and borrowed receivers, prevent recording after disposal, restore other owned wrappers when a replacement method getter throws, strip undeclared nested fields, and bind observer identities to the diagnostic documents. The producer/validator checks reject omitted parameter rows and impossible first-query counts. Unavailable observer records preserve null metrics without crashing report construction. An enabled-observer timeout keeps its original timeout classification and deadline while retaining a bounded late acknowledgement; it is never converted into a pass.

These local results validate tool behavior, not native driver timing or any production performance benefit.

## Bounded evidence-retention repair

The capture now writes a separate checkpoint after each owned document cleanup and refreshes it after browser teardown. The checkpoint permits at most 40 documents and 8 MiB, retaining the observer's existing 128-program/four-parameter bounds. The general failure report keeps its 256 KiB limit and depth restriction. No rendering or child-process deadline changes.

Direct observations and late cleanup observations occupy separate fields. Invalid observations do not discard valid records from other documents or a valid late result. A late result cannot turn the original timeout or unsuccessful outer cleanup into a pass. Incomplete checkpoints remain partial and all shader attribution remains ineligible for performance acceptance.

The outer runner verifies the application commit, harness commit, build receipt, payload and reference hashes and byte lengths. A complete capture must also match the checkpoint's document identities. Missing reports preserve diagnostic data with an explicit missing binding; they cannot establish complete capture validation. Saved JSON projects only declared fields before upload, including reference metadata. Source-byte hashes remain separate when canonicalization changes saved bytes.

Root independently passes **159 tests, zero failures and zero skips**, across sixteen suites with unchanged source hashes. The [retention validation record](retention-validation.json) and [raw output](retention-validation.log.gz) bind that exact source state. The actual serialized observer, generic failure projection, owned checkpoint writer and outer ingestion are exercised together; malformed, oversized, missing and altered artifacts are rejected. This is local repair validation. The fresh hosted failure below verifies partial checkpoint preservation, and run 38288835512 remains failed.

The real timeout-to-late-acknowledgement regression also exercises persistence before and after the delayed response. It exposed an omitted unavailable document before acknowledgement; the repair retains that document with null metrics and an invalid count, then records its late parameter rows separately. Root independently passes the two affected suites, **45 tests**, in [the targeted validation](retention-late-validation.json), then reruns all sixteen suites against the final implementation. The [earlier local record](retention-initial-validation.json) is retained with its original source hashes and does not validate this last semantic correction.

## First hosted result: incomplete capture and lost parameter detail

[Run 38288835512](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38288835512) fails at exact application/harness `3384b8bd`. Five of six short samples complete (both idle, both motion and the first tracking sample). The unchanged 180-second child deadline stops the run while it prepares the second tracking document; the resulting `Target.createTarget` error follows target closure. The baseline compatibility check passes. This remains failed integration, with no post-capture served-byte verification or performance acceptance.

Seven reached document observers restore all four method wrappers, and seven interception releases report confirmed cleanup. Across those document lifetimes the retained records contain 177 programs, 531 parameter queries and about 60.724 seconds of synchronous parameter-query elapsed time. Each retained program records one creation, one link and three parameter queries. These lifetime totals cannot be substituted for the earlier CPU-profile windows or interpreted as measured GPU duration. The environment is Linux Headless Chrome 152 with SwiftShader.

The generic failure projector drops every nested `parameterNames` array at its depth limit, even though each original observer reported no truncation. The final failure artifact truthfully sets `evidenceTruncated: true`; the inner `complete` labels do not make those projected records complete. Per-parameter identities and first/repeated-query counts therefore cannot be recovered from this run. This is a diagnostic evidence-retention defect and must be repaired before another run. Preserve the existing 256 KiB failure-report limit and use bounded schema-specific artifact handling; do not widen the general projector or change rendering deadlines.

[Raw evidence and independent review](hosted-38288835512/review.json) bind the original artifact hashes, revisions, sample count and retained cleanup/counter records. Replay with `node docs/performance-evidence/s48-shader-program-attribution/hosted-38288835512/review.mjs`. [Standard CI 38288832440](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38288832440) passes all seven required jobs at exact `3384b8bd`: Node 24/26, Windows onboarding, all three installation/recovery platforms and browser journeys. [Exact metadata](standard-38288832440.json) records the scope. This validates the initial observer/tooling integration, not the failed diagnostic or the subsequent evidence-retention repair.

## Hosted retention repair: preserved data, capture still failed

[Run 38293251113](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38293251113) tests exact application/harness `e54eaded`. The baseline compatibility check passes. The candidate completes both idle and both motion samples, then reaches the unchanged 180-second child deadline during the first tracking route setup. The resulting target-closed error remains a failed capture. Post-capture served-byte verification is missing. This short Linux Chrome 152 / SwiftShader run is not a performance comparison or physical Windows validation.

The repaired sidecar retains 135,263 bytes of partial attribution and an independently verified reference. Root verifies payload/reference hashes and lengths, exact commit/build receipt, document identities and each complete observer's serialized hash. All six complete contexts retain their parameter arrays and confirm wrapper/interception cleanup. The seventh reached context retains an explicit unavailable record with unconfirmed cleanup; the eighth expected context is absent. The original failure is not converted into a pass.

| Parameter           | Calls | First queries | Repeated queries | Synchronous elapsed |
| ------------------- | ----: | ------------: | ---------------: | ------------------: |
| `LINK_STATUS`       |   143 |           143 |                0 |         61,679.2 ms |
| `ACTIVE_UNIFORMS`   |   143 |           143 |                0 |              0.1 ms |
| `ACTIVE_ATTRIBUTES` |   143 |           143 |                0 |              1.2 ms |

Every observed program is created and linked once, with one query of each parameter. `LINK_STATUS` accounts for 99.998% of recorded query elapsed time; the longest such call takes 3,064.8 ms. These whole-document synchronous times support first-use link synchronization as the cause of the observed query stalls in this software-rendered workload. They do not establish GPU execution time, a driver defect, repeated-query overhead, or the physical Windows failure's cause. Adding a cache for repeated parameter reads is not supported by these observations.

Preserve the evidence and investigate program initialization/compilation and document activation costs before changing runtime behavior. Any future scheduling or program-reuse experiment must preserve shader correctness, populations, visuals and actual warmup/measurement boundaries. Do not skip link validation or widen deadlines to turn this failed capture into acceptance.

[Raw artifacts and independent replay](hosted-38293251113/review.json) retain the failed report and partial checkpoint. Run `node docs/performance-evidence/s48-shader-program-attribution/hosted-38293251113/review.mjs` to verify identities and recompute counts/timings without importing the implementation under test. The uploaded canonical reference differs in filename from the producer reference; replay labels and verifies its reconstruction separately rather than claiming it is an uploaded original.
