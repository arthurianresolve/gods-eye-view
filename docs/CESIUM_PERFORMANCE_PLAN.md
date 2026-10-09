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
| S48 attribution and resource diagnostics | Partial: bounded opt-in synchronous CPU series for layer updates, CCTV preparation and overlay frames; frame idle classification; actual visual settings and per-owner resource counts | 120 manager/diagnostic tests and package boundaries pass; workload attribution and overhead comparisons remain | Pending traces, allocation profiles and cost attribution |
| S49 worker/lifecycle retention | Partial: stale GeoJSON/cable cleanup and corrected fixture worker interception; isolated lifecycle cases remain | Worker completion/network preflights and 60-minute retention soak pass at `3cdd5cb` | Pending real-GPU resource plateau |
| S50 geometry coalescing | Partial: cursor drain, latest pending record coalescing, cancellation generation, four-ms preparation budget and existing geometry reuse | 62 focused CCTV tests pass, including mid-drain edits, cancellation and budget yielding; full geometry revision matrix remains pending | Pending appearance and build-count comparisons |
| S51 render demand scheduling | Partial: per-owner deadlines and disposable continuous/scheduled/invalidation registration, satellite periodic cadence; full layer rollout remains pending | Deadline, cancellation and owner teardown tests pass; static-frame and cadence acceptance remain pending | Pending static and animated comparisons |
| S52 overlay invalidation | Pending | Pending slice-specific validation | Pending |
| S53 collection uploads | Partial: satellite Cartesian scratch reuse and unchanged-position-write suppression | Existing satellite tests pass; upload/allocation reduction and collection partitioning remain pending | Pending matched comparison |
| S54 infrastructure batching | Pending | Pending slice-specific validation | Pending |
| S55 tracking updates | Pending: existing cached-frame behavior retained | Existing regression coverage passes; planned consolidation has no new acceptance result | Pending tracking comparison |
| S56 fresh-frame capture | Shared completed-frame operation, abort/visibility/timeout/destruction cleanup; preservation default restored pending evidence | 168 focused tests pass including failure paths, concurrent teardown and resized capture | `9b1c18e`: 12 isolated viewer capture checks pass on Windows UHD 620; full application matrix and measured benefit still pending |
| S57 map-resource lifetime | Audited generation guards, cached provider ownership and comparison leases; added numeric cache/pending/memory diagnostics; existing detail/cache targets retained | 37 focused tests pass, including 30 equivalent map-switch cycles and failed/retried/late loads | Pending matched streaming/activation measurements |
| S58 weather/effects | Pending | Pending slice-specific validation | Pending |
| S59 cooperative ingestion | Partial: prepare only the existing 5,000-feature render cohort; four-ms CCTV batches | Import identity/order tests pass; two clean-revision CPU comparisons preserve the cohort and reduce preparation cost | Pending end-to-end import interaction and geometry measurements |
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
not latency measurements. Missing Windows discrete-GPU and physical macOS evidence remains pending. The user has only the Windows UHD 620 machine; VM105 can cover Linux server/recovery checks. Free standard GitHub-hosted runners may supplement these checks, with software, paravirtual and physical rendering identified separately.

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
  render listener or diagnostic readers. Opt-in CPU series now cover the synchronous
  portion of layer updates, CCTV geometry preparation and overlay frames. The
  bounded 128-series/120-sample buffers store identifiers and numbers; overflow is
  explicit. Promise waits are excluded and GPU execution remains unavailable.
  Demand-render intervals explicitly warn that they may include intentional idle.
  The application debug interface can enable or completely disable the new
  monitor/CPU hooks; disabled CPU hooks do not read the clock. Effective settings
  now read the live viewer's resolution, MSAA, FXAA and drawing-buffer mode.
  Complete broader owner accounting and workload attribution. Measure overhead
  separately; an interval
  between rendered frames is not CPU execution time or a GPU duration.
- **S49:** [local GeoJSON](../src/data/localGeojsonCore.js) and
  [cable ingestion](../src/layers/submarineCables/ingestion.js) attempt cleanup
  after stale loads. Reproduce imports, workspace replacement, CCTV, terrain and
  picking independently; trace worker completion/error/cancellation/disposal and
  verify fixture/worker loading. Optional cleanup calls alone do not prove Cesium
  releases ownership. No isolated engine defect or dependency patch is accepted.
- **S50:** [CCTV preparation](../src/layers/cctv/geometryQueue.js) drains through
  a cursor. Pending membership now excludes consumed records, so a later edit
  during a drain is retained and repeated pending edits coalesce. Active-camera
  priority swaps pending slots without shifting the consumed prefix. Each batch
  yields after four ms of application work (one indivisible record may exceed
  that budget), and generation checks reject work after cancellation. Focused
  tests cover reentrant refresh and disabling during work. This is a correctness
  and bounded-work change; no hardware speedup is claimed. Complete source/pose/terrain/parameter revision handling and one latest
  authoritative build per feature; demonstrate no duplicate unchanged builds,
  bounded preparation and immediate disposal of superseded results.
