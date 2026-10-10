# Cesium performance plan

Updated on 10 October 2026. Full runtime CI passes at
`b5b8c92a811f2da5cf53ea08969d4352b4d0eb4c` ([CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38046733687), [job results](performance-evidence/ci-b5b8c92.json)).
Windows UHD 620 isolated capture checks recovered at `0edfb8e` after the manual
foreground check; [raw evidence and limitations](performance-evidence/WINDOWS_FRAME_RECOVERY.md)
are recorded separately from the unresolved earlier stall cause and soak gates.
The subsequent Windows wind check at `a83dd7a` fails its fresh-frame deadline;
the standalone WebGL control also exhibits long frame gaps. The earlier recovery
does not establish a permanent fix; see the new evidence below.
The latest isolated hosted wind/capture checks pass at
`d905f301bd6856a21c9f648200a380f792d29968`; the 60-minute hosted Metal
retention pass belongs to `2e839a449ce32582130b33267a1a276e8cb59224`, not the current tip.
The comparison baseline remains
`eb8c6828d0d03e1c04bda94c8c4fb99915a577b7` (Cesium 1.138.0).

This ledger separates code delivery, automatic checks, and hardware acceptance.
`Partial` means a foundation exists but the full slice contract is not delivered.
`Pending` means the planned change or acceptance evidence remains outstanding;
existing behavior alone does not complete a new slice. No S47-S60 slice has full
acceptance evidence yet. The [S32-S46 ledger](IMPLEMENTATION_PLAN_NEXT.md) retains
the earlier release requirements and historical results.

| Slice | Code implemented | Automatically validated | Hardware validated |
| --- | --- | --- | --- |
| S47 baseline and comparable capture | Partial: density synchronization, observed dense-production comparison export, staged fixture clock, actual tracking endpoints, build identity and before/after condition guards | Unit integrity gates and six-step share/slider/profile/workspace density journey pass at `d70dac9`; matched-run evidence remains pending | Pending matched captures and negative control |
| S48 attribution and resource diagnostics | Partial: bounded opt-in synchronous CPU series for layer updates, CCTV preparation and overlay frames; frame idle classification; actual visual settings and per-owner resource counts | 120 manager/diagnostic tests and package boundaries pass; mock-canvas phase attribution and enabled/disabled overhead reports exist; browser attribution remains | Pending traces, allocation profiles and cost attribution |
| S49 worker/lifecycle retention | Partial: stale GeoJSON/cable and traffic-listener cleanup, corrected worker interception, isolated import/workspace lifecycle runner; CCTV/terrain/picking cases remain | Worker completion/network preflights and 60-minute retention soak pass at `3cdd5cb`; corrected-validator reassessment passes at `5328e25` | Fresh hosted paravirtual Metal retention run passes at `2e839a4`; Windows UHD 620 plateau pending |
| S50 geometry coalescing | Partial: cursor drain, latest pending record coalescing, cancellation generation, four-ms preparation budget and existing geometry reuse | 62 focused CCTV tests pass, including mid-drain edits, cancellation and budget yielding; nine additional source/pose/terrain/parameter reuse cases pass; visual validation remains | Pending appearance and build-count comparisons |
| S51 render demand scheduling | Partial: per-owner deadlines, disposable render demand, satellite cadence and accepted mission scheduling pilot; full layer rollout remains pending | Deadline/cancellation/teardown and focused integrity tests pass; 30 isolated real-viewer trials pass at `7c68cdc` | Hosted Metal mission image/cadence comparison passes at `7c68cdc`; four isolated UHD 620 governor checks pass at `3664f4f`; full application/Windows cadence remains pending |
| S52 overlay invalidation | Layout-cache experiment reverted; broader revision invalidation remains pending | Five-pair Node comparisons improve three fixtures but regress detection; no optimization accepted | Pending |
| S53 collection uploads | Partial: satellite Cartesian scratch reuse and unchanged-position-write suppression; no runtime partitioning accepted | Existing satellite tests pass; repeated controls are pixel-identical but partitioning changes 24 pixels | Hosted Metal visual mismatch reproduced at `9dacb7c`; accepted matched comparison pending |
| S54 infrastructure batching | Partial: S54.1 plain feature records and generation-owned pick mappings; rendering representation remains unchanged | 45 focused identity/lifecycle/picking tests, format, boundaries and production build pass at `89fb2fd`; batching comparisons remain | Pending activation/memory and visual comparison |
| S55 tracking updates | Pending: existing cached-frame behavior retained | Existing regression coverage passes; planned consolidation has no new acceptance result | Pending tracking comparison |
| S56 fresh-frame capture | Shared completed-frame operation, abort/visibility/timeout/destruction cleanup; preservation default restored pending evidence | 168 focused tests pass including failure paths, concurrent teardown and resized capture | `0edfb8e`: fresh 12-check isolated viewer matrix passes on Windows UHD 620; full application matrix, earlier stall cause and measured benefit still pending |
| S57 map-resource lifetime | Audited generation guards, cached provider ownership and comparison leases; added numeric cache/pending/memory diagnostics; existing detail/cache targets retained | 37 focused tests pass, including 30 equivalent map-switch cycles and failed/retried/late loads | Pending matched streaming/activation measurements |
| S58 weather/effects | Partial: retain the current wind scalar image across equal decoded forecasts; broader weather/effect work remains | 223 wind/weather tests pass; three five-pair CPU comparisons preserve raster bytes, reducing repeated image builds to zero | Hosted Metal speed/temperature/pressure pixels match at `d905f30`, with 1,200 paths and 152,736 vertices preserved; full effect matrix and Windows checks remain |
| S59 cooperative ingestion | Partial: bounded render cohort, four-ms normalization/entity/CCTV batches, cancellation ownership and workspace completion guards | Focused tests and full CI at `eb90492` pass; Linux software-rendered ten-capture comparison passes at `ee38af4` | Hosted Metal ten-capture comparison passes at `ee38af4`; two normal Windows UHD 620 ten-capture runs pass at `0edfb8e` after foreground check; earlier stall cause and full interaction acceptance pending |
| S60 final candidate | Pending remaining slices | All CI gates and 60-minute software-rendered soak pass at `3cdd5cb`; subsequent changes require their own exact-commit validation | Pending all required hardware environments |

The visual default remains Manual. Resolution, MSAA, label density, source
populations, tracking behavior, effects, and visual fidelity are not reduced as
a performance shortcut. Auto quality remains opt-in.

### Local S51 integration diagnostics - 10 October 2026

The local Node 24 parallel suite reports 6,684 passes, one failure and ten skips.
The failing camera-stream idle-deadline test passes all 21 tests when its file is
run alone; its real 10 ms producer and 40 ms deadline assume scheduling precision
that a CPU-loaded parallel run cannot guarantee. The deterministic test correction
is recorded below without changing the production timeout. The 14 serialized allocation
gates pass in a separate run. Preserve the failed full run; an isolated pass does
not replace it. [Counts, log digests and scope](performance-evidence/local-s51-checks-20261010.json)
record these working-tree diagnostics. The full suite overlapped edits, so these
results do not certify an immutable candidate or establish GPU performance.

Follow-up implementation by GPT-6 Luna: `b5b8c92a811f2da5cf53ea08969d4352b4d0eb4c`
replaces deadline-test wall-clock sleeps with controlled timer advancement while
retaining real Web/Node streams and backpressure. It verifies delivered bytes,
renewal from the latest chunk, subsequent silent expiration, and awaited cleanup.
No production deadline changed. The camera file passes all 22 tests; root's
combined camera, render-demand and fixture checks pass 37/37. The separate
`8ca3356a5881297fdaa7b94c536524973587d944` supplies the missing fallback-owner
invalidation method and covers it with a regression. The new exact-commit
[full integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38046733687)
targets `b5b8c92` and passes all seven jobs: Node 24/26 unit/build gates, Windows
onboarding, Windows/Linux/macOS install-and-update recovery, and the browser
journeys. This immutable result follows the deterministic test correction; it
does not rewrite the earlier failed local run. Later diagnostic and infrastructure
changes require their own applicable checks. Pull-request-only published-token
checks are outside this branch-dispatch result.

The isolated S51 mission comparison is implemented in
`93bebfc3da5ff4c015ac1578036bf73f4dd47b85` with workflow integration at
`2e1245e6eab0e504bfbad922807aca5693e8c33d`. It exercises the real mission layer
and governor in a minimal Cesium viewer, compares five alternating-order pairs
for empty, unselected-orbit and selected-live scenarios, and retains bounded
fresh-frame pixels, frame counts, source timestamp mappings and cleanup evidence.
Application/harness revisions and the Vite development-fixture recipe are explicit.
Full application UI/world-overlay rendering and physical desktop foreground checks
are outside this fixture. Nine fixture/runner checks pass. The
[frozen native hosted comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38046523488)
tests `2e1245e` and failed report validation after completing all 30 browser trials.
[Original report](performance-evidence/mission-render-demand-38046523488.json) and
[job result](performance-evidence/mission-render-demand-38046523488-run.json)
preserve that failure. Populations remain unchanged and all 15 control/candidate
PNG pairs match byte-for-byte; all 30 artifact digests were verified. The static
candidate renders zero measured frames in each ten-second trial versus 256-292
for the continuous control; unselected orbit trials render six versus 78-96 in
three seconds. Selected live missions retain continuous rendering. Owner/viewer
cleanup succeeds and normal browser close takes 455.57 ms without forced cleanup.
These observations use hosted Apple Paravirtual Metal, not the Windows desktop.
The [retained image manifest](performance-evidence/mission-render-demand-38046523488-images/manifest.json)
maps all 30 images to three unedited, byte-identical retained files, preserving
reviewable image evidence beyond the hosted artifact retention period.

The validator incorrectly groups exact camera-vector equality with population
integrity: render-time floating-point differences around `2e-16` trigger its
population error. It also compares varying camera-flight setup durations as
controlled inputs. Correcting the validator requires bounded existing pose
tolerances and separate setup-timing validation, while preserving strict
population, settings and image checks. The failed run is not an acceptance pass;
the runtime pilot remains pending that correction and end-to-end verification.

GPT-6 Luna's validator correction is committed at
`7c68cdcd1fb57259a57ff30588ed1e60009007b1`. It separates flight setup duration from
controlled inputs, retains its five-second bound, applies existing `1e-6` metre
position and `1e-12` orientation tolerances, and verifies exact identities,
resource counts, source epochs, dimensions, visual settings and image hashes.
All 59 combined lifecycle, mission, capture-integrity and paired-report tests
pass. The [offline reassessment](performance-evidence/mission-render-demand-38046523488-reassessment.json)
passes for the original `2e1245e` observations without rewriting their failed CI
status or claiming a new measurement. The [fresh end-to-end run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38047705551)
tests `7c68cdc` and passes all 30 trials (15 alternating-order pairs) in 277.3
seconds. [Raw report](performance-evidence/mission-render-demand-38047705551.json),
[job result](performance-evidence/mission-render-demand-38047705551-run.json) and
[retained image manifest](performance-evidence/mission-render-demand-38047705551-images/manifest.json)
identify the exact source and observations. All 30 PNG digests were checked and
all 15 pairs match exactly; the two nonempty scenario images were visually
reviewed. The actual renderer is Apple Paravirtual Metal. Median measured frames
are 235 versus zero over ten seconds for the static scene, 51 versus five over
three seconds for unselected orbits, and 53 versus 50 for selected live missions.
Selected missions retain continuous mode and moving position samples; every
trial releases its layer/viewer/render owners. Page, browser and Vite cleanup
succeed; normal browser close takes 649.68 ms without forced termination.

This accepts the bounded mission scheduling pilot's isolated correctness and
render-demand reduction. It does not establish full application UI/overlay
equivalence, latency improvement, a Windows hardware result, the final 20% target,
or completion of S51. Frame counts are render-demand observations, not CPU/GPU
execution timings. The earlier failed CI and offline reassessment stay historical.

### S49 bounded worker-quiescence history - 10 October 2026

GPT-6 Luna implementation `e2f65cd4b66e1e654bf1c59ca6a3c36e224d4b69` replaces
opaque polling with an in-page timeline capped at 202 samples and 64 worker
records per sample. It records per-kind submitted/completed/pending counts,
pending age, first observed zero, maximum polling gap and a second zero check.
Negative, missing, overflowed or inconsistent counters fail validation. Transient
zero followed by new work fails; zero observed after the original ten-second
deadline stays a timeout. Host failure cancels the owned poll before collecting
available evidence. No provider payloads or worker URLs are retained.

All 29 focused lifecycle tests pass, including late-zero, resumed-work,
bounded-history, invalid-counter and cancellation cases; syntax, targeted format
and diff checks pass. The [changed hosted lifecycle diagnostic](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38047474920)
tests this exact commit and fails after 75.6 seconds. Both preflights had zero
pending work immediately, so the new poll-history path was not exercised in
this particular run. Workspace replacement passes all five cycles with unchanged
owned scene resources and feature identities. Cooperative import completes its
warmup load but times out in the ten-second `warmup-drain` gate before measured
cycles. The later failure observation has zero import features/jobs/cache entries
and zero pending workers; that later snapshot cannot satisfy the expired gate.
Heightmap submissions rose from 7 to 87 and terrain-picker submissions from 7 to
23 between the initial and failure snapshots. The empty-population render had
completed. Browser close succeeds normally in 94.82 ms without forced termination.
[Raw report](performance-evidence/lifecycle-38047474920.json) and
[job result](performance-evidence/lifecycle-38047474920-run.json) retain the failure.
Further diagnosis must observe the drain predicate during its existing deadline;
an unchanged rerun or longer timeout is not a fix. The earlier retention failure
remains unresolved while independent implementation proceeds.

