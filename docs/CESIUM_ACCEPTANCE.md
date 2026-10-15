# Cesium completion and acceptance criteria

Policy: `gev-cesium-acceptance/2026-10-15`.

This amendment governs the remaining S47â€“S60 work. It supersedes conflicting
completion wording in the dated sections of [the performance plan](CESIUM_PERFORMANCE_PLAN.md).
It responds to the user's request to reassess acceptance, the available Windows
UHD 620 machine and Linux VM105, and the experiment results already recorded.
It does not change historical reports or waive earlier stable release,
accessibility, user-study or attestation requirements.

## Changes and reasons

| Previous ambiguity                                                                                          | Revised rule                                                                                                                       | Reason                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Implementation, experiment disposition and final hardware acceptance were presented as one completion count | Report engineering closure, automatic validation and candidate qualification separately                                            | A reviewed implementation can be finished before the final combined hardware run                                 |
| Some work orders demanded another design after every rejected optimization                                  | One supported rejection closes that named experiment; further experiments need a new measured reason                               | Preserving a proven renderer is a valid decision; an endless search for alternatives is not a finite deliverable |
| The candidate evaluator made a 20% speedup mandatory                                                        | Report the 20% dense/tracking objective as achieved, missed or unassessed, separately from qualification                           | The original plan specified a proposed target; a valid 15% improvement is not a correctness failure              |
| Physical Mac and discrete Windows hardware remained in the broad matrix                                     | Primary Windows UHD 620 qualification is required; unavailable physical platforms stay explicitly unverified                       | Only this physical Windows machine is available; hosted Metal and Linux functional checks have narrower scope    |
| Old intermittent frame failures could leave an indefinite root-cause requirement                            | Require the affected current full-application journeys and final candidate gates to pass; disclose any unresolved historical cause | A historical failure is not erased, but it need not block a later passing revision forever                       |
| Every slice appeared to need independent full hardware qualification                                        | Reuse one final frozen-candidate qualification matrix across its applicable slices                                                 | Component checks plus one integrated matrix establish different facts without redundant soaks                    |
| Lifecycle stress appeared in both paired workload coverage and the separate retention gate                  | Validate lifecycle stress only through the required full-soak retention report; keep its family visible with an explicit mode      | The standalone soak owns the 60-minute lifecycle contract and must not be double-counted as a timed pair         |

The 13 October evaluator correction at `6f635ecd` (reviewed Luna source
`4e4127f5`) emitted policy `gev-cesium-acceptance/2026-10-13`, reported each
target's actual percentage and achieved/missed/unassessed outcome, and derived
tracking coverage from measured tracking rather than target achievement. This
14 October revision increments the policy ID for the S47 validation-mode
reconciliation below. The prior revision passed 73 focused candidate,
comparison and retention tests. Standard integration passed all seven selected
jobs at containing revision `f50565a0` (see the
[exact-commit evidence](performance-evidence/integration-f50565a0/README.md));
historical results retain their original policy and outcome. See the
[implementation evidence](performance-evidence/acceptance-policy-20261013/README.md).
The 15 October amendment keeps those rules and records the new exact-head
physical Windows retention evidence without carrying its result to untested
workload comparisons.

## Status and counting

Each slice has four independent fields:

1. **Engineering:** open, partial, or closed. Closed means every required behavior
   is implemented and reviewed, and every named optional optimization has either
   an accepted implementation or a supported no-change decision. Record retained
   behavior, commit, tests and decision evidence. A deferred requirement stays open.
2. **Automatic validation:** passed, failed, pending or unavailable, with exact
   source and harness revisions. Passing component tests does not imply a full
   integration pass; report their scope.
3. **Primary-machine qualification:** passed, failed or pending on the declared
   physical Windows configuration. Other environments are separate coverage rows.
4. **Performance objective:** achieved, missed or unassessed, with measured values.
   This is not an alias for any of the other fields.

Publish two counts out of fourteen: engineering-closed slices and fully qualified
slices. Fully qualified requires engineering closure, applicable automatic gates
and the relevant final Windows evidence. Also report how many slices are partial.
Do not invent a percentage of code written or weight commits/tests as progress.
The packet-by-packet audits have closed S47-S59 engineering: **13/14 closed,
1/14 partial, and 0/14 fully qualified**. S60 remains the partial slice because
the matched baseline/candidate workload matrix, final release binding and VM105
reconciliation are not complete. S50 closure includes the reviewed rendered
retention comparison and real-layer workspace restore integration. S56 closes
the real caller cleanup gaps and explicitly retains framebuffer preservation.
S57 includes strict native production map/fault journeys and map ownership.
The physical Windows retention gate now passes on the exact current candidate;
it qualifies the applicable S49/S60 retention requirements without filling the
separate timed-workload rows for S47, S48, S51-S59. The fourteen-slice
denominator is unchanged.

