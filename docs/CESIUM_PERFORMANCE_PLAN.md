# Cesium performance plan

Reconciled on 9 October 2026 against local `dev` and remote `fork/dev` after
`f77effc`. The worktree was clean before this
documentation update. The comparison baseline remains
`eb8c6828d0d03e1c04bda94c8c4fb99915a577b7` (Cesium 1.138.0).

This ledger separates code delivery, automatic checks, and hardware acceptance.
`Partial` means a foundation exists but the full slice contract is not delivered.
`Pending` means the planned change or acceptance evidence remains outstanding;
existing behavior alone does not complete a new slice. No S47-S60 slice has full
acceptance evidence yet. The [S32-S46 ledger](IMPLEMENTATION_PLAN_NEXT.md) retains
the earlier release requirements and historical results.

| Slice | Code implemented | Automatically validated | Hardware validated |
| --- | --- | --- | --- |
| S47 baseline and comparable capture | Partial: density UI synchronization, capture defaults, elapsed-time movement and instrumentation guard | Current CI unit/build gates pass; build identity, route and complete mismatch rejection remain incomplete | Pending matched captures and negative control |
| S48 attribution and resource diagnostics | Partial: bounded frame samples, overlay timings, scene counts, renderer metadata, and a bounded per-owner resource contract wired to local GeoJSON, submarine-cable, and satellite lifecycle owners | Snapshot/monitor and local GeoJSON/cable lifecycle coverage pass; production coverage and instrumentation overhead remain unvalidated | Pending traces, allocation profiles and cost attribution |
| S49 worker/lifecycle retention | Partial: stale GeoJSON/cable load cleanup paths | Existing lifecycle tests pass; no accepted post-fix retention reproduction or 60-minute soak | Pending resource plateau |
| S50 geometry coalescing | Partial: CCTV queue cursor plus existing geometry reuse | Queue tests pass; complete revision/coalescing and late-job acceptance remain pending | Pending appearance and build-count comparisons |
| S51 render demand scheduling | Partial: disposable coalesced scheduling API; no production layer callers yet | Governor unit coverage passes; layer cadence and static-frame acceptance remain pending | Pending static and animated comparisons |
| S52 overlay invalidation | Pending | Pending slice-specific validation | Pending |
| S53 collection uploads | Partial: satellite Cartesian scratch reuse and unchanged-position-write suppression | Existing satellite tests pass; upload/allocation reduction and collection partitioning remain pending | Pending matched comparison |
| S54 infrastructure batching | Pending | Pending slice-specific validation | Pending |
| S55 tracking updates | Pending: existing cached-frame behavior retained | Existing regression coverage passes; planned consolidation has no new acceptance result | Pending tracking comparison |
| S56 fresh-frame capture | Partial: shared post-render copy for viewport/pointer captures; drawing-buffer preservation already disabled | Copy/successful-listener-cleanup unit coverage passes; cancellation/destruction and full capture matrix remain pending | Pending capture correctness and measured benefit |
| S57 map-resource lifetime | Pending | Pending slice-specific validation | Pending |
| S58 weather/effects | Pending | Pending slice-specific validation | Pending |
| S59 cooperative ingestion | Pending | Pending slice-specific validation | Pending |
| S60 final candidate | Pending | Overall current CI fails Windows profile recovery; full rendered soak skipped | Pending all required hardware environments |

The visual default remains Manual. Resolution, MSAA, label density, source
populations, tracking behavior, effects, and visual fidelity are not reduced as
a performance shortcut. Auto quality remains opt-in.

## Measurement contract

Performance reports include the application and harness revisions, fixture
identity, camera path, browser and renderer, viewport and drawing-buffer sizes,
device pixel ratio, effective visual settings, layer populations, warmup, and
the measurement window. A report with mismatched fixture, settings, renderer,
or camera path is not a baseline comparison.