- **S51:** [the governor](../src/renderGovernor.js) exports
  `scheduleRenderUpdate`, and satellites now use a disposable one-second
  scheduled wake while untracked. Tracking retains a continuous hold, and
  disabling the layer disposes the timer. Independent deadlines now share only
  the earliest timer; a slow periodic owner no longer delays an urgent update,
  nor is it executed early. `registerRenderDemand` owns continuous holds,
  scheduled work and explicit invalidation with one disposer; stale owners are
  inert after viewer teardown. Extend this pattern where measured,
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
- **S56:** [fresh-frame capture](../src/freshFrame.js) copies inside `postRender`
  and owns timeout, abort, visibility and destruction cleanup. The viewer cancels
  all pending captures before teardown. Viewport/pointer encoding releases
  temporary surfaces and uses the copied frame's dimensions after resizing.
  [Viewer creation](../src/app/viewer.js) restores `preserveDrawingBuffer: true`
  by default: the earlier false default had no required comparison evidence.
  False remains an explicit constructor option for controlled experiments.
  Complete idle/moving/portrait/resized/restored/hidden-tab browser comparisons
  and measure benefit before changing the default again.
- **S57:** audit and fix superseded map loads and provider/tileset ownership;
  the current controller already guards stale imagery/terrain/tileset completions
  and releases cached owned results at teardown. Thirty equivalent switch cycles
  retain exactly two imagery providers and one terrain provider, without new
  provider construction, active imagery or error-listener growth. New numeric
  diagnostics expose pending factory loads, cache hits/failures and Cesium's
  optional tile-memory estimate (unknown stays null). Uncancellable provider
  promises remain pending until they actually settle, including after teardown.
  Retain bounded warm caches; no arbitrary cache reduction is justified. Compare
  real streaming and activation before claiming a performance improvement.
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

- [Capture matrix at `9b1c18e`](performance-evidence/capture-matrix-9b1c18e.json)
  passes 12 checks in the user's Chrome 154 on Windows using Intel UHD 620
  Direct3D 11, MSAA 4, and DPR 2. Both preservation settings produce the expected
  newly rendered pixels for idle, moved-camera, portrait, resized and restored
  synthetic scenes; destroying the viewer cancels a pending copy. No post-render
  listener accumulates. This isolated application-viewer fixture validates the
  copy mechanism. It does not validate all application effects, hidden-tab
  transitions in a real browser, throughput benefit or the 60-minute GPU soak.

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

## Free hosted validation and bounded import preparation ? 9 October 2026

All local commits through `5328e256460a13edbf1be65397d2faf43e8d3075` were pushed to
`fork/dev`. [Run 37959251555](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37959251555)
validates that exact revision; it is not evidence for later edits. The redundant
push-triggered run was canceled. No VM deployment changed during this validation.

The repository is public. GitHub documents standard public-repository runners as
free, with larger runners billed separately. This task uses only standard
`ubuntu-latest`, `windows-latest` and `macos-latest` jobs for bounded repository
build/test work. Artifact uploads are opt-in; the bounded QA reports are retained
in job logs, which do not consume artifact storage. No paid GPU runner, account
setting change, unrelated workload or hosted production service is used.
[Billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions).

The first probes observed no WebGL 2 on Windows, SwiftShader on Linux, and Apple
Paravirtual Metal on macOS. Linux and macOS passed all twelve isolated capture
checks, but the initial conservative classifier left all hardware evidence
pending. Apple's documented paravirtual framework supplies Metal acceleration;
subsequent probes must also require Chrome's WebGL/WebGL2 feature status to report
`enabled`. A separate hosted accelerated retention run never becomes physical
Mac desktop coverage. [Apple graphics documentation](https://developer.apple.com/documentation/paravirtualizedgraphics).

S59 now prepares only the existing 5,000-feature render cohort instead of cloning
all imported records before applying the same cap. Ordering, source identity,
feature identity, complete stored data and rendered population are preserved.
The unchanged old implementation is embedded in the comparison harness. Two
clean-source runs, each with three warmups and five alternating measurements,
show repeated CPU preparation reductions:

| Source commit | Stored records | Old median ms | Candidate median ms | Selected features |
| --- | ---: | ---: | ---: | ---: |
| `4d90058` | 50,000 | 4.106 | 0.169 | 5,000 |
| `4d90058` | 250,000 | 19.130 | 0.135 | 5,000 |
| `5328e25` | 50,000 | 4.306 | 0.176 | 5,000 |
| `5328e25` | 250,000 | 15.546 | 0.084 | 5,000 |

[First raw report](performance-evidence/import-preparation-4d90058.json) and
[repeat report](performance-evidence/import-preparation-5328e25.json) identify
Windows/Node 24.16 and the exact source revisions. These are Node CPU
microbenchmarks; they exclude parsing, Cesium geometry and GPU rendering and do
not establish an end-to-end frame-time gain or complete S59. Cooperative parsing,
geometry preparation, cancellation and large-import interaction remain pending.