## Requirements that remain mandatory

- Preserve Manual settings, visual detail, populations, resolution, MSAA, effects,
  label behavior, stable feature/evidence identity, picking and camera ownership.
  Auto remains opt-in. Fixes must preserve stored workspaces and references.
- Bind artifacts to the actual tested application, build recipe, harness, fixture,
  browser, renderer and environment. Missing metrics stay unavailable. A reported
  expected commit alone does not prove the running build.
- Keep exact fixture delivery, worker assets, cancellation, late-result handling
  and cleanup checks. Missing imagery, corrupt content, unexpected fallback and
  abandoned work remain failures. Correct the fixture when its contract is wrong;
  version it and preserve the failed original. Do not relax a cap or deadline to
  make an unchanged failing run pass.
- Required current-candidate failures block qualification. A short component
  success cannot replace a failed full scene, and hosted/software evidence cannot
  satisfy the physical Windows requirement.
- Keep local-control p95 at or below 100 ms and loaded replay-seek p95 at or below
  250 ms. A repeatable regression above 10% in motion p95, activation, peak heap
  or retained resources blocks acceptance of the affected optimization until it
  is fixed or reverted. An inconclusive comparison remains pending.
- Keep the separate 60-minute mixed-use retention run and final 30-minute heap
  growth limit of 5%. Application-owned resources must return to their equivalent
  warmed checkpoints; there must be no abandoned jobs or persistent ownership
  growth. Retain the current conservative automated checks. Cumulative event
  totals are not retained-resource gauges; legitimate bounded warm caches must
  be exercised during warmup, not excused after a failed measurement.
- Stable publication still requires the earlier release checks. Completion of
  this performance milestone permits only the support claims actually verified.

## Finite closure checklist by slice

Every row requires its applicable focused tests and review. The qualification
column refers to the shared final candidate matrix, not fourteen separate soaks.

S47 reporting names all seven families and their modes. Operating-view and the
four infrastructure variants use their actual registered producer identities;
the infrastructure family is covered only when datacenters, dams, cables and
the combined fixture are all comparable on the same primary environment.
Lifecycle stress is represented by the independent `performance-retention`
check. A paired `lifecycle-stress` row is rejected, and a passing soak cannot
fill a timed workload. Map-streaming remains a required timed family. Its five-run paired capture/export contract is implemented and automatically checked; diagnostic reports
and generic workload aliases do not satisfy it.