The long soak is accepted only when application-owned listeners, pending jobs,
scene resources, and post-GC retained heap return to their warmed baseline at
equivalent checkpoints. Forced-GC and allocation tracing are diagnostic runs,
not latency measurements. Missing Windows/macOS GPU evidence remains pending.

Required comparisons use five runs per workload with 30 seconds of warmup and
60 seconds of measurement; record cold activation separately. Cover the operating
view, dense investigation, selected tracking, infrastructure, weather/effects,
lifecycle stress and map streaming from the agreed S47-S60 plan.

Preserve matching visual settings and populations. Target at least a 20% reduction
in median run-level motion p95 for dense investigation and tracking; this is an
objective, not an achieved result. Investigate repeatable regressions above 10%
in motion p95, peak heap, retained resources or activation time. Keep local controls
at p95 <=100 ms and loaded replay seeks at p95 <=250 ms. After warmup, ownership
counts must return to baseline and post-GC heap must plateau, with no more than
5% growth over the final 30 minutes and no persistent ownership increase.

## Code reconciliation and remaining work

The changes since the comparison baseline are in `510ed8d`, `d8ce27b`,
`2e0fb80`, `c441832`, `f77effc`, and the pending owner-diagnostics change.
The first commit combines several
foundations, rather than delivering
one accepted optimization per slice. Remaining accepted optimizations should have
separate reversible commits and their comparison reports; do not rewrite the
shared history to manufacture a per-slice delivery record.

- **S47:** [the harness](../scripts/capture-scene-performance.mjs) defaults to
  five runs/30-second warmup/60-second measurement and rejects missing snapshots.
  It still defaults the reported app commit to the harness checkout; the runtime
  calls in [application tools](../src/app/tools.js) do not pass a build commit to
  the environment or monitor. Its route uses elapsed-time deltas with `setInterval`
  and `camera.moveRight`, not an absolute pose from one fixed starting transform.
  Population/path stability is reported but not rejected, and settings rejection
  is incomplete. Finish runtime identity verification, absolute routes, full
  before/after guards and slider/share/workspace/profile density journeys before
  generating accepted baseline comparisons.
- **S48:** [the monitor](../src/performance/performanceSnapshot.js) samples
  completed-frame intervals and reuses existing overlay diagnostics. It now
  accepts a bounded per-owner count map for listeners, timers, pending jobs,
  primitives, data sources, and cache entries; absent metrics stay `null` and
  arbitrary payloads are discarded. [Application tools](../src/app/tools.js)
  now collect bounded counts from local GeoJSON, submarine-cable, and satellite
  lifecycle modules. The monitor now supports a disabled mode that installs no
  render listener or diagnostic readers. Complete broader owner accounting,
  layer/geometry CPU timing and intentional-idle separation. Measure overhead
  separately; an interval
  between rendered frames is not CPU execution time or a GPU duration.
- **S49:** [local GeoJSON](../src/data/localGeojsonCore.js) and
  [cable ingestion](../src/layers/submarineCables/ingestion.js) attempt cleanup
  after stale loads. Reproduce imports, workspace replacement, CCTV, terrain and
  picking independently; trace worker completion/error/cancellation/disposal and
  verify fixture/worker loading. Optional cleanup calls alone do not prove Cesium
  releases ownership. No isolated engine defect or dependency patch is accepted.
- **S50:** [CCTV preparation](../src/layers/cctv/geometryQueue.js) drains through
  a cursor. Complete source/pose/terrain/parameter revision handling and one latest
  authoritative build per feature; demonstrate no duplicate unchanged builds,
  bounded preparation and immediate disposal of superseded results.
- **S51:** [the governor](../src/renderGovernor.js) exports
  `scheduleRenderUpdate`, but only its tests call it. Satellite lifecycle still
  holds continuous rendering. Integrate scheduled demand where appropriate and
  gate hidden/update work; prove <=2 frames in ten seconds for a settled static
  fixture while keeping tracking, wind, fades and final transition frames correct.