### S54.1 infrastructure identity separation - 10 October 2026

GPT-6 Luna delivered `0d62562a1ccd764a87f2cf1b6ebbdc9dc9ef2bc1` plus explicit
destroy-map cleanup in `89fb2fdefe5328d46c0174db5de441587ad976a1`. Datacenter/dam
analyst records now use plain feature metadata and the existing Cesium-derived
center independently of mutable entity properties. Existing query/context IDs,
OSM evidence identity and PeeringDB references remain intact. Cable geometry
and reference stems share one immutable source identity. Both layer paths reject
old render objects after ownership is released. A cable styling failure after
source insertion rolls back accepted sources and identity records; an automatic
retry restores overlay visibility without requiring another enable.

All 45 focused tests pass across `localGeojson.analyst`, `localGeojsonLifecycle`,
cable `geometry`/`interaction` and `telegeographySubmarineCables`. They cover
duplicate names, missing metadata, unchanged centers, cleared entity properties,
detached evidence snapshots, same-identity rebuilds, stale picks and failed-load
rollback/retry. At clean `89fb2fd`, root's full format check passes all 1,445
adopted source files, both import/package boundary checks pass, and the production
build succeeds (Node 24.16.0, Windows). This completes the S54.1 code packet;
batching, activation/memory measurements and hardware comparison remain pending.
The renderer, geometry parameters and visual quality settings are unchanged.

## Completion execution plan - 9 October 2026

This section is the forward work order. The ledger above reports delivered work;
older reconciliation notes and reports below are historical and do not override
this queue. Updating this plan does not change a slice to implemented or passed.
The restart point is clean `dev` at `93caf86405a56ba56dbcca72e16eaf23a35e32d6`.
The original comparison baseline remains `eb8c682`; use both full SHAs in evidence.

The user selected **GPT-6 Luna** to execute implementation after the originally
requested GPT-5.6 Luna was unavailable in this session's executor. Assign one
bounded work packet at a time to `gpt-6-luna`; the coordinating agent reviews the
patch and evidence, integrates commits and operates deployment. Record the actual
executor in each packet result. Do not silently substitute a model. Browser work
must use the authorized Chrome connection; repository automation on GitHub may
use its existing browser harness. Do not bypass a denied browser surface with a
second runtime.

### Completion rules and available environments

- **Implemented:** the complete packet behavior exists, ownership and compatibility
  checks pass, and its reversible commit is identified. A helper or passing old
  tests alone is not completion of a new behavior.
- **Automatically validated:** named focused tests, integration gates and artifacts
  identify the source they actually tested. Skipped, canceled, unavailable and
  failed checks stay distinct. Green CI never implies completion of this plan.
- **Hardware validated:** matched results identify the renderer and environment;
  software rendering, hosted paravirtual Metal and a physical desktop are separate.
- **Experiment rejected:** retain the reproducer, measurements and reason, revert
  the runtime change, and assess another design. A rejection closes that experiment,
  not unrelated deliverables in its parent slice. A no-change disposition for a
  complete optimization requires evidence covering the original contract.
- **All done:** every packet has an accepted implementation or an evidenced
  no-change disposition, all required available-environment checks pass on the
  frozen candidate, documentation and deployment agree, and remaining unavailable
  coverage is explicitly reported. If a required available-machine check fails,
  report the failure; do not label the plan fully accepted. The 20% objective is
  reported separately as achieved or not achieved.

| Environment | Work to execute | What it cannot establish |
| --- | --- | --- |
| User's Windows / Intel UHD 620 | Primary foreground visual comparisons, five paired runs per workload, interaction checks, capture matrix, tracking journeys and 60-minute retention soak | Other GPUs or operating systems |
| VM105 / Linux | Node 24/26 where supported, install/upgrade/rollback, application/API health, worker assets, deployment and persistence | Windows rendering or GPU performance without a verified physical renderer |
| Free standard GitHub Linux/Windows/macOS runners | Existing CI/recovery suites, bounded fixture jobs, software or verified hosted Metal visual/retention supplements | Physical Mac or discrete Windows GPU coverage; software results are not GPU evidence |
| Unavailable discrete Windows GPU / physical Mac | Keep original matrix entries unavailable and support claims unverified | These missing machines do not block independent implementation or pretend to pass |

Use free standard public-repository runners only, with bounded project tests,
limited retained artifacts and no paid GPU/larger runners. Keep tests independent
of live providers. Do not replace VM105, change DNS/TLS, or disturb the working
`vision.macarthur.systems` deployment while preparing the candidate.

### Execution order and checkpoint discipline

1. **A - make comparisons executable:** S47.1, S48.1, S49.1 and S50.1. Run the
   existing tests first; repair concrete fixture/counter faults before optimizing.
2. **B - finish scheduling and overlays:** S51.1, S52.1-S52.2, S53.1-S53.2.
   Instrument before changing hot paths; retain only fidelity-preserving wins.
3. **C - deliver the untouched work:** S54.1-S54.3 and S55.1-S55.2. Shared
   representation and frame-context changes land separately from renderer changes.
4. **D - close remaining resource paths:** S56.1, S57.1, S58.1 and S59.1-S59.2.
   Independent audits/fixtures may proceed during B/C; dependent runtime changes
   wait for the needed interfaces and focused ownership checks.
5. **E - qualify and deliver:** S60.1-S60.3; freeze code, run exact-revision
   comparisons/soaks, report outcomes, then deploy the verified development build.

Dependencies are local technical gates, not a reason to wait for unavailable
hardware: S51 needs the S49/S50 ownership checks; S52 needs S51 invalidation;
S53 needs measured overlay costs; S54 needs S49/S50/S53 identity and collection
contracts; S55 needs S53 tracked/fleet separation; S58 uses the S51/S56 lifecycle
contracts; S59 uses S50/S54 preparation boundaries. Failed correctness or visual
checks block the affected change. Missing global performance evidence leaves its
acceptance pending while other independent packets continue.

For each packet deliver one reviewable commit, meaningful behavior tests, and a
result record with packet ID, executor, source/harness/baseline SHAs, changed
paths, commands, exit results, raw artifact paths/digests, measured outcome,
remaining acceptance and next packet. Append evidence without rewriting failures.
Commit generated evidence after measuring the clean code commit; its parent SHA
remains the tested revision. Do not claim the later report-only commit was tested.

A green checkpoint is not a stopping point. After review, start the next ready
packet without asking for permission again. After two controlled reproductions
of an unchanged failure with no new discriminating evidence, preserve the failure
and continue another ready packet. This limits repeated diagnosis, not testing
requirements. Resume diagnosis with a specific hypothesis and a new control.

### A - measurements, retention and geometry ownership

**S47.1 - workload registry and paired comparison validation.**

- Extend `scripts/performance/` and `scripts/capture-scene-performance.mjs` with
  versioned, deterministic workload descriptors: fixture hashes, fixed time,
  route, selected identity, layer counts, effective settings, browser/renderer,
  viewport/DPR and drawing buffer. Keep application and harness commits separate.
- Baseline compatibility is required work in S47.1b: `eb8c682` has neither
  `src/performance/performanceSnapshot.js` nor the current runtime build-identity
  hooks (verified with `git show`/`git grep`). Use a shared harness-side observer
  over common scene APIs and independently verified build-artifact identity for
  both revisions. Bind served asset hashes to a clean checkout and build recipe;
  a supplied expected SHA alone is not proof of the loaded application. Keep
  candidate-only diagnostics off during paired latency runs. If instrumentation
  must patch baseline code, record its separate patch/hash and changed-source
  status; never call that an unchanged clean `eb8c682` run. Reject unsupported
  identity paths rather than silently substituting a later baseline.
- Match fixture delivery to the build being verified: today's aircraft injection
  hook is Vite-development-only. A production artifact cannot be treated as an
  equivalent fixture run by assuming that hook exists. Use controlled provider
  responses through existing source boundaries for both artifacts, or explicitly
  verify and label a common development-build recipe. Do not add a production
  test backdoor or compare development against production without disclosure.
- Cover the operating Austin view; dense 2,500 aircraft + 4,362 datacenters +
  716 dams; fixed selected tracking/cockpit/replay; individual/combined
  infrastructure; fixed weather/wind/effects; lifecycle stress; deterministic
  terrain/tiles streaming. Record live-provider checks separately.
- Add a paired-report validator requiring five baseline and five candidate runs,
  each with 30-second warmup/60-second measurement, matched absolute-time routes,
  Manual/Dense 75%, unchanged resolution/MSAA/effects/populations and foreground
  continuity. Cold activation is a separate result. Reject dirty/wrong builds,
  mismatches, insufficient samples and missing renderer/fixture identities.
- Verify a deliberately injected delay fails the actual motion gate. Test malformed
  reports, changed conditions, no frames and the negative control; retain all raw
  runs. Existing capture guards are reused, not replaced by a weaker schema.
- **Exit:** executable descriptors and comparison validation cover every workload;
  available browser paths can export those records. Full paired hardware captures
  are S60 acceptance, not a prerequisite to writing subsequent code.

**S48.1 - ownership coverage and attributable costs.**

- Extend existing `src/performance/` hooks for application geometry preparation,
  tracked-object work, overlays and layer updates. Inventory every application
  listener/timer/render hold/job/cache/primitive/data-source owner; classify
  cumulative counters separately from current resources.
- Add bounded workload summaries and leading measured CPU phases. Keep rendered
  intervals, CPU time, intentional idle and measured GPU time separate; unsupported
  values stay null. Disabled instrumentation installs no owners and reads no clock.
- Capture browser traces/allocation evidence separately from latency runs through
  permitted tooling. Measure enabled/disabled overhead with five alternating pairs;
  if material, keep profiling off in acceptance runs and document the cost.
- **Exit:** all measured owners have create/dispose accounting, diagnostic buffers
  are bounded, and every workload has either attribution or a named unavailable
  metric. Node mock-canvas results are labeled as such.

**S49.1 - isolated lifecycle regressions and Windows failure diagnosis.**

- Build separate fixture cycles for imports, workspace replacement, CCTV toggles,
  terrain and picking. Use corrected worker interception; preflight worker URLs,
  status/MIME and submission/completion/error paths before collecting retention.
- At equal warmed checkpoints, drain bounded pending work and compare listeners,
  jobs, data sources, primitives and caches. Test disposal while work is outstanding,
  late success/error, malformed data and cancellation. Store job ages, not provider
  payloads. Fix the responsible owner only; keep Cesium pinned unless an independent
  engine reproduction justifies a separate dependency patch.
- Windows diagnosis: use the same population, build, frame deadline and dimensions;
  compare empty viewer, static loaded viewer, synchronous/cooperative import and
  repeated create/destroy, with visible/focused state and RAF/update/render/timer
  counts. Existing readback-free and governor-free failures remain evidence. A
  passing stripped scene is diagnostic, not a substitute for the full workload.
- **Exit:** each isolated case returns to warmed ownership with no abandoned work.
  Windows frame failure requires a demonstrated fix or remains an explicit S60
  blocker; it cannot be declared a driver defect from missing callbacks alone.

**S50.1 - complete geometry revision and visibility reuse.**

- Audit `src/layers/cctv/geometryQueue.js` and callers for every source, pose,
  terrain and parameter revision. Keep one latest queued build per stable feature;
  preserve compatible materialized geometry across visibility changes.
- Measure build submissions, completions, superseded-result disposal and retained
  ownership for unchanged restore/toggle and rapid edits. Ensure terrain revision
  invalidates correctly, disabled layers cannot resurrect, cursor batches remain
  bounded, and selection/frusta/coverage retain exact inputs and appearance.
- **Exit:** unchanged cycles submit zero duplicate builds; rapid edits publish only
  the latest result, and source/pose/terrain/parameter plus visual fixtures pass.

### B - render scheduling, overlays and collections

**S51.1 - complete render-demand adoption.** Inventory layer callbacks and holds in
`src/app/layers/`, `src/layers/` and `src/renderGovernor.js`. Replace continuous
holds only for measured periodic visual work; retain them for tracking,
interpolation, wind, fades, projection and camera motion. Gate hidden/preUpdate
work separately from collection. Test data arrival, selection, resize, visibility
resume, cancel and final transition frame. Exit with at most two rendered frames
in ten settled seconds, correct declared periodic cadence and zero owners after
teardown, first isolated and then in the full application.

**S52.1 - projection and placement invalidation.** Add explicit revisions in
`src/overlays/worldOverlay.js` and the overlay host for camera pose, viewport/DPR,
source positions, selection, style and UI occlusion. Cache only stages whose full
inputs are unchanged; preserve stable identities and pooled records. Test one
input mutation at a time, including panel movement, horizon changes and zoom.
Exit with no repeat projection/layout on unchanged input and identical cohorts,
placement, hit regions and accessible actions.

