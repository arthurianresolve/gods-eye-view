# Cesium performance plan

Reconciled on 9 October 2026 against local `dev` and remote `fork/dev` after
`3cdd5cbd9f744de2a0d4d8a45a9a114660a182f8`. The worktree was clean before this
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
| S47 baseline and comparable capture | Partial: density synchronization, capture defaults, runtime identity, absolute route endpoint and before/after condition guards | Unit gates reject changed builds, populations, render settings, routes and background interruptions; browser journeys and matched-run evidence remain pending | Pending matched captures and negative control |
| S48 attribution and resource diagnostics | Partial: bounded frame samples, overlay timings, scene counts, renderer metadata, and a bounded per-owner resource contract wired to local GeoJSON, submarine-cable, satellite, and CCTV lifecycle owners | Snapshot/monitor and local lifecycle coverage pass; production coverage and instrumentation overhead remain unvalidated | Pending traces, allocation profiles and cost attribution |
| S49 worker/lifecycle retention | Partial: stale GeoJSON/cable cleanup and corrected fixture worker interception; isolated lifecycle cases remain | Worker completion/network preflights and 60-minute retention soak pass at `3cdd5cb` | Pending real-GPU resource plateau |
| S50 geometry coalescing | Partial: CCTV queue cursor plus existing geometry reuse | Queue tests pass; complete revision/coalescing and late-job acceptance remain pending | Pending appearance and build-count comparisons |
| S51 render demand scheduling | Partial: disposable coalesced scheduling API with satellite periodic-cadence integration; full layer rollout remains pending | Governor and satellite focused suites pass; static-frame and cadence acceptance remain pending | Pending static and animated comparisons |
| S52 overlay invalidation | Pending | Pending slice-specific validation | Pending |
| S53 collection uploads | Partial: satellite Cartesian scratch reuse and unchanged-position-write suppression | Existing satellite tests pass; upload/allocation reduction and collection partitioning remain pending | Pending matched comparison |
| S54 infrastructure batching | Pending | Pending slice-specific validation | Pending |
| S55 tracking updates | Pending: existing cached-frame behavior retained | Existing regression coverage passes; planned consolidation has no new acceptance result | Pending tracking comparison |
| S56 fresh-frame capture | Partial: shared post-render copy for viewport/pointer captures; drawing-buffer preservation already disabled | Copy/successful-listener-cleanup unit coverage passes; cancellation/destruction and full capture matrix remain pending | Pending capture correctness and measured benefit |
| S57 map-resource lifetime | Pending | Pending slice-specific validation | Pending |
| S58 weather/effects | Pending | Pending slice-specific validation | Pending |
| S59 cooperative ingestion | Pending | Pending slice-specific validation | Pending |
| S60 final candidate | Pending remaining slices | All CI gates and 60-minute software-rendered soak pass at `3cdd5cb`; subsequent changes require their own exact-commit validation | Pending all required hardware environments |

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
`2e0fb80`, `c441832`, `f77effc`, `8021a50`, `24c06cb`, `e9a29ba`,
`20f5a8a`, `72535a9`, `3a4bb4f`, `379fca0`, and `3aff740`.
The first commit combines several
foundations, rather than delivering
one accepted optimization per slice. Remaining accepted optimizations should have
separate reversible commits and their comparison reports; do not rewrite the
shared history to manufacture a per-slice delivery record.

- **S47:** [the harness](../scripts/capture-scene-performance.mjs) defaults to
  five runs/30-second warmup/60-second measurement and rejects missing snapshots.
  Runtime captures now bind the reported app commit to `__GEV_APP_COMMIT__`, reject
  a wrong commit (including the default expected local revision), and use an
  absolute elapsed-time route with a fixed endpoint even after slow frames.
  Before/after guards reject changed populations, renderer, dimensions, visual
  settings or interrupted foreground state; repeat runs must match within each
  scenario. Dense fixtures require 2,500 aircraft when selected by the mixed
  workload, 4,362 datacenters and 716 dams. Each sample receives its declared
  warmup. Opt-in Auto may change density, but not other settings. These guards
  have unit coverage; real-browser validation and slider/share/workspace/profile
  density journeys remain outstanding. The legacy `motionDistancePx` report key
  is retained for compatibility; new `motionDistanceM` correctly labels Cesium's
  world-distance units.
- **S48:** [the monitor](../src/performance/performanceSnapshot.js) samples
  completed-frame intervals and reuses existing overlay diagnostics. It now
  accepts a bounded per-owner count map for listeners, timers, pending jobs,
  primitives, data sources, and cache entries; absent metrics stay `null` and
  arbitrary payloads are discarded. [Application tools](../src/app/tools.js)
  now collect bounded counts from local GeoJSON, submarine-cable, satellite, and
  CCTV lifecycle modules. The monitor now supports a disabled mode that installs no
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
  `scheduleRenderUpdate`, and satellites now use a disposable one-second
  scheduled wake while untracked. Tracking retains a continuous hold, and
  disabling the layer disposes the timer. Extend this pattern where measured,
  then prove <=2 frames in ten seconds for a settled static fixture while
  keeping tracking, wind, fades and final transition frames correct.
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

Start with the S47-S50 measurement/retention gaps; Windows recovery now passes
alongside macOS and Linux at `3cdd5cb`.
Later optimization work follows measured costs and the original dependencies;
pending human reviews or unavailable extra GPUs do not block independent code work.

## Current evidence

- [Full CI at `3cdd5cb`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37944725028)
  passes Node 24/26, production builds, formatting, package boundaries, Windows
  onboarding, browser journeys and installation/profile recovery on all three
  operating systems. Recovery verifies persisted assets through previous install,
  interruption, rollback, upgrade and failed-verification rollback. These hosted
  recovery browsers explicitly use SwiftShader, not hardware rendering.