| Slice | Engineering closure                                                                                                                                                                                                       | Final qualification evidence                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S47   | Report all seven families with explicit validation modes: six timed families and lifecycle retention; build, fixture, settings, populations and absolute-time route checks work; delay negative control fails as intended; map-streaming has a five-run timed export contract | Five matched baseline/candidate runs for timed families, with complete identity and visual conditions; lifecycle uses the separate full-soak gate; map-streaming still needs real baseline/candidate browser exports and hardware qualification |
| S48   | Bounded opt-in timings and ownership inventory cover changed/retention-relevant paths; each metric names its source and units; disabled mode and overhead are checked; unsupported GPU timing stays unavailable           | Leading measured costs for each relevant workload; diagnostic runs separate from latency runs                                                                                                                           |
| S49   | Import, workspace, CCTV, terrain and picking lifecycle cases handle success, failure, cancellation and stale completion; current reproductions are fixed; worker interception and asset loading are verified              | Full affected Windows journeys and the current-candidate 60-minute retention gate; historical unexplained failures remain disclosed                                                                                     |
| S50   | All source/pose/terrain/parameter revisions participate in geometry ownership; one latest pending build per feature; equivalent visibility/restore reuses geometry; superseded results are disposed                       | Terrain/pose appearance, selection/frusta, build-count and rapid-edit checks                                                                                                                                            |
| S51   | Audit callbacks/holds once; adopt scheduled demand where measured useful and keep justified continuous owners; verify wake, visibility, final frame and teardown                                                          | At most two frames in ten seconds for a genuinely static settled fixture; periodic/animated fixtures retain their specified cadence                                                                                     |
| S52   | Validate projection/layout/text reuse, complete invalidation inputs, picking and accessibility mirror; retain painting if its measured cache experiment is rejected                                                       | Dense moving and static overlays retain content, placement, fades and interaction with no accepted regression                                                                                                           |
| S53   | Audit writes/membership/allocations; retain beneficial scratch/write changes; dispose of the frequency-split and opacity experiments by accepted change or evidenced rejection                                            | Selected-object, horizon, focus and fading equivalence; claim upload reduction only if uploads were actually measured                                                                                                   |
| S54   | Preserve record/evidence/pick identity and ownership; decide separately for datacenters, dams and cables whether batching improves the eligible representation                                                            | Individual and combined layers, activation/retention, duplicate names, legacy IDs, terrain/LOD and selection; a rejected dam/cable prototype need not be replaced merely to satisfy a conversion quota                  |
| S55   | Share valid tracked-frame data and remove measured redundant work while preserving invalidation and camera authority; record remaining work as justified existing behavior or a measured experiment                       | Follow/cockpit/CCTV/replay/manual transitions, tracking motion p95 and long tasks; the 20% target is reported separately                                                                                                |
| S56   | Shared fresh-frame capture owns every listener, timeout and surface; all callers and failure paths are checked; make an explicit preservation-default decision                                                            | Full application idle/moving/portrait/resized/restored/hidden capture matrix; keep `preserveDrawingBuffer: true` if disabling it is not demonstrably safe and beneficial                                                |
| S57   | Superseded imagery/terrain/tileset/comparison loads are retired; explicit retry and provider cache ownership work; native fixture coverage and rendered fault controls are complete                                       | Both-revision production map journey, repeated switching/streaming, unchanged detail/attribution and bounded resources                                                                                                  |
| S58   | Audit the named wind/weather/effect ownership paths; retain proven resource reuse and decide each proposed pass removal from measurements                                                                                 | Equal paths, vertices, frame times, colors/opacity/effect strengths; pause/resume, reduced motion, source and map-host changes                                                                                          |
| S59   | Cooperative preparation and bounded queues preserve complete records and selection; cancellation/stale refreshes cannot publish; decide decoding and UI work from measured blocking costs                                 | Large import and catalog/workspace journeys, complete data, total completion time and interaction limits; four milliseconds remains a batch target, not permission to truncate an indivisible record                    |
| S60   | Consume exact-source results, distinguish objective/support outcomes, reconcile branches, freeze one candidate, update reports and verify the deployed artifact                                                           | All mandatory available-environment checks, primary Windows comparisons and soak, remote dev identity and VM105 HTTPS/persistence checks                                                                                |

A no-change decision needs a named hypothesis, unchanged control, measured or
reproduced reason, affected visual/functional checks, retained raw evidence,
review and confirmation the rejected runtime code is absent. It closes only
that experiment. For example, the dam activation regression can reject that
batching design; it does not waive dam identity or resource cleanup. There is
no obligation to exhaust every imaginable alternative.

## Measurement and rerun rules

Use the original `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7` comparison baseline.
Keep application and harness revisions separate. An upstream integration or
fixture correction does not silently change that baseline. Its effects must be
represented in the candidate and its declared comparable settings.

For timed performance workloads retain five matched runs per revision, 30 seconds
of warmup and 60 seconds of measurement, counterbalancing execution order. Cold
activation is separate. Lifecycle stress also retains its operation/ownership
checks and the full 60-minute soak; a short timed route does not replace it.
Use identical fixture identity, route, fixed data/time, browser version, actual
renderer, viewport/drawing buffer and Manual visual settings. Profile and force
GC in separate diagnostic/retention runs, never in latency samples.

The 20% dense-motion and tracking objective remains visible with both actual
percentages. A target miss alone does not fail qualification; missing measurement
still leaves the comparison pending, and an actual regression still fails its
gate. Do not infer tracking workload coverage from whether its target was met.

Compare identical poses/timestamps. Predetermine and explain unavoidable
nondeterminism masks; never mask changed detail or rendering defects. Compare
on the same renderer rather than demanding identical pixels across GPU vendors.
Strict deterministic component comparisons remain strict.

An invalid environment sample (for example, an observed browser-version or
foreground change) is retained as invalid and replaced according to the same
declared recipe. A valid slow or failed sample cannot be dropped as an outlier.
Investigate a >10% result with one controlled repeat of the complete affected
pair set, retaining both sets; unresolved variability is pending, not passed.
After two unchanged failures without discriminating evidence, move to another
ready packet and return only with a concrete hypothesis/control.

Reuse existing component evidence for unchanged source and conditions, with its
original revision visible. New code requires affected checks; the frozen final
candidate requires full integration and the shared qualification matrix. A later
report-only commit may reference the tested code commit but is not itself the
tested application. Runtime/build/fixture changes invalidate the affected final
evidence; do not relabel old artifacts with a new SHA.

## Available environments and delivery order