**S52.2 - text preparation and conditional painting.** Cache bounded text/style
preparation; include opacity/fade/animation phase in paint invalidation. Keep the
accessible mirror and picking consistent with the actual painted frame. Revisit
the rejected detection regression using five alternating pairs for all overlay
fixtures; do not reapply `a63096b` unchanged. Exit with identical visible content
and repeatable browser benefit; no repeatable >10% workload regression.

**S53.1 - collection write/allocation reduction.** Audit satellite and flight hot
paths; reuse Cartesian/scratch records, batch membership and suppress unchanged
property writes. Count actual mutations, buffer uploads/bytes and allocations
separately from estimated CPU cost. Test selected objects, focus, horizon, opacity
and recovery at unchanged populations/cadence.

**S53.2 - tracked/fleet collection experiment.** Compare a small number of
frequency-based collections with the current representation. Preserve blend/depth
ordering and fading; use specialized blending only with proven opacity semantics.
Explain the prior 24-pixel mismatch before accepting a new split. Exit with
repeatable upload/allocation benefit and strict identical-scene visual/identity
checks. Reject a split that still changes pixels; document a complete no-change
disposition only after the applicable alternatives are measured.

### C - infrastructure and tracking implementation

**S54.1 - separate infrastructure records from rendering.** In
`src/data/localGeojsonCore.js`, `src/data/infrastructure.js` and cable ingestion,
introduce a lightweight stable feature-to-render/pick mapping. Preserve duplicate
names, evidence/references, legacy query IDs, analyst results, pinning and workspace
persistence. Keep current rendering in this first commit; test identity round trips
and cleanup without silently changing imported user geometry.

**S54.2 - batch compatible static infrastructure.** Convert repeated datacenter/dam
points and stems into shared collections/geometry instances within existing
spatial/LOD partitions. Preserve camera-height stem scaling, ground sampling,
colors, opacity, depth behavior, focus/selection and per-feature picking. Batch
compatible cable geometry only where the same appearance can be demonstrated;
retain specialized paths otherwise. Release temporary construction arrays after
ownership transfer and cancel/dispose superseded results. Do not retain hidden
GeoJSON entity data sources merely to avoid construction.

**S54.3 - validate infrastructure activation and memory.** Run all three layers
individually and together, dense bundled populations, duplicate names and missing
metadata. Compare repeated activation, retained ownership and full-pose pixels,
including terrain and LOD boundaries. Exit with lower activation cost or retained
memory, no >10% repeatable regression elsewhere, and unchanged selection/evidence.
S54 stays unimplemented until S54.1 and an accepted rendering disposition exist.

**S55.1 - authoritative tracked-frame context.** Inspect
`src/layers/flights/tracking.js`, `rendering.js`, other tracking modules and
`src/data/trackedCamera.js`. Share one time sample, position/orientation and camera
pose/projection result per tracked frame. Keep fleet maintenance outside that path;
avoid redundant transforms and writes without quantizing real motion. Introduce
no second camera owner. Test same-time reuse and invalidation after identity,
trajectory, replay time and ownership changes.

**S55.2 - tracking transitions and matched motion.** Exercise manual navigation,
aircraft follow, cockpit, CCTV, replay seeks, loss/reacquisition and layer disable.
Run `npm run test:track` in supported browser automation and the fixed trajectory
journey, compare selected model count, readout/label/time alignment, jumps and drift.
Exit with unchanged authority transitions and repeatable improvement in tracking
p95/long tasks; the final 20% objective remains a separate S60 result.

### D - capture, streaming, effects and ingestion

**S56.1 - finish capture validation and preservation decision.** Verify all viewport
and pointer capture callers use `src/freshFrame.js`; audit copied-image encoding
and surface cleanup on success, timeout, hidden tab, abort, resize and destruction.
Run idle/moving/portrait/resized/restored/hidden application scenes with true/false
preservation at equal resolution/MSAA/effects and unchanged size limits. Preserve
the 400 ms fixture deadline. Enable false only after freshness, no-black-frame,
resource cleanup and repeatable benefit pass; otherwise record the measured
no-change outcome and keep true. An isolated capture pass is not the full matrix.

**S57.1 - streaming lifetime and request comparisons.** Extend existing map fixtures
and `src/maps/` tests with deterministic imagery/terrain/tiles, rapid switching,
comparison leases, failures, retries and late completion. Track active providers,
cache ownership, duplicate requests, loading stalls and actual tile memory when
available. Run matched routes and equivalent warmed switch checkpoints. Exit with
bounded owners, no duplicate active providers, unchanged detail/SSE/textures/
collision/attribution and no repeatable >10% activation/loading regression. Keep
live checks separately labeled; do not reduce Google cache limits as a shortcut.

**S58.1 - weather frame and effect ownership.** Preserve the accepted wind-image
reuse and extend `src/layers/weather/`, wind and `src/ui/effects.js` only where
measurements find duplicate texture/geometry/pass work. Reuse equivalent resources,
update animation uniforms, skip fully invisible contributions and release retired
frames/intermediate targets. Compare frame times, paths, vertices, colors,
transparency and effect strength for pause/resume, reduced motion, source changes
and map-host changes. Exit with an unchanged full effect matrix, bounded ownership
and measured benefit, or an evidenced no-change disposition for each rejected pass.

**S59.1 - bounded document decoding and single-feature preparation.** Extend the
existing cooperative import path rather than adding an unrelated queue. Measure
JSON/CSV/XML decoding and a 50,000-vertex line/polygon with holes. Prototype chunked
or existing-worker preprocessing with bounded messages/backpressure; keep DOM and
Cesium on the main thread. Preserve all stored records, current 5,000-feature render
cap, order, coordinates, identity and evidence. Target <=4 ms application batches;
measure total completion as well as maximum task. Do not reintroduce the rejected
71-92% completion regression. Test cancellation, worker failure, malformed data,
replacement and destruction with no partial publication or orphan jobs.

**S59.2 - UI/catalog maintenance and interaction.** Coalesce obsolete refreshes,
write DOM only when values change and keep progress cadence bounded. Preserve
selection across refreshes and reject stale workspace/source completions. Test
rapid imports, workspace switching and catalog updates; exit with complete data,
local-control p95 <=100 ms and loaded replay-seek p95 <=250 ms on the primary
machine. Unit task budgets alone are insufficient to assert interaction acceptance.

### E - candidate evidence, final verification and deployment

**S60.1 - consumable performance acceptance.** Extend
`scripts/qa-candidate.mjs` additively with named performance comparison, visual,
interaction and retention evidence (or a validated linked performance report).
Preserve version-1 manifests and pre-release/post-publication separation. Bind all
results to full candidate SHA and artifact digest, keep environment-level outcomes,
and reject duplicate/malformed checks, wrong commits, missing files, absent
hardware identity, invalid five-pair reports and failed retention. Unavailable
physical hardware remains unavailable; do not replace it with hosted results or
turn a target miss into a pass. Keep older release human-review requirements visible
in `docs/IMPLEMENTATION_PLAN_NEXT.md`; this performance plan does not waive them.

**S60.2 - freeze and run the full available matrix.**

1. Freeze a clean code SHA after A-D review. Run formatting, package boundaries,
   Node 24/26 suites, builds, Windows onboarding, install/profile recovery,
   browser journeys, capture and tracking gates. Inspect individual job steps;
   canceled/skipped jobs are not passes. Use separate immutable baseline/candidate
   checkouts and the same browser/harness/fixtures. No competing build or profiling
   load during latency samples.
2. Run five matched baseline/candidate pairs per workload, 30-second warmup and
   60-second measurement each; retain individual runs, cold activation, effective
   settings/populations, absolute camera route, exact renderer and OS/browser
   versions. Fixed-pose/time screenshots require explained nondeterministic masks;
   never mask changed detail, selected features or rendering defects.
3. Run separate 60-minute fixture mixed-use retention soaks with periodic post-GC
   checkpoints. Require equal warmed application-owned counts, no persistent
   upward trend and final-30-minute retained-heap growth <=5%. Compare failures,
   oldest jobs and resource classes, not only an overall boolean. The Windows
   primary run is required; repeat hosted/Linux evidence remains supplemental.
4. Investigate any repeatable >10% motion p95, activation, peak heap or retained
   resource regression; the dense/tracking objective is >=20% reduction in median
   run-level motion p95. If a fix changes code, freeze a new SHA and rerun affected
   comparisons plus final integration; earlier artifacts remain historical.
5. Produce a report with implemented/automatic/hardware status, raw artifact hashes,
   exact revisions and explicit failed/pending/unavailable items. Update this ledger,
   S44 and `docs/PERFORMANCE.md`. Do not manufacture a new untested candidate by
   attributing a tested code SHA to a later documentation-only commit.

**S60.3 - deliver dev and verify VM105.** Push all accepted commits to remote `dev`
and verify matching SHAs with no unexplained local commits. After candidate checks,
record VM105's current build and recoverable deployment/configuration, preserve
secrets and user/workspace storage, deploy that exact code artifact through the
existing HTTPS setup, and verify served build identity, worker assets, API health,
workspace reopen, evidence references and camera recovery. Keep VM105 and
`vision.macarthur.systems`; rollback the application if verification fails. Record
the tested code SHA and documentation tip separately. Stable publication still
requires the existing attestation/tag/release and human-review gates; a dev update
does not assert stable release readiness.

### First executor packet

Start with **S47.1a: a pure paired-report validator and meaningful negative tests**,
reusing `captureIntegrity.mjs`. It must reject insufficient/mismatched evidence
before anyone can claim a performance win. Then connect the workload descriptors
and baseline-compatible capture/export path in S47.1b, followed by S48.1 and the
isolated S49 cases.
The coordinator reviews each result and dispatches the next ready packet; a
partial packet remains partial and cannot close the parent slice.

### Execution results for the revised plan

- **S47.1a implemented by GPT-6 Luna:** `af74f183fbb1f6775346a98ad5f99729937c83fd`
  adds [paired report validation](../scripts/performance/pairedReport.mjs) and
  registers its eight new tests in the normal suite. The coordinator's combined
  run includes four existing capture-integrity and four motion-budget tests:
  **16 passed**. [Raw focused result](performance-evidence/paired-validator-af74f18.json)
  records the exact code commit and command. Formatting and package boundaries
  also pass. The API separates comparability, per-workload deltas, objective
  achievement and regression flags; unknown idle timing stays unavailable.
- **S47.1 remains partial:** real capture reports do not yet emit the required
  fixture/time/full-route contract or verified served-build provenance. A passing
  pure validator is not a matched browser comparison. S47.1b-1 provides the build-provenance foundation below;
  workload export remains to be integrated. The baseline-compatible observer and
  capture receipt integration are implemented in S47.1b-2 below. No application
  runtime, VM deployment or visual default changed here.
- **S47.1b-1 implemented by GPT-6 Luna:** `69ea815` adds
  [local build provenance](../scripts/performance/buildProvenance.mjs), corrected
  in `80d7c7369ce9470a5abe7ce381ecce7f1b42968e`. The correction removes literal
  quotes from npm's output argument (the original fixture had masked them) and
  rechecks the harness after building. Creation runs a locked install and fresh
  build in an explicitly named isolated checkout, refuses reused output and
  shared dependency junctions, and records source/harness/recipe and asset hashes.
  Separate loopback verification checks bounded streamed responses against that
  unsigned receipt. It neither updates VM105 nor establishes release attestation.
  The [combined focused result](performance-evidence/measurement-foundations-80d7c73.json)
  identifies the exact tested code. This foundation is extended by S47.1b-2 below.
- **S47.1b-2 implemented by GPT-6 Luna:**
  `17449d2604475f11175dc227f0c6809b9598fa0d` integrates the clean-build receipt into
  the capture CLI and adds a shared observer using scene APIs available in the
  unchanged baseline. It verifies served asset bytes before and after capture,
  binds the actual harness checkout and application entry point, rejects redirects
  outside that entry, and records effective settings, populations and the measured
  camera route. Candidate-only runtime diagnostics remain disabled for comparisons.
  The coordinator's [30-test focused result](performance-evidence/capture-provenance-17449d2.json)
  passes, including local builds and negative provenance, settings and route cases.
  These are Node/loopback checks, not an actual application browser comparison.
  Receipts remain unsigned; browser response bytes are not independently attested.
  The current CLI code-request audit substantiates script paths only.
- **S47.1b remaining:** exercise both actual production builds on the same bounded
  hosted browser path, then implement observed deterministic provider-fixture
  delivery and the full workload/time/route contract. Until that delivery exists,
  capture reports explicitly set `comparisonEligible: false`; the paired validator
  rejects them. A supplied fixture hash or commit string cannot make a report
  comparable. No hardware or performance objective pass is claimed by this packet.