- [The 60-minute soak](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37944725028/job/113868003442)
  serves the exact clean `3cdd5cb` build and completes 169 measured cycles in
  3,602,183 ms. All 13 post-GC checkpoints report 632 listeners and zero pending
  worker tasks. Retained heap grows from 73,424,108 to 80,248,328 bytes across
  the whole run; the defined retention window grows 2.03%, below the 5% gate.
  Operations and stability pass with no failures or pending checks in this
  report. The `rendered-soak` workflow artifact retains the raw JSON. Chrome 152
  uses ANGLE/SwiftShader and `hardwareRenderingValidated` is false. This closes
  the automatic soak blocker, not the hardware matrix or motion-p95 objective.

## Investigation history

- The continuation adds exact served-build validation, a cold/reused/error/recovery
  Cesium worker preflight, five-minute post-GC checkpoints, automatic retention
  gates and failure-report preservation. The standalone worker check passes in
  the user's Chrome on 2026-10-09. That check uses no fixture interception; the
  intercepted harness still needs the same check before any new soak evidence
  is accepted. It does not establish the cause of the historical worker retention
  or complete S49/S60. No engine patch is justified by the evidence so far.
- Retention runs now install test-only worker counters (64 workers, 1,024 pending
  IDs per worker maximum); overflow leaves evidence incomplete. Counters retain
  no worker objects, task payloads or URLs. Checkpoints record submissions,
  replies, error replies, post failures, termination and the age of pending work.
  A task unsettled for ten seconds fails this small-fixture diagnostic; it does
  not impose a production worker timeout. The standalone Chrome probe observed
  four submissions/four replies, the expected error, and zero pending jobs.
- [The intercepted CI probe at `885cb48`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37941399027/job/113856408602)
  fails on `geometry-cold` before measurement. Its failure JSON was preserved.
  This rules out treating earlier operation-only soaks as worker-lifecycle
  acceptance. The fixture interceptor now settles the page target's raw Fetch
  events directly instead of waiting for Puppeteer's Fetch/Network event pairing.
  [The `3cf6f58` rerun](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37942077509/job/113859197474)
  passed the geometry completion preflight, but then failed because worker targets
  do not support `Fetch.enable`. The unsupported worker-target setup has been
  removed. A new preflight must prove worker requests reach the page interceptor:
  local and external synthetic responses must be fulfilled, and an unconfigured
  external request must be observed and blocked. DNS failure alone cannot pass.
  This correction and the full soak still need CI validation; no engine or VM
  change is involved.
- [The `04b49d1` soak](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37942979707/job/113862502404)
  passed both worker network interception and cold/reused/error/recovery geometry
  preflights, then completed ten measured cycles. At 330 seconds it stopped waiting
  for the transient "Opened" status, which had become "Autosaved revision 32."
  The corrected fixture observes status mutations before clicking and latches the
  completion even when autosave immediately replaces it; success, timeout and
  click failure release the observer/timer. Failure reports now include separate
  retained diagnostics without treating a mid-operation state as a plateau
  checkpoint. The interrupted run uses SwiftShader and is neither a 60-minute
  retention pass nor hardware evidence. Its JSON remains in the linked artifact.
- Startup diagnostics in [the Windows `3cf6f58` recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37942077509/job/113859197493)
  identify WebGL initialization failure on the hosted runner. Recovery CI now
  explicitly selects SwiftShader in its disposable fixture browser and asserts
  the actual renderer in each reopen result. Recovery reports never qualify as
  hardware evidence. User Chrome, deployed runtime and hardware-soak renderer
  selection are unchanged. The later `3cdd5cb` run validates this correction.

## Framework consideration

Next.js was considered on 9 October 2026. The reproduced failures involve fixture
request interception, hosted-runner WebGL initialization and transient UI status
observation. A framework migration does not remove those causes. Cesium still
requires browser rendering, workers and lifecycle ownership; Next.js keeps browser
APIs and interactivity in [client components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
Keep the existing implementation and revisit the framework only if a measured
architectural limitation justifies migration cost. No Next.js migration is planned
as a Cesium performance fix.

## Historical evidence continued
- [The historical CI run for `2e0fb80`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37917730204)
  passed Node 24.14.0/26.x suites and production builds, formatting/boundaries,
  Windows onboarding, Linux/macOS installation/profile recovery and the browser
  job, but failed Windows profile recovery while building the prior installation.
  The path canonicalization fix is in `c441832`; the current `dev` tip has a
  pending CI run and is not yet acceptance evidence. The 60-minute rendered soak
  was skipped: it requires manual workflow dispatch with `full_soak=true`. A
  smoke pass does not replace it.
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
- The headed hardware runs for `3f322de` now exercise the real Intel UHD 620
  D3D11 renderer and report `hardwareRenderingValidated: true`. The 60-second
  smoke and five-minute diagnostic completed all mixed-use operations without
  frame stalls or operation failures, and application-owned resource counts
  returned to their warmed values. The five-minute diagnostic still grew browser
  listener counts from 731 to 1,719 and retained JS heap from 67.4 to 74.7 MB;
  it therefore proves the restore fix and hardware path, but is not a 60-minute
  retention pass.
- The older comparisons in [PERFORMANCE.md](PERFORMANCE.md) remain historical.
  No accepted matched comparison against `eb8c682`, post-fix hardware-rendered
  60-minute retention pass, Windows discrete-GPU result or macOS hardware
  candidate result exists yet. No 20% gain or final hardware-support claim is
  established.

The reconciliation itself changes documentation only. Existing checks above are
evidence for their named source commits, not newly run checks of this document
commit. VM deployment and HTTPS/DNS fixes are operational work and do not satisfy
performance acceptance.