- **S52:** implement revision-based overlay projection/placement/paint reuse,
  text preparation caching and synchronized hit regions/accessibility actions.
- **S53:** satellite scratch reuse and unchanged-write suppression are present.
  Frequency-based collection partitioning, tracked-object isolation, batched
  membership and measured allocation/upload benefits are still outstanding.
- **S54:** implement measured static infrastructure batching with feature/pick
  identity preserved and temporary construction data released.
- **S55:** measure and consolidate tracking time/pose/projection work, preserving
  camera authority across manual, aircraft, cockpit, CCTV and replay transitions.
- **S56:** [viewport capture](../src/voice/realtimeViewport.js) copies inside
  `postRender`, but explicit cancellation/destruction ownership remains incomplete.
  [Viewer creation](../src/app/viewer.js) already sets `preserveDrawingBuffer: false`.
  This default changed before the required real-browser capture matrix and
  measured-benefit evidence were recorded. Validate idle/moving/portrait/resized/
  restored/hidden-tab cases and every cleanup path; retain or revert the default
  based on that evidence. The current default is not an accepted optimization.
- **S57:** audit and fix superseded map loads and provider/tileset ownership;
  compare repeated switches and streaming without reducing detail/cache targets.
- **S58:** measure weather/wind/effect costs, reuse equivalent resources and remove
  redundant work only where compositing and animation remain equivalent.
- **S59:** add measured cooperative batches targeting <=4 ms, bounded backpressure,
  cancellation and stale-result protection for ingestion/UI maintenance.
- **S60:** freeze a candidate, complete all automatic and hardware gates, populate
  exact-commit manifests and update this ledger, S44 and the performance report.
  An experiment rejected on measured evidence should be recorded, not counted as
  an unimplemented runtime optimization that must be forced into the application.

Start with the Windows recovery failure and S47-S50 measurement/retention gaps.
Later optimization work follows measured costs and the original dependencies;
pending human reviews or unavailable extra GPUs do not block independent code work.

## Current evidence

- [CI for `2e0fb80`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37917730204)
  passes Node 24.14.0/26.x suites and production builds, formatting/boundaries,
  Windows onboarding, Linux/macOS installation/profile recovery and the browser
  job (including reference transfer, accessibility and rendered smoke). Overall CI
  **fails** Windows profile recovery while building the prior installation:
  Vite/Rollup rejects the emitted `index.html` path, with `RUNNER~1` and
  `runneradmin` temporary-path forms in the error. The exact cause needs a focused
  fix and rerun. The 60-minute rendered soak was **skipped**: it requires manual
  workflow dispatch with `full_soak=true`. A smoke pass does not replace it.
- The local `qa-artifacts/perf-s47-smoke.json` is exploratory evidence only: it
  labels app/harness `d8ce27b` with dirty source, records zero objects and null
  performance snapshots. It does not identify or validate the deployed app or
  the final commit. `2e0fb80` subsequently added rejection of missing snapshots.
- The historical `qa-artifacts/rendered-soak-postfix-60m.json` completed 253 cycles
  without operation failures but retained listeners grew 732 -> 11,982 and heap
  67.8 -> 153.2 MB. It reports an Intel UHD 620 renderer while explicitly setting
  `hardwareRenderingValidated: false`; it is a failed stability diagnostic, not
  accepted GPU evidence. Heap paths show worker listeners retaining promises,
  primitives, entities and GeoJSON sources, without establishing whether the cause
  is application ownership, fixture interception or unresolved engine work.
- The older comparisons in [PERFORMANCE.md](PERFORMANCE.md) remain historical.
  No accepted matched comparison against `eb8c682`, post-fix 60-minute retention
  pass, Windows discrete-GPU result or macOS candidate result was found in the
  local artifacts. No 20% gain or final hardware-support claim is established.

The reconciliation itself changes documentation only. Existing checks above are
evidence for their named source commits, not newly run checks of this document
commit. VM deployment and HTTPS/DNS fixes are operational work and do not satisfy
performance acceptance.