- **S47.1b-3 hosted integration runner implemented by GPT-6 Luna:**
  `7b925c096f1051a6da6c657df4cbbf7b5b29d517` adds a bounded, manually dispatched
  `performance-build-smoke` CI mode on standard `ubuntu-latest`. It builds isolated
  immutable baseline/candidate checkouts, uses one explicitly software-rendered
  Chrome, and exercises shared receipt, observer and route interfaces without
  adding application runtime hooks. Failed artifacts are retained. The initial
  [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38029107526)
  fails before application navigation: the worker-network preflight ran on the
  initial `about:blank` page and its worker failed. The [raw artifact](performance-evidence/build-smoke-38029107526.json)
  identifies baseline `eb8c682`, candidate `7b925c0` and harness `ac9cbc0`. The
  baseline build and pre-capture served-byte verification completed, but neither
  production-page observation nor candidate inspection passed. Fix the preflight
  origin/order before repeating; do not count this as browser compatibility.
- **S47.1b-3 second hosted attempt:** `64c1c87` moves the worker-network
  preflight to an exact same-origin inert page and excludes its deliberately
  generated requests from application auditing. All seven focused contract tests
  pass. The [next hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38029434755)
  passes that preflight and reaches the baseline application and shared scene
  observer, but fails the final code-path audit. The [raw failure](performance-evidence/build-smoke-38029434755.json)
  has no page or interception errors. It does not yet identify the offending
  request; worker provenance needs diagnosis before this integration can pass.
  Candidate inspection still has not executed. No application runtime changed.
- **S47.1b-3 target-disposal control:** `c49f553` requires the preflight's
  worker targets to disappear before application navigation. Ten focused tests
  pass. The [hosted control](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38029942820)
  passes the new disposal check but still fails the audit, now identifying a
  same-origin `blob:` script request. The [raw artifact](performance-evidence/build-smoke-38029942820.json)
  leaves its exact source unresolved. Delayed preflight request events remain a
  hypothesis; isolate application event collection at the navigation boundary
  before changing any code-provenance policy.
- **S47.1b-3 production-worker investigation:** `98d2966` starts request
  collection only after the preflight and its target-disposal wait; eleven focused
  tests pass. The [next run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38030203352)
  still fails on a same-origin blob script ([raw artifact](performance-evidence/build-smoke-38030203352.json)).
  The preflight theory is not established. Static inspection identifies a missing
  production-build contract: [the build configuration](../build/vite.js) documents
  that bundled Cesium workers use `importScripts(blob:...)`. The locked Cesium
  bundle assigns a base64 literal to `globalThis.CESIUM_WORKERS`; its decoded
  worker script can be derived from the verified parent asset without evaluation.
  Validate that script and its narrowly defined bootstrap wrapper before accepting
  blob requests. Until this is implemented and exercised, the smoke stays failed;
  provider-fixture implementation can proceed independently. `87a9b46` additionally
  rejects request-audit buffer overflow instead of silently dropping code events.
- **S47.1b-4 production provider fixture implemented by GPT-6 Luna:**
  `597ffe868d1cf47559a99ec00552207df3d4ef67` adds
  `--provider-fixture dense-investigation --mixed-layers` to the verified-build
  capture path. The deterministic 2,500-aircraft OpenSky payload enters through
  the normal same-origin `/api/flights` source. Delivery is recorded only after
  CDP acknowledges the exact response bytes; failed acknowledgements, different
  bytes, wrong populations and late interception errors cannot pass. A fixed
  starting epoch advances with the native monotonic clock while preserving
  callable/constructed Date behavior, timers and RAF. The coordinator's
  [14-test fixture, observer and integrity result](performance-evidence/production-fixture-597ffe8.json)
  passes, including the actual flight-source normalizer and freshness boundary.
  This is a static-count integration fixture, not the moving/time-reset contract
  needed for matched performance samples. Production-browser population checks,
  embedded-worker validation and the remaining workload registry are pending;
  reports continue to set `comparisonEligible: false`.
- **S47.1b-5 embedded-worker provenance and dense smoke implemented by GPT-6 Luna:**
  `67138ef` and `464ba3bae13e17ca5fd4f2b0e899876a83e039f9` derive the
  production worker source from the hash-verified Cesium bundle, reproducing
  browser `atob`/Blob encoding without evaluating it. Only the exact source
  and narrow bootstrap for a receipted worker module can satisfy the blob-code
  audit. Script Blob and target histories have count/byte limits; overflow fails
  the run, and teardown restores the URL API and releases retained references.
  The capture CLI uses the same diagnostic contract. The hosted smoke activates
  the normal aircraft/datacenter/dam layers with identical fixed-epoch provider
  bytes across revisions and verifies 2,500/4,362/716 populations before and after
  observation. [28 focused Node checks](performance-evidence/worker-fixture-464ba3b.json)
  pass. [Hosted integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38032000589)
  [fails at the final code audit](performance-evidence/build-smoke-38032000589.json):
  a blob request is outside the set associated with validated worker targets.
  The run reaches the final audit without page/interception errors, but does not
  preserve individual population observations on that failure path; those checks
  are therefore not published as an independent pass. Candidate inspection does
  not run. Hash/size and target-membership diagnostics are needed to distinguish
  a missed short-lived target from unexpected code; no browser pass is claimed. This creation
  audit retains bounded script references and is diagnostic instrumentation,
  not an accepted latency/retention measurement configuration. Longer samples
  still require deterministic timestamp/position progression and phase resets.
- **S47.1b production integration now exercised on both immutable builds:**
  diagnostic-only harness `a2cf58fa254ee6169f92d07d7f0cd6d7484fa7f3`
  adds URL-free blob hashes/sizes, target membership and partial population
  checkpoints without relaxing validation. [Run 38032346867](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38032346867)
  [passes both builds](performance-evidence/build-smoke-38032346867.json): baseline
  `eb8c682` and candidate `464ba3b` serve verified assets, acknowledge identical
  fixture bytes (SHA-256 `953f5cf6958732dad75004605e845545e59345d8d259615cbda7a4bf2e863fc8`),
  and retain 2,500 aircraft, 4,362 datacenters and 716 dams. Each validates seven
  worker targets using the receipt-derived embedded source. Both observations
  retain Manual/Dense 75%, resolution scale 1, antialiasing and MSAA 4, bloom off
  and sharpening on. This strict passing rerun does not establish why the earlier
  unmatched-blob failure occurred; it remains an intermittent audit limitation.
  SwiftShader and bounded Blob-retention instrumentation make this an integration
  result only. S47 matched routes/time reset, hardware comparisons and the full
  workload registry remain pending.
- **Worker-audit capacity correction implemented by GPT-6 Luna:**
  `9b11aadda01239fba3c95276f288b9145075c220` raises the aggregate
  diagnostic Blob budget from 8 MiB to 32 MiB, retaining the existing per-Blob,
  record and worker-target bounds and fail-closed overflow behavior. The earlier
  passing hosted run read about 6.43 MB across seven worker targets; an eight-core
  browser can create additional geometry workers and exceed the old aggregate
  bound without loading unexpected code. This corrects a harness capacity limit,
  not a measured application memory regression. The aggregate-limit regression
  test passes locally; physical Windows browser validation remains outstanding.
- **S47.1b-6 fixture clock and sample isolation implemented by GPT-6 Luna:**
  `abc93cbf2f33154ea58a726e384b0d890e3b4fce` starts every measured provider-fixture sample
  in a fresh BrowserContext, including new storage, page state, interception and
  worker auditing. Wall time stays at the whole-second OpenSky epoch during
  setup, then advances once from native monotonic time after camera/tracking
  readiness. It never rewinds an existing application or refreshes timestamps
  independently of positions. Native timers and animation clocks are untouched.
  Each sample records acknowledged fixture bytes and verifies delivery again
  after measurement, source age, current freshness and unchanged population.
  Context-owned interception and worker references are released before the next
  sample. The actual source adapter retains its 120-second freshness boundary;
  equal/older observations do not append flight-history fixes. Twelve focused
  checks, syntax, formatting and package boundaries pass locally. The registered
  suite completes with 6,611 pass / 0 fail / 10 skipped, including both
  serialized allocation gates. [The hosted clock smoke](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38034045915)
  [passes both production builds](performance-evidence/build-smoke-38034045915.json):
  baseline `eb8c682` and candidate/harness `abc93cb` retain identical fixture bytes,
  populations and visual settings. Their clocks start once and remain current
  after about 7.1 and 6.3 seconds respectively. Each worker audit reads about
  6.43 MB under the new bounded capacity. A short one-page smoke does not validate
  the capture CLI's complete repeated-context lifecycle; that separate integration
  packet is next. Samples
  remain diagnostic and `comparisonEligible: false` until the comparison
  export and full workload contracts are implemented and verified.
- **S47 phased fixture clock and observed tracking implemented by GPT-6 Luna:** `0968533` advances fixture wall time forward through configured warmup and measurement phases, holding at exact boundaries while completed frames settle. Native frame/timer/performance clocks remain unchanged; actual native durations and boundary-settle time are reported separately. `entity-follow-v1` records actual target and camera positions, observed UTC boundary epochs, source freshness/count, and tracked identity at both ends. The public Cesium scene clock is recorded separately because aircraft motion uses wall time. Raw failing observations are retained; missing, stale, wrong-identity or nonmoving targets fail. Fifty-three focused clock/route/integrity/paired/smoke checks pass, with render-request failure cleanup covered in the fixture suite. [Hosted run 38037518607](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38037518607) passes at exact app/harness revision `096853323a033d4ee617384162ac72806aa4f703`; [raw evidence](performance-evidence/build-smoke-38037518607.json) preserves both production-build checks and all six actual CLI samples. Each repetition uses a fresh browser context, observes 2,500 flights/4,362 datacenters/716 dams, and reaches exactly 1,000 ms fixture time after warmup and 2,000 ms at the measurement boundary. Both tracking samples now report `entity-follow-v1`; all moving samples contain at least two completed frames and finite positive interval p95. Native durations remain unmodified. These one-second SwiftShader samples validate integration only: five matched 30/60-second hardware runs, the negative control, comparison eligibility and hardware acceptance remain pending.
- **S47 camera roundoff comparison implemented by GPT-6 Luna:** `ff6823c` shares explicit absolute pose bounds (1e-6 metres for position/translation; 1e-12 for direction/up/rotation) across integrity, repeated-run and paired-report checks. Raw observations remain unrounded; route identity, timing, distance and visual/population conditions remain exact. Seventeen focused integrity/paired tests pass. Re-evaluating the retained 38036053222 raw routes accepts only idle and scripted-motion roundoff and still rejects tracking drift. This diagnostic does not relabel the failed hosted run; the tracking clock-boundary correction is the next implementation packet.
- **S47 rendered-frame validity implemented by GPT-6 Luna:** `293e0e5` records actual `postRender` callback counts separately from the existing frame-interval count. The hosted integration validator rejects moving/tracking windows without at least two renders and finite positive frame-interval p95, while retaining unavailable timing for zero-frame idle windows. Twelve focused smoke tests cover missing/one-frame/non-finite timing and inconsistent counts. Hosted validation remains pending; these are integration validity checks, not GPU performance acceptance.
- **S47 capture failure evidence implemented by GPT-6 Luna:** `e0e2e2a` writes a separate bounded partial-failure artifact before cleanup, preserving completed samples and the exact expected/actual integrity mismatch. `560cdbe` retains that artifact in the hosted wrapper and limits worker-validation failure labels to that phase. Sixteen failure/integrity/paired checks and ten wrapper/process checks pass locally. [Run 38035824487](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38035824487) was administratively canceled after review found the missing wrapper wiring; this is neither a pass nor a software failure. [Run 38036053222](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38036053222) tests the corrected wiring at `560cdbe5e5ec0f0a3b768ba0c6469894c6acda09`; [its raw result](performance-evidence/build-smoke-38036053222.json) preserves all six completed samples and the failing expected/actual comparison. Idle differs only in one direction component by 1.5e-16; tracking separately has about four metres of transform translation drift with different measurement-start fixture ages (1,602.9 versus 1,524.2 ms). These distinguish numerical pose comparison from a real tracking phase mismatch. The run fails integrity, and reports remain comparison-ineligible.
- **Full integration checkpoint at `9ea72f8`:** [run 38044308819](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38044308819) passes all seven standard jobs, including Node 24/26 suites and builds, Windows onboarding, all three operating-system recovery jobs and browser journeys ([job results](performance-evidence/ci-9ea72f8.json)). This is the pushed harness/documentation revision before the mission scheduling pilot. The optional terrain-quiescence diagnostic remains failed and the later runtime pilot requires separate validation. PR-only published layer-token checks and optional diagnostics were skipped.

- **S51 mission scheduling pilot implemented by GPT-6 Luna, acceptance pending:** runtime commit `e685d0e12fdd2fa28874b943b81383f1088d4a79`, with module registration and focused test-diff cleanup in `705b9d37d7164662170b2c4eb595da8cc91a6c4c`, replaces the mission layer's blanket continuous hold with disposable selected/replay/camera-flight demand and one-second visible-orbit wakes. A due matrix is refreshed before a resumed render; quick hover, selection and deselection invalidate the scene. Flight callbacks retain completion/cancellation behavior, public scene morphing does not create a hold, and destroy disposes ownership before asynchronous dependency restoration. Generation checks reject stale orbit wakes across disable/re-enable and destroy/re-init. Root repeated 81 focused launch/source/governor checks; the 67 launch checks pass again after review corrections. Package boundaries and adopted formatting pass, and the production build succeeds. This remains a reversible local experiment until the separate real-layer hosted fixture demonstrates equal visible output/populations, periodic and selected cadence, final frames and repeatable rendered-work reduction. It does not establish full application idle behavior, motion p95 improvement, physical Windows GPU performance or S51 completion.