| Environment                         | Required role                                                                                  | Claim boundary                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Physical Windows / Intel UHD 620    | Primary full-application visual, performance, capture, interaction and retention qualification | This hardware/browser configuration only                                            |
| Existing VM105 / Linux              | Supported Node/install/update/recovery and deployed application/API/worker/persistence checks  | No Windows or GPU-performance claim                                                 |
| Free standard GitHub runners        | Node 24/26, builds, onboarding, OS recovery and bounded browser/fixture integration            | Software and hosted Metal remain explicitly labeled supplemental rendering evidence |
| Physical Mac / discrete Windows GPU | Unavailable in this milestone; record unverified coverage                                      | Does not block primary-machine completion and must not be called passed             |

The native imagery correction and strict production map/fault journeys are
validated in the S57 closure packet. Current main has been merged into isolated
QA at `8b84a2e0`, preserving both sides of the picking tests. The 13 October
recheck finds fork and upstream main at `9beadbda`, already contained in QA;
dev `e8ccc268` remains fourteen commits behind main. Both-base standard CI and
release-artifact verification pass at `175f2cf3`; later Windows harness changes
pass the full local suite at `688619f5`. See
[the reconciliation record](performance-evidence/main-reconciliation-20261013/README.md).
These revision-specific results do not replace the final candidate matrix.

Then audit the fourteen closure rows against actual code/evidence, close only
supported decisions, implement remaining required behavior, and run the shared
Windows qualification. Freeze and test the merged candidate before promoting it
to remote dev or deploying its exact artifact to VM105. Preserve the existing
VM, HTTPS configuration, secrets, workspaces and rollback path.

The next status report must identify closed/partial slices, available-environment
passes/failures/pending results, objective achievement and unsupported platforms.
Neither this policy amendment nor a green subset of CI means all work is done.

The [14 October reconciliation](performance-evidence/main-reconciliation-20261014/README.md)
adds upstream GBFS name parsing at merge `b6d30c37`. Focused checks and [both-base integration at e53df518](performance-evidence/representative-pr-e53df518/README.md)
pass, including release-artifact verification and published-token checks. The
later test-only Windows ownership correction passes the full local suite at
`d8506d3b`. Prior refs/results above retain their historical scope; final physical
Windows qualification, dev promotion and VM deployment remain pending.

## 14 October 2026 primary Windows update

The exact candidate `0431412adb46f45497079fdd9e08c04b6e6c8b76` now has a
passing physical Windows UHD 620 mixed-use retention run. The run used native
ANGLE D3D11/WebGL 2 hardware rendering for 60 minutes and completed 252
iterations, 504 workspace reloads, 252 imports, 252 replay seeks, 252 archive
failure/recovery exercises and 252 camera recovery exercises. Post-GC retained
heap growth was 2.21%, warmed listeners remained at 644, and no worker or
application-owned pending jobs remained at the final checkpoint. This upgrades
the applicable S49/S60 hardware-retention status from pending to passed.

The state-predicate polling correction that made the run repeatable is covered
by focused tests. A prior run that stopped when the headed page became hidden
is preserved as a failed diagnostic; it is not counted as acceptance evidence.
S47 still needs the five matched workload captures and full settings/population
comparison. S60 still needs the final exact-candidate comparison, release
artifact/attestation verification and deployment reconciliation. Missing
physical macOS and discrete-Windows evidence remains unavailable rather than
passed, and the 20% performance objective remains unassessed.

## 15 October 2026 exact-head Windows update

The current merged candidate
`786583e0ee8a36a670fe81cd244e8923bf84014b` now has its own passing physical
Windows UHD 620 mixed-use retention run. Both `main` remotes point to
`f0a1b22dc82c6c5cd9690d07c1cdb297818da86f`, which is already contained in the
candidate. Exact-head push CI, pull-request CI and versioned-release checks pass.

The [revision-bound evidence packet](performance-evidence/windows-gpu-20261015/README.md)
records 3,606,892 ms, 252 complete iterations, 13 post-GC checkpoints, 2.34%
retained-heap growth, stable owned resources, zero final pending work, and a
graceful browser/process exit on native Intel UHD 620 / ANGLE D3D11 / WebGL 2.
The recording bundle passes the production integrity validator. This confirms
the applicable S49/S60 primary-machine retention and recovery status on the
newest candidate rather than carrying forward the earlier candidate's result.

S47/S60 performance acceptance still requires the declared five-run matched
baseline/candidate workload captures. Release artifact and attestation checks
must bind the final frozen candidate, and VM105 must be reconciled to that exact
artifact. Physical macOS and discrete-Windows coverage remain unavailable and
nonblocking under this amendment; the 20% objective remains unassessed until
the paired matrix is complete.