- **S49 preflight readiness implemented by GPT-6 Luna:** `acfce93350dd8a64d3697996ef2dca497f27f1f2` fixes the demonstrated race between completed geometry probes and ongoing terrain work. Completed owned probe outcomes and valid/error-free diagnostics are required first. Remaining global jobs may settle within the existing configured drain limit (maximum ten seconds); a fresh snapshot must still report zero pending work. Stalled jobs, overflow, worker/post errors and unrelated task errors fail. Reports retain the initial pending count, actual observed wait and configured limit; timeout evidence is captured before cleanup. Root repeated 22 passing lifecycle tests and explicit formatting checks. [Hosted run 38044107279](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38044107279) fails at this exact commit ([raw report](performance-evidence/lifecycle-38044107279.json), [job result](performance-evidence/lifecycle-38044107279-run.json)). Both cases time out during ten-second preflight quiescence, before lifecycle operations. Terrain counters continue progressing: heightmap submissions grow from 12 to 74 and from 9 to 86 respectively. The subsequent failure snapshots contain zero pending jobs, equal submitted/completed counts and no unexpected errors; they do not retroactively satisfy the timed readiness gate. Normal browser cleanup completes in 88 ms. Cold terrain settling remains unresolved; the data does not establish abandoned imports. Keep this failed result and continue independent packets rather than rerunning unchanged code or extending deadlines. No application behavior, worker lifetime or timeout limit is changed.

- **Full integration checkpoint at `554089f`:** [run 38043167832](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38043167832) passes all seven standard jobs: Node 24.14/26 suites and production builds, Windows onboarding, Linux/macOS/Windows installation recovery, and browser journeys ([job results](performance-evidence/ci-554089f.json)). The newer isolated lifecycle instrumentation and readiness fix require their own checks. Optional diagnostics and PR-only published layer-token checks were skipped. This is functional integration evidence, not completion of the performance plan.

- **S49 failed-owner observations added by GPT-6 Luna:** `9fc5bc9b6671aae510efbe2bdd44f299e9b6dff1` records one bounded, URL-free failure envelope before waiter/context cleanup. It retains import/cache/job counts, worker kinds and pending ages, frame/waiter state, and available rejected worker-preflight inputs. The one-shot observation has a 1.5-second host limit; an unavailable observation stays explicitly unavailable, and the original error/failed phase is preserved. It does not alter the ten-second drain gate, worker-pending requirement, or application behavior. Root repeats 16 passing lifecycle tests and explicit script formatting checks. [Hosted run 38043457194](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38043457194) fails at that exact revision in 47.9 seconds ([raw evidence](performance-evidence/lifecycle-38043457194.json), [job result](performance-evidence/lifecycle-38043457194-run.json)). The cooperative-import preflight rejects an instantaneous global pending count of three: two heightmap jobs and one terrain-picker job aged about 448?450 ms, with no worker/post errors. Network interception and all four geometry probe outcomes pass; the probe worker has completed all four jobs and is terminated. This establishes a preflight readiness race, not abandoned import ownership. The independent workspace case passes all five replacement cycles with zero pending jobs at checkpoints and preserved feature identity/content. Browser cleanup completes normally in 64 ms. The overall report remains failed; bounded worker readiness is the next correction, and the separate earlier import drain failure remains unresolved.

- **S47 worker audit moved to the actual warmup boundary by GPT-6 Luna:** `fe522e2cbf3113773bbcedee4cd711749b6b6de5` keeps the bounded creation audit active through scenario setup, configured warmup and the completed warmup-boundary render, then freezes/restores it before measurement starts. The shared boundary helper tests execution ordering and rejects incomplete warmup/render evidence; the default diagnostic path and strict late-worker guard are unchanged. Reports identify the new timing boundary. Root passes all 46 worker/boundary/comparison/smoke tests and explicit script formatting checks. [Hosted capture run 38042971237](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38042971237) fails at that exact app/harness revision ([raw report](performance-evidence/build-smoke-38042971237.json), [job result](performance-evidence/build-smoke-38042971237-run.json)). Five samples complete (two idle, two motion, one tracking) with late-worker validation; the existing 180-second child deadline stops the final tracking sample during its warmup boundary. Cleanup is confirmed. The five partial software-rendered samples are diagnostic, not a complete comparison or performance pass; no unchanged rerun or deadline increase is justified by this result. The raw report still contains one obsolete before-warmup instrumentation string, corrected separately by `554089fa6caa1074a000615c8bc11e3582e31e20`; its explicit timing-boundary metadata and tested code place the audit after warmup. Warmup and frame deadlines were not increased.

- **S49 runner initialization/cleanup repaired by GPT-6 Luna:** `2342f3df7be604e69cd231d5fcf10ed7e1e7642d` constructs the report before acquiring a browser, fixes the workspace digest identifier, and protects acquired browser ownership through initialization and all case outcomes. It reuses bounded owned-process cleanup, declares a 15-second protocol timeout, bounds page/context cleanup attempts, and writes bounded phase/operation progress to disk before work. It preserves the primary failure phase and reports success only after candidate validation and owned cleanup. Thirteen focused tests pass, including actual report initialization, post-launch failure cleanup and running-to-completed report validation; root repeated them, applied explicit script formatting, and passed package-boundary checks. [Hosted run 38042671160](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38042671160) fails at that exact revision ([raw report](performance-evidence/lifecycle-38042671160.json), [job result](performance-evidence/lifecycle-38042671160-run.json)). The runner now exits in 46.3 seconds with normal owned-browser closure in 76 ms and no forced termination. It loads the cooperative warmup, then fails the ten-second warmup drain; the separate workspace context fails worker preflight. No measured cycle completes. The failure report identifies the phases but lacks the final drain snapshot and rejected preflight inputs, which must be captured before attributing either failure to application ownership. The preceding 12-minute initialization failure remains preserved.

- **Full runtime CI passed at `221f3c31a0fb1dc123f21e2023e4cb80b6f80f18`:** [run 38041731474](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38041731474) passes all seven standard jobs: Node 24.14/26 suites and production builds, Windows onboarding, Linux/macOS/Windows installation recovery, and existing browser journeys ([job results](performance-evidence/ci-221f3c3.json)). PR-only published layer-token checks were skipped. The optional lifecycle and prewarm runs below failed independently and remain failed; this standard CI result does not validate their new paths or establish performance acceptance.

- **S47 atomic prewarm audit correction implemented by GPT-6 Luna:** `6f9165c8b1de6806ace479a1d0c408b311aa9fdf` freezes the bounded worker-blob inventory and restores the native creation API synchronously before the first asynchronous body read. Frozen metadata and restoration counts now describe the same inventory; frozen references are released on success and read failure. Late executable paths still require prior receipt-backed validation. The regression creates an additional Blob during the asynchronous read and verifies that the frozen inventory remains stable and late executable use is rejected. Eighteen worker-audit tests pass; the combined audit, comparison, smoke and lifecycle suite passes 52/52. Formatting checks pass for 1,435 adopted source files, and package boundaries pass. Exact app/harness `6f9165c8b1de6806ace479a1d0c408b311aa9fdf` failed [run 38041663843](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38041663843) ([raw report](performance-evidence/build-smoke-38041663843.json), [job result](performance-evidence/build-smoke-38041663843-run.json)). The atomic inventory is now consistent: ten blobs audited, validated and present at restoration, native API restored and registry empty. The first idle sample subsequently observes seven worker targets instead of the five prewarmed targets and rejects a late non-prewarmed executable Blob. Zero samples are accepted; owned child cleanup is confirmed. This corrects the earlier inventory race but shows that initialization has not exercised all lazy worker paths. Do not loosen the late-code guard or call this a frame-stall fix. The next audit experiment must establish workload-specific worker readiness before freezing; the default diagnostic path remains available.

- **S49 isolated import/workspace lifecycle cases implemented by GPT-6 Luna:** `05a85738379b4e8c6315e5e5d6d621985d997fa7` adds two fresh-context, hermetic application cases. Cooperative imports exercise completed loads, queued cancellation and supersession, exact replacement IDs, and clear/drain cycles; workspace replacement opens two persisted copies through the real restore UI and verifies feature identity/content on return. Completed render observations precede loaded and empty checkpoints. The cases compare declared resource counts against warmed baselines, require settled worker jobs, preserve cumulative counters separately, and keep operation counts/phase/cleanup failures when a case throws. Unrelated layers are disabled only for these isolated fixtures. Raw browser listener/heap counters are diagnostic and do not establish a long-run plateau. The shared workspace-open helper gains an optional bounded timeout while retaining direct browser serialization. Eleven focused tests pass, including early/late render delivery, failed ownership checks, report mutations and cleanup; root repeated the suite and package-boundary checks pass. Workflow commit `96757bf7b34970cdd998dd20c8eb1649fa0d308d` failed [run 38041296832](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38041296832) ([raw failure](performance-evidence/lifecycle-38041296832.json), [job result](performance-evidence/lifecycle-38041296832-run.json)). Report construction referenced undeclared `workspaceImportSha256` after acquiring a browser and before entering the cleanup block. The runner printed the initialization error immediately, then its unclosed browser kept the process alive until the 12-minute job cap. No lifecycle cases ran. Fix initializer coverage and owned cleanup before rerunning; this is a harness failure, not application retention evidence. This packet does not complete CCTV, terrain or picking isolation, physical GPU validation, or the 60-minute retention gate.

- **Full integration checkpoint at `bf4fb27`:** all seven applicable jobs pass in [run 38039059995](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38039059995): Node 24/26 suites and builds, Windows onboarding, Linux/macOS/Windows update recovery, and all browser journeys. [Raw job summary](performance-evidence/ci-bf4fb27.json) records skipped optional jobs separately. This tests the traffic listener fix and observed comparison export, but predates prewarm auditing. Published layer-token allocation checks are pull-request-only and were skipped by this push run.

- **S47 prewarm worker-audit lifetime implemented by GPT-6 Luna:** `98c835207019faef5f7a3224eb951ad06123e16a`, with report-boundary correction `91ae6f29ded0e135a16f36f76a274a3ecf033e7c`, adds opt-in `--worker-audit-mode prewarm`. Provider documents validate receipt-derived worker bodies before warmup, restore the native Blob URL API and release all retained bodies before measurement. Exact creation counts bind validation to restoration; bounded observed executable paths remain checked against the approved receipt and worker-source hashes. Unknown late worker paths, overflow and incomplete restoration fail. Startup remains separately diagnostic. Unused late Blob creation is explicitly unobservable, and comparison eligibility remains false. Thirty-eight focused Node tests, syntax, formatting and boundary checks pass; root repeated the focused suite. Workflow commit `706d0ea6054859b606d9eb7c00d5e7ad330d31e7` is the frozen app/harness revision for [prewarm run 38039851531](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38039851531), which fails before the first sample: 12 script blobs were validated, but restoration observes 14. Native API restoration and registry cleanup both succeed; the guard correctly rejects two unvalidated creations during the asynchronous audit window. [Raw failure evidence](performance-evidence/build-smoke-38039851531.json) preserves exact counts, fixture acknowledgement and zero completed samples; owned-child cleanup is confirmed. The next correction is an atomic snapshot/detach before asynchronous body reads, with late executable paths still rejected unless prevalidated. No frame deadline is changed, and this failure says nothing about the prior frame-timeout cause. Diagnostic mode remains the default. This control removes a known harness retention mechanism from warmup/measurement; it does not establish the cause of prior frame stalls.

- **S49 traffic listener ownership implemented by GPT-6 Luna:** `cb808a54e449aee5e90e0ef9aefc707f020e3987` replaces the anonymous page-level style subscription with an exact callback and event-target owner. Destroy releases that subscription, later initialization rebinds it, and disabled layers continue receiving style changes until destroyed. A real layer-factory regression fails against the unfixed parent (one listener remains after destroy) and passes after the fix; repeated teardown/reinitialization returns to the warmed listener baseline and independent instances do not remove each other's listener. Forty-six focused traffic tests, formatting, package boundaries and diff checks pass. This fixes a demonstrated application-owned retention path; it does not establish the cause or closure of the historical Windows soak failure.

- **Full integration checkpoint at `37a34f9`:** all seven applicable jobs pass in [run 38038047288](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38038047288), including Node 24/26, production builds, Windows onboarding, Linux/macOS/Windows recovery and browser journeys. [Raw job summary](performance-evidence/ci-37a34f9.json) preserves skipped optional jobs separately. This checkpoint includes dormant diagnostics and staged tracking but predates `3720f1e` export and `cb808a5` traffic cleanup.

- **S47 observed comparison export implemented by GPT-6 Luna:** `3720f1ebb9482eea034621b96fcd170c1005fb7c` exports `gev-performance-comparison-contract/v1` for the existing dense provider workload from observed fixture delivery, exact enabled populations, visual settings, browser identity, dimensions and per-scenario routes. Per-document diagnostics requests are checked, including explicit support for the baseline without the optional hook. Paired validation checks each successful response acknowledgement and per-sample totals but does not require equal polling activity between builds. Missing or altered contracts are rejected by the actual CLI smoke validator. Short, software-rendered and instrumented captures remain comparison-ineligible with explicit reasons; worker-blob retention still prevents latency acceptance. The owned measurement timeout is now cleared on every exit. Thirty-six focused tests, formatting, boundaries, syntax and diff checks pass. The adapter also reads the saved six-sample `0968533` report; that offline check is not a new browser capture. [Hosted run 38038800268](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38038800268) fails at exact app/harness `3720f1ebb9482eea034621b96fcd170c1005fb7c`: scripted-motion run 2 does not deliver a completed warmup-boundary frame within the unchanged 5,000 ms deadline. [Raw failed evidence](performance-evidence/build-smoke-38038800268.json) retains three completed samples, acknowledged fixture delivery and all six visited documents reporting successful diagnostics-disable requests. No page or interception errors were observed, and child cleanup was confirmed. Completed idle intervals reached 3,664.8 and 4,706.8 ms on SwiftShader; these observations do not establish why the next boundary stalled. Full exporter integration remains pending. The failure is preserved without retrying unchanged code or raising the deadline; the separate prewarm-audit mode is the next instrumented-versus-restored control. Broader workload coverage and hardware comparisons remain outstanding.

- **S48 disabled diagnostics implemented by GPT-6 Luna:** `79d05e2f003d32565e195b498f71ec11ba60b8c7` makes disabled monitor construction, snapshot reads and destruction dormant: no clock, renderer, scene, layer, ownership or timing-provider reads, and no render listener. Current measurements remain null/unavailable; previously collected samples are labeled retained history. Re-enabling preserves the original sample epoch and does not record the disabled interval as a frame. Capture requests the optional diagnostics-disable hook on every startup, setup and fresh provider document and records whether the hook exists. Older baseline builds remain supported. Eight focused tests pass, with syntax, formatting and diff checks passing. Default application diagnostics behavior is unchanged; new capture integration evidence is still required.

- **S47.1b-7 actual capture CLI integration implemented by GPT-6 Luna:**
  `9802305d99b2a5dc871f00848a969455116f6c64` and
  `c49288e4b274c8b7b4be0f78a7ac72ab369d0551` extend the manually dispatched
  production-build smoke to execute the real capture command against the verified
  candidate server. It requests one cold startup and two repetitions of idle,
  motion and selected-aircraft tracking, each with one-second warmup and capture.
  These short software-rendered samples are integration diagnostics only. The
  validator requires six isolated samples, matching commit/receipt/fixture identity,
  exact populations, Manual/Dense 75%, foreground continuity, tracking identity,
  successful integrity checks and receipt-derived worker audits. The artifact
  retains the raw successful CLI report. Time and output bounds stop only the
  owned CLI/browser processes; errors retain bounded, redacted stderr and sample
  progress, with observed cleanup separated from unconfirmed cleanup. Eight
  focused tests and syntax checks pass locally. [The first full CLI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38034906382)
  [fails before candidate/CLI execution](performance-evidence/build-smoke-38034906382.json)
  at candidate/harness `c49288e`: the baseline final audit observes a newly
  created 136-byte JavaScript Blob with no request or worker-target history entry.
  Its seven embedded source bodies have the expected receipt-derived hash and
  both dense population checkpoints pass, but the extra bootstrap body has not
  yet been classified. This gives a construction/target-publication race hypothesis
  to test. The strict audit remains failed; no CLI browser pass is claimed.
  Validate all created bootstrap recipes independently from observed execution,
  keeping unstarted constructions distinct from worker-target evidence.
- **Worker construction and execution evidence separated by GPT-6 Luna:**
  `49a220756359ec815aaaf6a042c31f0608cc39c3` validates every bounded creation record as
  either the exact receipt-derived embedded source or an exact allowed bootstrap
  referring to that source. Validation no longer depends on a worker target
  already appearing in the separately sampled browser history. Unknown code,
  absent payloads, unexpected origins/modules and inventory overflow still fail.
  Observed worker counts remain separate from created/unobserved wrapper counts;
  zero targets never implies that a constructed worker executed. All 23 focused
  contract checks pass, including delayed construction and unknown-code controls.
  [Hosted run 38035250094](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38035250094)
  [passes baseline and candidate worker checks](performance-evidence/build-smoke-38035250094.json),
  then reaches all six candidate capture windows. Final report validation rejects
  `idle run 2: repeated workload changed`; the overall run stays failed and no
  performance comparison is accepted. Owned child/browser cleanup is confirmed.
  The next diagnostic must retain the assertion's actual/expected signatures and
  partial samples to distinguish camera, population and settings mismatches. The
  old generic failure field also labels this later CLI error as a worker validation
  failure; the phase/progress evidence places it after successful worker audits.
- **Integration test correction:** CI at `0e766a8` failed the FIRMS history test on
  both Node versions because it combined the previous UTC date with hardcoded
  midnight; around the date boundary that row correctly fell outside 24 hours.
  `aeef1487d8ed6156c4bdee0c9e247454d11421e6` fixes the test with frozen midday and
  midnight cases and explicit inclusive/exclusive window edges. The production
  filter is unchanged. All 27 source/CSV tests pass; the earlier CI failure remains
  historical evidence, not a production data-filter defect.
- **Integration outcomes remain revision-specific:** all seven standard jobs pass
  at `aeef148` ([run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38027448162)).
  The subsequent [run at `a83dd7a`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38028444120)
  fails Windows recovery during graceful browser shutdown after the rollback
  workspace check. The [raw report](performance-evidence/recovery-a83dd7a-windows-close-failure.json)
  records matching workspace bytes/settings and one rendered feature, with the
  owned page closed and zero remaining pages. Browser close exceeded its bounded
  deadline and required owned-process termination, so the stage stays failed.
  This is distinct from the earlier startup/renderer-query timeout. Its top-level
  `failure.step` still says `verify-persisted-workspace`; the check's own
  `owned-page-cleanup` step and error identify the actual failed operation.
- **Subsequent Windows recovery passes at `ac9cbc0`:** the
  [run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38029099999)
  completes all five stages with matching settings and persisted workspace bytes,
  one rendered feature, one owned application page and successful graceful close
  at every stage. The [raw result](performance-evidence/recovery-ac9cbc0-windows.json)
  records SwiftShader on hosted Windows; it is not GPU evidence. This passing
  rerun predates the new close diagnostics and does not establish the cause of
  the earlier shutdown failure.
- **Bounded recovery-close diagnostics implemented by GPT-6 Luna:**
  `4c5da0d`, corrected through `f4284217c87d1afecab56da6e6cb215d7c5fe01d`,
  retains the five-second graceful-close deadline and reports host-clock timing,
  close rejection/timeout, process exit, bounded sanitized stderr and confirmed
  termination separately. An already-exited child cannot count as forced
  termination. The Windows stop helper has its own bounded lifetime and direct
  tests for successful taskkill, failed requests, natural exit and timeout.
  Cleanup becomes the primary failure only after an otherwise successful check;
  earlier startup/workspace failures retain their phase. The coordinator's
  [22-test Node verification](performance-evidence/recovery-diagnostics-f428421.json)
  passes. This instrumentation does not claim to fix or explain the intermittent
  shutdown. The [exact-commit diagnostic](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38030519075)
  now records two distinct outcomes: [WebGL-only passes all five stages](performance-evidence/recovery-f428421-windows-webgl-only.json),
  preserving settings and workspace bytes with graceful closes of 330-631 ms;
  [full-driver mode fails](performance-evidence/recovery-f428421-windows-gl-driver.json)
  during the third stage's renderer query. That failing query reaches
  `getParameter` after extension lookup, never reports completion and stops
  page heartbeats before the protocol timeout. Its subsequent graceful close
  exceeds five seconds; owned-process termination is confirmed separately.
  This reproduces the full-driver query stall, not the earlier shutdown-only
  failure's cause. The standard Windows recovery job already uses WebGL-only;
  neither software mode establishes physical GPU frame-delivery acceptance.
- **Windows wind validation remains failed:** a clean isolated checkout of
  `a83dd7af30cb3b9a39095da0f081a1037725d2cd`, served by Vite on loopback, produced
  [a fresh-frame timeout](performance-evidence/wind-a83dd7a-windows-capture-failure.json)
  before the first wind pixel comparison on Intel UHD 620 / Chrome 154. The
  400 ms deadline was unchanged; there are zero completed wind checks, so visual
  equivalence has not passed. The immediate [standalone WebGL control](performance-evidence/webgl-a83dd7a-windows-wind-control.json)
  delivers 54 frames in five seconds, with a 533.3 ms maximum frame gap, while its
  20 ms timer delivers 250 ticks with a 21.9 ms maximum gap. Both pages report
  visibility; the control reports focus, no context loss and no visibility events.
  Desktop occlusion remains unverified. This reproduces irregular browser frame
  delivery without Cesium or wind, but does not identify a browser/driver defect.
  Local implementation checks were also underway, so these diagnostic observations
  are not latency comparisons. Preserve the failure and continue independent
  implementation; do not loosen the deadline or convert the earlier recovery to
  permanent hardware acceptance.
- **Historical integration failure retained:** [CI at `70ca7de`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37987235260)
  passes Node 24/26, Windows onboarding and Linux/macOS recovery, but Windows
  recovery fails reopening the prior `6b896e2` application after the interrupted
  update. The [raw recovery report](performance-evidence/recovery-windows-70ca7de.json)
  records an application-ready timeout of 90 seconds after the initial workspace
  save passed. It does not establish a lost workspace; later recovery stages did
  not execute. The unchanged timeout remains part of the recovery contract.
- **Windows recovery cause and fix:** the later [0cdddd2 run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37988992802)
  timed out in the renderer query at stage two. Bounded diagnostics in the paired
  [8d1360c run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37991156080)
  revealed that each reopen left its app tab open before `browser.close()`. Chrome
  restored those tabs from the shared profile while the fixture created another
  page; the target inventory grew to four old app pages before the final stage.
  Some restored page targets arrived after the initial inventory. The WebGL-only
  job reported all five checks passed, while the full-driver job failed final
  workspace verification, but both had the extra restored tabs and are invalid as
  hermetic recovery evidence. The observed renderer-query stalls do not establish
  a specific Chromium engine mechanism or a performance difference; the A/B jobs
  ran on different CPU models.
- `fc67b90450625313414d36b986dbb2e54cdae2ad` fixes fixture page ownership: reuse
  the single initial blank page, reject restored or additional page targets, close
  the owned page and verify zero open pages before graceful browser close. The
  app and full-driver SwiftShader default are unchanged. Both jobs in the
  [corrected Windows run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37993455783)
  pass all five stages with the same persisted workspace asset digest, one
  rendered feature, clean source and the page-ownership checks. This validates
  the fixture correction on hosted Windows. In this run, the full-driver
  end-to-end renderer query took 23.697 to 59.627 seconds, and its instrumented
  `getParameter` phase took 23.075 to 59.030 seconds; the exact Chromium
  mechanism is unknown. The separate CPU hosts preclude a timing comparison
  with the WebGL-only job. This is not GPU performance evidence. At the time of
  that evidence record, a full dev CI repeat had not yet run. The subsequent
  [full CI repeat](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37995293018)
  passed the unchanged full-driver Windows recovery at
  [job 114039659519](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37995293018/job/114039659519): all five stages passed with zero extra pages and identical persisted workspace asset digests.
  Broader S49 and S60 gates remain pending. Raw reports and limits are
  summarized in [the Windows recovery note](performance-evidence/WINDOWS_RECOVERY.md).
- **Windows recovery renderer tuning:** the isolated
  [Windows protocol](performance-evidence/RENDERER_QUERY_TUNING.md) defaults to
  full-driver/late-query control and WebGL-only/late-query in counterbalanced
  `AB` and `BA` orders, comparing only within each host. Manual dispatch can
  additionally run the optional full-driver/early-query candidate in `ABC` and
  `CBA`. The early-query stage failed graceful browser close in both sequences
  and required forced termination, so neither early observation is comparable
  and the candidate is not adopted; both raw reports are retained in the
  [experiment record](performance-evidence/RENDERER_QUERY_TUNING.md). Both ABC
  backend reports passed all five checks, but the original ABC packet is
  incomplete and those reports are descriptive only. The original backend-only
  AB and BA packets both failed because their comparator used an incorrect
  expected fixture digest. Corrected offline re-evaluations of the unchanged,
  hashed reports found `webgl-late` eligible in both orders: median critical
  paths improved 92.1% in AB and 87.4% in BA, with no per-stage regressions.
  The four reports passed all five recovery stages (20 stage checks total) and
  preserved the same settings, workspace asset digest, and page ownership.
  These are offline evaluations of existing reports, not browser reruns. Based
  on the counterbalanced result, only the Windows install-recovery CI job uses
  WebGL-only SwiftShader with its existing late query; the full-driver
  diagnostic remains available and application/global renderer defaults stay
  unchanged. The predeclared acceptance criterion was at least 20% improvement
  in median navigation-to-renderer-checkpoint critical path with no per-stage
  regression above 10% in both backend-only orders; both comparisons meet it.
  Query-only timings are diagnostic;
  these software-rendered recovery runs establish no app FPS or GPU-performance
  claim. The change is scoped to that CI fixture and does not change application
  renderer defaults.

## Measurement contract

### Follow-up validation on 9 October

- S58 now retains the currently owned wind scalar image when immutable grid,
  wind and scalar contents are equal. Scalar revisions are checked by values,
  not forecast IDs alone. Provider errors retry installation; changed data,
  clear/destroy and map-host changes keep their existing replacement and
  disposal behavior. The 223 wind/weather tests, formatting, package boundaries
  and production build pass. No extra image cache, rendering setting or source
  population is introduced.
- Three five-pair Node comparisons test `b7e54c0` against `5ae6969`, with three
  warmups and ten equivalent or revised forecasts per overlay per child:
  [first](performance-evidence/wind-restores-b7e54c0-first.json),
  [repeat](performance-evidence/wind-restores-b7e54c0-repeat.json), and
  [third](performance-evidence/wind-restores-b7e54c0-third.json).
  Every equivalent and revised raster sequence is byte-identical across builds.
  Equal restores create zero new images instead of ten; ownership remains one
  image and teardown releases it. The third comparison's median per-restore CPU
  times are speed 9.97 to 0.71 ms, temperature 6.90 to 0.24 ms and pressure
  9.88 to 0.26 ms. These measure application image preparation with mocked DOM
  and collection ownership, excluding PNG encoding, GPU work and motion p95.
  The first changed-temperature median regresses 16.0%; two subsequent batches
  do not reproduce a regression above 10% (maximum changed-case increases
  8.7% and 6.7%). The timing variance remains visible in all raw reports.
- The [hosted Metal visual comparison at `d905f30`](performance-evidence/hosted-wind-d905f30.json)
  passes all three scalar overlays in
  [the free standard Mac job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37982484769).
  Initial construction, repeated control and retained-image captures have exact
  matching pixel hashes. Real paused GPU flow retains 1,200 paths and 152,736
  vertices. This validates the isolated globe-host image change at one fixed
  camera, not a full effect matrix, motion improvement, Windows rendering or
  physical Mac desktop coverage. The same run also passes the twelve capture
  checks and ten equivalent imported-geometry captures. Broader S58 and S60
  acceptance remain pending.
- [Full CI at `7c6c324`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37978265763)
  passes Node 24/26, builds, formatting, boundaries, Windows onboarding,
  installation/profile recovery on all three operating systems, and every
  browser gate. This includes all six density-restoration checks and the
  corrected archive-state waits in mixed-use smoke. The short smoke is not a
  60-minute retention pass. Its earlier failure remains below; the exact cause
  is still unproven. This supersedes the pending CI descriptions for older
  commits without reclassifying their failed runs.
- The fresh [Windows UHD 620 import diagnostic at `7c6c324`](performance-evidence/import-batches-7c6c324-failed.json)
  remains **failed**. Chrome 154, foreground visible, 640-by-360 drawing buffer
  and 5,000 points produce one fresh capture, then zero animation callbacks,
  scene updates or rendered frames during the next 400 ms capture. Timers
  continue (maximum heartbeat gap 25.1 ms), the context is valid and no render
  error is reported. This does not establish a GPU-driver or application root
  cause. Closing old fixture tabs and restarting the exact-build server did
  not resolve the failure. No Windows soak or latency pass is inferred.
- The import fixture now offers an opt-in WebGL fence observation. It uses
  public WebGL 2 `fenceSync`, `flush` and zero-timeout `clientWaitSync` calls to
  distinguish prior-command completion from absent frame callbacks. Fence and
  polling timer ownership ends with the capture, including failure. Six unit
  tests pass. This changes command scheduling and reports observation delay,
  not GPU execution time, GPU idle state or a normal performance comparison;
  the option is off by default and has no production runtime effect.
- The [fence diagnostic at `572c80c`](performance-evidence/import-batches-572c80c-fence-failed.json)
  reproduces the failed second capture. Its fence completes after 8.2 ms, while
  animation callbacks and scene updates remain absent for the 401 ms capture;
  timer heartbeat gaps stay below 9.2 ms. This rules out those earlier commands
  still waiting in this WebGL context at capture timeout, not all compositor or
  GPU work. After viewer destruction, a separate
  [five-second callback probe](performance-evidence/frame-delivery-572c80c.json)
  observes 299 callbacks, maximum gap 25.1 ms. The fixture now provides render-only
  and copy-without-readback controls to isolate the capture path; neither checks
  pixel equivalence, and the default remains full copied-pixel validation.
- The [render-only control at `6a393c8`](performance-evidence/import-batches-6a393c8-render-only-failed.json)
  fails in the same second sample without copying or reading any pixels. This
  rules out capture readback as a necessary trigger. A separate continuous-render
  diagnostic can now omit governor installation, while the default remains
  render-on-demand. Neither diagnostic changes production viewer behavior.
- The [continuous-render control at `93261f0`](performance-evidence/import-batches-93261f0-continuous-failed.json)
  fails its first measured capture with the governor absent and
  `requestRenderMode: false`: no animation callbacks or scene updates in
  400.9 ms, with timer gaps at most 9.3 ms. Readback and the governor are therefore
  not necessary triggers. Browser/compositor evidence remains needed before
  attributing this to an engine or driver defect. Production quality, engine
  version, capture deadline and render scheduling remain unchanged.
- **Windows frame-delivery boundary, not a root-cause fix:** On the user’s
  Chrome 154 / Intel UHD 620 D3D11 renderer, the original [paired run at
  `06da9de`](performance-evidence/import-batches-06da9de-failed.json) and a
  focused rerun at [`1d04d35`](performance-evidence/import-batches-1d04d35-paired-focus-failed.json)
  pass the first 5,000-point capture, then fail the next 400 ms capture with no
  RAF, Cesium update or rendered frame while timers continue. The focused run
  stayed focused and visible, had no recorded lifecycle events and showed
  94.2% canvas/viewport intersection. Its one-shot [initial-load control](performance-evidence/import-batches-1d04d35-initial-load.json)
  passed in 7.8 ms. A [steady-population diagnostic at `f3dcfee`](performance-evidence/import-batches-f3dcfee-steady-failed.json)
  then failed on capture four with the same unchanged 5,000 entities and no
  frame/update callbacks; a [direct `Cesium.Viewer` run at `e194fd3`](performance-evidence/import-batches-e194fd3-direct-cesium-failed.json)
  failed on capture two without the application viewer wrapper. The separate
  [`1d04d35` synchronous-only run](performance-evidence/import-batches-1d04d35-synchronous-interrupted.json)
  is invalid for comparison because the page became hidden before failure.
- The minimal [WebGL2 loop at `0edfb8e`](performance-evidence/webgl-frame-delivery-0edfb8e-webgl2.json)
  reproduces the callback collapse without Cesium or app imports: it draws
  5,000 cyan 9-pixel points from RAF on a 640-by-360 WebGL2 canvas for five
  seconds, with matching Cesium context attributes. It records 47 callbacks
  (per-second buckets 24/1/1/4/17), a 1,016 ms maximum callback gap, 249
  20-ms timer ticks and no focus, visibility or context-loss events. The same
  [fully visible canvas run](performance-evidence/webgl-frame-delivery-0edfb8e-fully-visible.json)
  still drops to 64 callbacks with a 1,016.5 ms maximum gap at 100% viewport
  intersection. The [plain-RAF control](performance-evidence/webgl-frame-delivery-0edfb8e-plain-raf.json)
  without a WebGL context receives 286 callbacks (46/60/60/60/60); after the
  WebGL canvas is released, the [plain-RAF recovery control](performance-evidence/webgl-frame-delivery-0edfb8e-plain-recovery.json)
  receives 298 (58/60/60/60/60). These controls show that a WebGL-coupled
  browser frame-delivery failure can occur without the Cesium engine, import
  workload, capture path or application wrapper. They do not identify whether
  Chromium scheduling, ANGLE, the Intel driver, compositor behavior, external
  window occlusion or browser automation causes it. Document focus and
  visibility do not establish OS-level foreground visibility. Before changing
  browser or driver behavior, run a controlled manual foreground test. The
  400 ms capture limit and all application visuals/settings remain unchanged;
  this diagnostic is not a GPU speed or hardware acceptance result.
- **10 October foreground recovery:** The requested manual WebGL control receives
  302 callbacks in five seconds (maximum gap 17.5 ms); the immediately following
  CUA-started control receives 301 (20.7 ms). A diagnostic paired import run then
  passes all ten captures, followed by two normal runs without extra diagnostics
  (20/20 captures, 6.0-22.2 ms). All 30 captures have identical pixels, 5,000
  features and the unchanged 400 ms deadline; each run passes twelve cancelled
  imports' cleanup checks. The 12-check isolated capture matrix also passes with
  preservation both enabled and disabled. See the [recovery record](performance-evidence/WINDOWS_FRAME_RECOVERY.md)
  for raw artifacts and precise scope. No application, driver or renderer setting
  changed between the earlier failures and this recovery. Automation and partial
  canvas clipping alone are not sufficient explanations: both occur in the later
  successful runs. OS-window conditions were not measured, and the user's exact
  desktop changes are unknown. This is recovered capture correctness, not a
  demonstrated root-cause fix, latency comparison or Windows retention pass.
  The report-only correction at `c2d80e2` makes document visibility/focus and
  unavailable OS-window verification explicit; its additional normal hardware
  run passes ten captures in 5.0-17.7 ms with the same pixels and cleanup checks.
  Twelve focused diagnostic/capture tests, syntax and formatting checks pass.
- The [fresh hosted Metal soak](performance-evidence/hosted-mac-2e839a4.json)
  at `2e839a449ce32582130b33267a1a276e8cb59224` passes directly with the corrected
  validator: 252 cycles in 3,609,194 ms and 13 post-GC checkpoints. Final-window
  retained-heap growth is 1.59%; listeners return from 629 to 629, with transient
  checkpoint peaks of 641. Final pending workers are zero. Intermediate
  checkpoints contain at most two active terrain jobs, all younger than 25 ms;
  none crosses the ten-second unsettled-task threshold. Application-owned
  resource gauges remain bounded. The report records Chrome 152.0.7977.75,
  Apple M1 (Virtual), 3 logical CPUs, 7 GiB RAM and verified paravirtual Metal;
  physical desktop coverage is false. This is an actual new run, not a
  reassessment, but predates the later density fixes and does not validate the
  current candidate or Windows UHD 620.
- At `d70dac9`, all six [density journey checks](performance-evidence/visual-settings-d70dac9.json)
  pass, including saved 75% workspace restoration. Node 24/26, builds,
  formatting/boundaries, onboarding, all three recovery jobs and other browser
  journeys pass. The [Windows recovery report](performance-evidence/recovery-windows-d70dac9.json)
  preserves the asset digest through all five stages. Overall CI remains
  **failed** because [mixed-use smoke](performance-evidence/smoke-d70dac9-failed.json)
  times out during archive recovery in warmup cycle 1, before measurements.
  Its original error does not identify which archive predicate timed out.
  The fixture now polls these network/DOM states on a 100 ms timer, retaining
  the same 30-second deadline and assertions, and records the exact phase and
  bounded UI/render state on failure. Twenty fixture tests pass; the new browser
  run must establish whether this fixes the timeout. Its root cause is unproven.

- CI at `2e839a4` passes Node 24/26, builds, formatting, boundaries, onboarding,
  Linux/macOS recovery and all browser journeys. Windows recovery passes its
  first three stages, then fails the 90-second upgraded-application startup wait.
  The [partial failure report](performance-evidence/recovery-windows-2e839a4-failed.json)
  is retained. The application object existed at timeout; the prior diagnostic
  did not separately record its workspace panel. The fixture now polls this
  state condition with a 100 ms timer instead of animation callbacks, keeping
  the same deadline and all persistence assertions. It also records panel,
  visibility and focus state on failure. Validation of that change is pending.
- The [Windows rerun at 503a4f2](performance-evidence/recovery-windows-503a4f2-failed.json)
  reaches and passes upgraded-application recovery, then times out reopening the
  frozen `6b896e2` rollback build in its final stage. All stored-asset checks up to
  that point pass; the overall run remains failed. The recovery-only fixture now
  uses and reports a 960 × 640 viewport to bound software raster work on GPU-less
  CI runners. Resolution scale, effects, data, assertions and timeouts are
  unchanged. This is not a performance configuration or proof of the timeout's
  cause; validation of the recovery fixture adjustment is pending.
- `c66b81c` adds an isolated point-collection diagnostic: five alternating pairs,
  840 core and 10,000 dense synthetic points, 60 warmup frames and 180 measured
  frames per sample. It counts WebGL buffer submissions and instrumented
  collection update CPU duration, with matching final pixel hashes and fixed
  update steps. This is S48 attribution work, not the 30/60-second S47 benchmark,
  application motion performance, GPU execution timing, or an accepted S53
  optimization. In the [first hosted Metal pair](performance-evidence/point-collections-503a4f2-failed.json)
  at `503a4f2`, partitioning reduces buffer submission calls from 18,885 to 6,300
  with the same 604,320 submitted bytes. Final pixel hashes differ, so the
  diagnostic stops early and the optimization is **not accepted**. This is one
  failed visual comparison, not five pairs or a performance pass. The report
  also retains the passing 12 small captures and ten imported-geometry captures.
  Production collections remain unchanged.
- Repeated controls at `9dacb7c` produce identical pixels. The first partitioned
  pair still changes 24 of 230,400 pixels (maximum channel difference 36), despite
  identical Cartesian-coordinate hashes. The
  [raw comparison and both images](performance-evidence/point-collections-9dacb7c-failed.json)
  preserve that discrepancy. The cause is not established; the five-pair run
  stops at its first failed pair and production collection partitioning remains
  rejected. Exact-pixel criteria are not relaxed to make the result pass.
- The [Windows recovery run at 9dacb7c](performance-evidence/recovery-windows-9dacb7c.json)
  passes all five prior/install/interruption/upgrade/rollback stages and reopens
  the same asset digest after every stage. It uses the declared 960-by-640
  software-rendered viewport and establishes recovery correctness only. Earlier
  timeouts are preserved; this pass does not prove their root cause.
- The S47 restore audit found that the existing status notification was confined
  to display-slider actions. Share-link and workspace restores call the visual
  settings owner directly, leaving the Manual status stale. The visual owner now
  reports density changes to the quality controller, including engine/profile
  synchronization. Fifty focused tests pass. A new full-browser journey compares
  the status, slider, label, profile and effective renderer density after a share
  restore, slider edit, quality/performance/manual cycle and saved-workspace
  restore. Its CI result is pending; the fix changes no rendering detail.
- [CI at 9dacb7c](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37973615671)
  passes Node 24/26, production builds, formatting/boundaries, onboarding,
  recovery on all three operating systems and every prior browser journey.
  The new visual-settings journey **fails** only at workspace restoration:
  its earlier five share/slider/profile checks pass, then saved 75% returns as
  50%. The [failed report](performance-evidence/visual-settings-9dacb7c-failed.json)
  is retained. Canonical workspace views did not contain detection settings,
  and `applyView` replaced them with OFF/50 defaults. The additive optional
  `view.detection` contract now carries canonical mode/density through view,
  URL and version-one workspace serialization. Legacy views remain readable
  with their previous defaults. Focused view, storage and restoration tests
  cover the round trip; the full browser journey must pass on the new revision
  before this gap is closed. Failed future checks now retain actual observed
  values and the tested commit in their report.

- [CI at eb90492](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37966397084)
  passes all Node 24/26, formatting, boundary, build, onboarding, browser and
  Windows/Linux/macOS recovery jobs. This includes the corrected workspace import
  and duplicate completion paths. Later commits add diagnostics, evidence and CI
  probe controls; they do not imply a new full-application acceptance pass.
- The isolated [free hosted-renderer probe at ee38af4](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37968012285)
  reports [Mac paravirtual Metal](performance-evidence/hosted-mac-ee38af4.json)
  and [Linux software rendering](performance-evidence/hosted-linux-ee38af4.json).
  Both pass ten matching 5,000-feature captures and twelve cancelled-import
  ownership checks. On the Mac, median per-run maximum heartbeat gap falls from
  198 ms to 57 ms while median import completion grows from 90.2 ms to 385.2 ms.
  On Linux, those values are 150.9 ms to 49.7 ms and 51.6 ms to 137.1 ms.
  The heartbeat covers import creation plus a 20 ms task drain; it does not cover
  subsequent image capture and is not control p95 or a full-application latency
  gate. [Hosted Windows](performance-evidence/hosted-windows-ee38af4.json) has no
  WebGL 2 context and correctly remains pending, despite a successful capability
  probe job. All runners are standard free public-repository runners; probe-only
  dispatch avoids repeating unrelated test jobs or uploading billed artifacts.

- The free [hosted Mac soak](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37960247130/job/113920967041)
  at `0fa31401b07d1156b0d50de4c7268c8735501f39` completed 252 cycles in
  3,603,543 ms using Chrome 152 and verified Apple paravirtual Metal acceleration.
  All 13 post-GC checkpoints retain 629 listeners and zero pending worker jobs;
  final-window heap growth is 1.58%. Its old validator failed solely on the same
  cumulative cache-use counter. The [original report](performance-evidence/hosted-mac-0fa3140-original.json)
  and [hashed reassessment](performance-evidence/hosted-mac-0fa3140-review.json)
  preserve both verdicts. The corrected ownership/heap validation passes. The
  runner is an Apple M1 virtual machine with 3 logical CPUs and 7 GiB RAM;
  `physicalDesktopCoverage` remains false. This establishes hosted accelerated
  retention for that revision, not Windows UHD 620 stability or a physical Mac
  performance comparison.

- The [5328e25 software-rendered soak](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37959251555/job/113917592739)
  completed 130 cycles over 3,620,845 ms with 13 post-GC checkpoints. The
  [original report](performance-evidence/soak-5328e25-original.json) failed only
  because the older validator treated the cumulative `maps.providerCacheReuses`
  counter as an ownership gauge. The [separate reassessment](performance-evidence/soak-5328e25-review.json)
  records the source file SHA-256 and validator commit `461b415`; it passes the
  unchanged ownership and heap thresholds. Final-window heap growth is 1.70%;
  listeners return to 632 after transient peaks of 639 and 644. This is historical
  SwiftShader evidence, not a fresh run at the current revision or a GPU claim.
- CI at `95dc09a` passed Node 24/26, builds, formatting, boundaries, onboarding and
  all three recovery jobs, but its mixed-use browser journey failed before
  measurement. A workspace-list refresh creates a new in-memory row, so checking
  row object identity incorrectly cancelled an import's completion. `eb90492`
  checks the stable workspace ID and navigation generation instead; the same
  correction covers duplicate and synthetic-demo completion. The existing browser
  journey remains the regression gate, with duplicate completion now observed too.
- Earlier Windows UHD 620 5,000-point import diagnostics **failed**. Saved
  failures at [95dc09a](performance-evidence/import-batches-95dc09a-failed.json),
  [c61b623](performance-evidence/import-batches-c61b623-failed.json) and
  [dc01d3c](performance-evidence/import-batches-dc01d3c-failed.json) preserve partial
  samples. The last run has zero Cesium updates and zero independent animation
  callbacks during a 401 ms capture wait, despite a visible page, enabled render
  loop, valid context and no render errors. A separate plain-page control recorded
  293 animation callbacks in five seconds with document focus and visibility;
  it did not verify OS-window occlusion or power conditions. The
  [synchronous-only control](performance-evidence/import-batches-50f7b68-sync-failed.json)
  fails too, so the cooperative change is not the sole cause. A
  [later detailed run](performance-evidence/import-batches-a49b221-failed.json)
  matches the first pair's pixels, then stalls on the next repetition. The cause
  is not established. Do not accept its event-loop
  improvement as a validated comparison. The 400 ms capture deadline and the
  complete 5,000-feature population remain unchanged. The later
  [10 October recovery](performance-evidence/WINDOWS_FRAME_RECOVERY.md) records
  new passes without reclassifying these failed runs or establishing their cause.
- The [96df53f framebuffer experiment](performance-evidence/import-batches-96df53f-no-preserve-failed.json)
  also fails with `preserveDrawingBuffer: false`. During its failed 401.8 ms
  capture, ordinary timers continue with at most a 9.1 ms gap while no animation
  callbacks or Cesium updates arrive. A preceding import also has a 3.34-second
  heartbeat gap; these are separate observations, not an established GPU-driver
  diagnosis. Buffer preservation is not accepted as the fix and the production
  default remains true. Inspection of `chrome://gpu` through browser automation
  is blocked by the browser URL security policy; no alternate privileged browser
  channel was used. Driver/compositor diagnosis requires further evidence.

The reassessment command writes a new report and refuses to overwrite an existing
file: `node scripts/review-soak-evidence.mjs original.json new-review.json`.
It does not turn an operation failure into a pass or alter the original report.

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
subsequent probes require Chrome's WebGL feature status to report `enabled`.
Current Chromium reports a unified WebGL status; an absent legacy `webgl2` field
is allowed, but an explicitly disabled value is rejected. A separate hosted accelerated retention run never becomes physical
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


## Subsequent validation on available hardware

[Run 37961356119](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37961356119)
passes all automatic gates at `8c952b0cda853a73b0dc2eaad3a941e36eca2def`: Node 24/26,
formatting, package boundaries, production builds, browser journeys, Windows
onboarding and real browser-profile recovery on Linux, macOS and Windows.
The [Windows recovery report](performance-evidence/recovery-windows-8c952b0.json)
records all five stages and the unchanged persisted asset digest. The earlier
`5328e25` Windows timeout is retained; the diagnostic rerun passed without proving
its root cause. Neither recovery run is GPU evidence.

The earlier `5328e25` browser smoke reported failure solely because cumulative
`maps.providerCacheReuses` was compared as retained ownership. `e53dab1` separates
explicit current-resource gauges from cumulative activity, with a regression
case that still fails on cache-entry growth. The fresh `8c952b0` smoke passes;
the earlier report is not overwritten or relabeled.

The [Windows render-demand report](performance-evidence/render-demand-3664f4f.json)
tests exactly `3664f4f24eafe1e640aca01ecae281a38784b9c8` on Intel UHD 620 / Chrome
154. A settled isolated viewer renders zero frames in 10,002.6 ms; three scheduled
one-second updates render three frames. The final capture is green and ownership
returns to zero holds and scheduled updates. All four checks pass in an
uninterrupted foreground tab. This supports governor correctness, not every
layer's cadence, tracking performance or a full application soak.

S48 now records projection, placement and painting as separate bounded CPU
series. Diagnostic buffers remain opt-in and disabled instrumentation reads no
clock. The Node attribution fixture uses a mock Canvas2D context: its phase
names describe synchronous algorithm work, not browser paint, GPU duration or
motion p95. Allocation/forced-GC diagnostics remain separate from timing runs.


## S52 experiment disposition and S59 continuation

The layout-cache experiment `a63096b` is reverted by `3d8eaba` and is not enabled.
The [paired raw report](performance-evidence/overlay-layout-experiment-a63096b.json)
compares it with `82a1951` using five alternating pairs per workload, each child
process collecting five disabled/enabled diagnostic samples after warmup.
Candidate populations and painted counts match the baseline in every sample.
Median paired CPU changes were -8.19% generic, -6.80% infrastructure, -17.71%
all-live/radio, and **+12.85% detection**. This last result crosses the regression
limit. The earlier sequential sample did not reproduce that detection penalty;
the source of variance is not established. No browser or GPU speedup is claimed,
and there is no justification for retaining an optimization with this unresolved
result. This diagnostic ran on the Windows machine while unrelated import files
were being edited; measured overlay modules remained unchanged. It is not a
full frozen-candidate acceptance run.

The [attribution report](performance-evidence/overlay-attribution-82a1951.json)
records the earlier clean-source Node workload phases. Projection dominates the
three ordinary overlay fixtures; detection's custom painting phase includes its
algorithm work. Enabled instrumentation overhead in those fixtures was about
3.6-5.9%, while detection's small negative difference is noise, not a speedup.
The reproducible `scripts/performance/overlayComparison.mjs` now rejects dirty or
changed source trees at both ends of future comparisons.

`e1dde25` adds cooperative import normalization for GeoJSON, CSV, KML and GPX,
and cooperative Cesium entity creation. The previous microtask-only preview
yields did not permit browser input to run. The shared iterator consumer now
owns a single cancellable timeout and a four-ms work budget. Clear, replacement,
abort, failure and destruction release partial geometry, contexts and queued
work. The synchronous layer API remains available; the application awaits the
new async API, rejects stale workspace completion and prevents duplicate Apply
operations. Complete stored records, the 5,000-feature render cap, geometry,
evidence and stable entity IDs are retained.

JSON/XML/CSV decoding and one indivisible feature may still exceed four ms.
The visible `scripts/fixtures/import-batches.html` comparison checks exact final
pixels, populations, evidence counts and cancellation ownership. Its heartbeat
measure is an event-loop diagnostic, not the product's interaction-p95 gate.
Full application journeys and current hardware interaction acceptance remain
pending for this change until their exact-revision runs complete.

### Single-feature preparation experiment

`9d84ded` tested yielding within the Cartesian preparation of one permitted
50,000-vertex line or polygon. Twenty-four import tests, package boundaries and
the production build pass. All final coordinate hashes, including polygon holes,
match the baseline `9dacb7c`, and cancellation does not publish partial geometry.
The production change is reverted because completion cost regresses materially.
The comparison harness remains for further diagnosis.

The [first five-pair report](performance-evidence/import-geometry-9d84ded-exploratory.json)
overlapped a separate boundary/build job and is exploratory. The
[repeat without that competing job](performance-evidence/import-geometry-9d84ded-repeat.json)
uses five alternating pairs, three warmups per workload in each child process,
Node 24.16 on Windows, and no forced GC. Median maximum preparation tasks fall
from 9.32 to 4.20 ms for lines and 10.51 to 4.08 ms for polygons. Total completion
rises from 15.94 to 27.23 ms and 16.12 to 30.98 ms respectively (about 71% and 92%).
This identifies an unresolved scheduling/completion trade-off; it is not an
accepted activation improvement, browser interaction result or GPU comparison.
Single-feature preparation and raw document decoding therefore remain S59 gaps.
