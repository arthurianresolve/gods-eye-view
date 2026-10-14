# Cesium performance plan

## Current execution checkpoint - 14 October 2026

The [S51 engineering review](performance-evidence/closure-audit-20261013/README.md)
closes the render-demand implementation after the dense-cadence and independent
focus-deadline corrections. All five affected files match the reviewed packet;
its 74 focused checks and three negative controls remain valid. The callback
inventory now explicitly covers `preUpdate` work as well as render holds.
Counts are **7/14 engineering closed (50%)**, **7/14 partial**, and
**0/14 fully qualified**. Closed slices are S50, S51, S52, S53, S55, S56 and S57.

[Both-base integration at `e53df518`](performance-evidence/representative-pr-e53df518/README.md)
passes all seven selected CI jobs and release-artifact verification on each
base, including the latest GBFS merge. Each Node 24/26 ordinary suite passes
7,837 tests with five platform skips; Node 24 also passes fourteen allocation
checks. All thirty hosted recovery records and both published-token checks pass.
No stable release was published.

The [Windows ownership fixture correction](performance-evidence/windows-owned-process-d8506d3b/README.md)
at `d8506d3b` fixes a test assumption about independently owned processes without
changing the production helper or timeout. Its six focused checks and full local
suite pass: 7,832 ordinary passes, ten skips and fourteen allocation passes. The
prior failed assertion remains recorded. These checks do not qualify physical
Windows rendering, performance or retention.

The [S53 fleet audit](performance-evidence/s53-aircraft-audit/root-51033433/README.md)
now covers real producer membership, warmed cadence, write deltas, scratch
argument reuse and failure cleanup alongside the snapshot audit. Root passes
15 focused checks. The [engineering review](performance-evidence/closure-audit-20261013/s53-review.json)
retains measured satellite scratch/write reuse and rejects the split/opaque-only
experiments with their documented reasons. No GPU-upload or aircraft speedup
claim is made. Physical visual/performance qualification remains pending.

The [S58 stage census](performance-evidence/s58-postprocess-stage-census/root-8d9d79bd/README.md)
now checks actual selected-stage ownership, expected crossfade overlap and
teardown using real Cesium stages. Scoped tests and lint pass. It keeps GPU
passes unavailable and makes no effect-removal or timing-benefit claim; S58
remains partial pending the broader review and rendered qualification.

[The 14 October upstream update](performance-evidence/main-reconciliation-20261014/README.md)
is merged into QA at `b6d30c37`: localized GBFS names, 23 focused passes and
1,656-file formatting pass. The containing e53df518 revision now passes full
both-base integration above. Dev promotion and
VM105 rollout still follow final candidate qualification. The [acceptance policy](CESIUM_ACCEPTANCE.md)
keeps the physical Windows comparison, full-application visual/interaction
checks and sixty-minute retention run mandatory. Earlier checkpoints below
retain their original revisions and outcomes.

## Earlier execution checkpoint - 13 October 2026

The [S55 engineering audit](performance-evidence/closure-audit-20261013/README.md#s55-tracked-frame-work-and-camera-ownership)
now closes the tracking slice's implementation requirements. The current
[camera-ownership packet](performance-evidence/s55-camera-owner-851d6841/README.md)
passes 83 focused checks and a negative mutation control. Final rendered
transitions and Windows performance qualification remain pending.

The [matched empty-fleet diagnostic](performance-evidence/s51-render-demand/paired-6786-1069/README.md)
records 18 renders before (`6786f8dd`) and one after (`106918ee`) over ten
foreground seconds. The candidate passes the unchanged two-frame gate, matched
conditions, receipt-time and identified-canvas ownership checks. Both mixed-use
and durable workspace journeys pass; the separate tracking browser run passes
111 checks. Root passes 79 affected tests and 27 periodic-owner tests. A repeat
passes with zero idle frames. S51 remains partial: a further producer-path audit
found that the older one-second satellite schedule slows the dense catalog's
per-frame round-robin work; a focused correction is in progress. Hosted SwiftShader
with blocked OSM content does not qualify physical Windows or imagery delivery.
The [owner audit](performance-evidence/s51-render-demand/owner-audit.md) records
the remaining animated owners and periodic lifecycle coverage. Earlier failed
reports retain their original outcomes.

The [S49 stale rollback fix](performance-evidence/s49-stale-rollback/README.md)
at `673349bc` prevents older rollback completion from overwriting a newer workspace
and keeps delayed layer restores with their original owner. Root passes 258
affected checks and the original before/after reproduction. The corrected UI
regression at `7c9f65dd` also passes its full 20-test suite and rejects a missing
guard in a narrow negative control. Its [current rendered workspace and mixed-use
journeys](performance-evidence/s51-render-demand/38451571754/README.md) pass at
`7d4a52a8`; final Windows retention qualification remains pending. S49 is still
partial. The same run's new S51 probe fails before measurement because it assumes
a Cesium browser global that the application does not expose; its failure is
preserved separately from the passing workspace steps.

The [current representative PR matrix](performance-evidence/representative-pr-8c0b6f64/README.md)
passes all seven standard jobs and release verification against both dev and
main at frozen source `8c0b6f64`. Both merge trees match that source; all published
token checks and 30 recovery persistence records pass. Direct REST artifact
retrieval, checksum, manifest and signed attestation checks pass in both PR
contexts. These runs precede the S49 rollback fix above and do not validate it.
Earlier Windows timeouts and [artifact discovery failures](performance-evidence/representative-pr-d6a97e46/README.md)
remain historical failed evidence; their outcomes have not been rewritten.
Stable publication remains disabled.

The [main reconciliation record](performance-evidence/main-reconciliation-20261013/README.md)
confirms QA already contains both main `9beadbda` and dev `e8ccc268`. No further
merge or rebase is needed. Remote dev remains fourteen commits behind main;
promotion remains pending current checks. VM105 is unchanged.

[Standard integration at `fa0e8a49`](performance-evidence/integration-fa0e8a49/README.md)
previously passed all seven jobs. The subsequent S56 caller audit reproduces a
bounded black-frame sample-surface cleanup gap. Fix `d73f3c89` clears the surface
on every exit; all 199 affected frame/pointer/voice tests pass. The new PR matrix
includes this fix. Framebuffer preservation remains enabled, with no hardware
speedup or historical-stall root-cause claim.

The [native missing-metadata control](performance-evidence/s47-map-streaming/native-fault-38432631061/README.md)
now reaches automatic OSM fallback and explicit Esri retry. Its validator had
incorrectly required tiled terrain before the hidden globe first loads it.
Stage-specific correction `e701e0ff` passes 98 root checks, original-report replay
and three wrong-provider controls. Its [fresh native run](performance-evidence/s47-map-streaming/native-fault-38434748788/README.md)
passes complete missing-metadata validation, then correctly rejects a stale
startup-camera frame in the corrupt-metadata control. The reviewed post-positioning
frame boundary at `fe28df76` passes 100 affected root checks. Its
[fresh rendered run](performance-evidence/s47-map-streaming/native-fault-38436364036/README.md)
passes missing/corrupt recovery, then exposes an incorrect held-asset path.
Strict manifest-based correction `e0710bd5` passes the same 100 affected tests
and its [fresh native validation](performance-evidence/s47-map-streaming/native-fault-38439382587/README.md):
both healthy journeys and all three fault/recovery controls pass, including
superseded response release and cleanup. These are hosted integration results,
not physical Windows qualification.

The [13 October acceptance amendment](CESIUM_ACCEPTANCE.md) is authoritative for
remaining S47-S60 work. It separates engineering closure, automatic validation,
primary Windows qualification and the 20% performance objective. Rejected designs
may receive a supported no-change disposition; unavailable physical Mac/discrete
GPU coverage is explicitly unverified and does not block the primary milestone.
Visual, integrity, interaction, regression and 60-minute retention gates remain.
The candidate evaluator now separates target outcome at `6f635ecd`; root passes
73 focused candidate/comparison/retention checks. [Fresh standard integration](performance-evidence/integration-c7c47245/README.md)
passes all seven selected jobs at `c7c47245`, including Windows, Linux and macOS
profile recovery. The later map URL fix and S50 runtime change are checked
separately at candidate `dddef9eb`; the older pass is not their evidence.

The [fresh-document map fault runner](performance-evidence/s47-map-streaming/fault-outer-control/README.md)
at `cc3328e1` is implemented with independent candidate contexts, bounded stages,
owned cleanup and exact build/fixture/scenario binding. Root passes all 98 focused
page, delivery and outer runner checks plus lint, boundaries and formatting.
Rendered missing/corrupt/delayed metadata journeys remain pending; M3, S47 and
S57 are not closed by these local checks.

The [first rendered fault-document run](performance-evidence/s47-map-streaming/native-fault-38430980703/README.md)
at `c7c47245` completes the healthy baseline/candidate routes and candidate CLI,
then fails before fault injection because the new runner constructs a doubled
root slash. Fix `48efbf40` uses canonical URL construction; all 98 affected root
tests pass. The original run stays failed and a fresh rendered check is required.
The earlier [invalid audit-mode invocation](performance-evidence/s47-map-streaming/native-fault-invocation-38430705041/README.md)
is separately retained as a setup failure.

The [S50 bounded volume-retention change](performance-evidence/s50-viewshed-retention/README.md)
at `2731162b` reuses the current capped cohort, evicts obsolete hidden geometry,
uses weak source-owner tokens and updates tint without rebuilding. Root passes
110 focused ownership/source tests. The
[first rendered comparison](performance-evidence/s50-viewshed-retention/native-38437691743/README.md)
has exact pixel equivalence, zero builds across unchanged visibility cycles,
and bounded teardown, but fails the strict rebuild-control count (15 versus 14).
A production-factory reproduction finds metadata-only footprint resolution can
rebuild identical vertices. Reviewed fix `641cdd3f` passes 30 focused tests and
preserves genuine geometry/source invalidation. The
[fresh rendered check](performance-evidence/s50-viewshed-retention/native-38439815077/README.md)
passes at `fa0e8a49`, with exactly fourteen control builds and complete teardown.
The real coordinator/manager/CCTV workspace-restore test at `81a5cc79` waits for
drained preparation, checks retained primitive identity and verifies teardown.
All 183 affected root checks pass. The engineering audit now closes S50;
primary Windows and final-candidate qualification remain pending.

The [engineering closure audit](performance-evidence/closure-audit-20261013/README.md)
closes S50, S52, S55, S56 and S57 engineering. S52 retains its unchanged accepted renderer, 13
artifact hashes and 90 focused tests, and the supported paint-cache
rejection. S50 adds the strict rendered retention and workspace-restore evidence
above. S57 adds the native map/fault journeys and fifty passing ownership,
factory, host and retry tests. S56 adds actual caller cleanup coverage and the
explicit preservation-default decision. Counts: **5/14 engineering closed (35.7%)**, **9/14 partial**, and
**0/14 fully qualified**. The remaining rows still require their own audits;
the amendment alone grants no pass. Historical failures remain failed.

The [S53 collection mutation audit](performance-evidence/s53-collection-audit/README.md)
confirms scratch-object reuse and fewer attempted setters at identical positions.
Actual Cesium dirty notifications are unchanged in both static and moving cases;
this is not measured GPU upload reduction. Aircraft/membership work, allocation
and upload comparisons, and the blending disposition remain open. S53 stays partial.

[Fresh main reconciliation](performance-evidence/main-reconciliation-20261013/README.md)
finds both fork and upstream main at `9beadbda`. Local and remote dev still match
`e8ccc268` (697 ahead of main, fourteen behind). Reviewed QA merge `8b84a2e0`
combines QA `f50565a0` with main `9beadbda`, preserving both picking-test additions.
Root passes 485 focused integration checks and published layer-token checks
against both bases. The [merged-candidate CI run](performance-evidence/integration-4b60f453/README.md)
at `4b60f453` finishes with six selected passes, including Street Level, and one
Windows PowerShell readiness failure before browser recovery. The unchanged
helper passes locally; the hosted startup cause remains unresolved. Promotion
required outstanding Windows validation at that checkpoint. Fresh standard CI
at `c7c47245` now passes Windows recovery and all six other selected jobs. The
historical timeout remains failed, with its cause unresolved. The later corrected
candidate still needs its own integration result. A fresh fetch finds no newer
main commits beyond the reviewed merge.
QA remains separate from dev and the deployed VM; no history was rebased or
discarded. This supersedes the earlier zero-behind and unmerged checkpoints.

[Standard integration at `f50565a0`](performance-evidence/integration-f50565a0/README.md)
passes all seven selected jobs, including full Node 24/26 suites and builds,
Windows onboarding, Windows/macOS/Linux persisted-profile recovery and browser
journeys. The canonical v4 map corpus also passes its fixed-hash/parser checks
on all three operating systems. The separately recorded native map failure remains failed; these passes
do not establish matched performance, a hardware soak or complete slice acceptance.

The reviewed [v3 imagery coverage packet](performance-evidence/s47-map-streaming/imagery-coverage-v3/README.md)
at `b91dafa8` (source `223eb55b`) adds 506 level-13-through-15 tile identities.
The 578-asset fixture preserves existing pixels, terrain, geometry and route
bounds and remains below the unchanged 5 MiB limit. Root passes 107 focused
checks and independently compares all 33,161,216 new tile pixels to the original
formula. Buffer isolation and pinned inventory checks prevent fixture mutation
from changing its authority. Cross-platform v3 checks pass at `88420e23`;
complete native baseline/candidate journeys remain pending and the old failure
is retained.

[Native v3 run 38409997486](performance-evidence/s47-map-streaming/native-38409997486/README.md)
at `88420e23` completes the baseline's strict four-stack route, but the later
delivery audit fails on eleven missing lower-level imagery assets. Eight paths
are retained and three explicitly omitted. The fixture acknowledges all 217
matched requests; context, interception and probe retirement complete. The
candidate never runs. A [CPU replay of native imagery dependencies](performance-evidence/s47-map-streaming/native-imagery-dependencies-v3/README.md)
reproduces all eight retained missing paths. The complete dependency set for the
fixture terrain tiles contains 21 absent OSM images. The reviewed
[v4 correction](performance-evidence/s47-map-streaming/imagery-dependencies-v4/README.md)
at `ec71877a` supplies them, preserves all 578 previous asset buffers and passes
108 root focused checks. The
[native v4 run](performance-evidence/s47-map-streaming/native-v4-38416400160/README.md)
passes its baseline variant, with zero missing paths on either revision. Its
candidate CLI completes four samples, but outer validation fails because the
generic topology expects separate provider documents for samples that reuse
the measured map document. The [reviewed ownership correction](performance-evidence/s47-map-streaming/map-document-ownership/README.md)
at `155f2ac0` binds samples and cleanup inventories to the actual shared owner.
Root passes 90 focused tests and a raw-report replay with fourteen rejected
mutations. A [fresh native run at merged candidate `4b60f453`](performance-evidence/s47-map-streaming/native-v4-38420739560/README.md)
passes both production map journeys and candidate capture validation, with zero
missing or pending fixture requests. This is hosted Metal integration evidence;
physical Windows qualification and rendered fault/recovery controls remain
pending. The original run remains failed.

The [bounded fault-delivery adapter](performance-evidence/s47-map-streaming/fault-delivery-adapter/README.md)
at `c05d973a` supplies declared missing/corrupt/held metadata responses with
request-scoped acknowledgments and independent byte validation. Root's expanded
run found one stale test producer; after correction all 63 affected checks pass,
with the other eight suites unchanged. Production page wiring and rendered
recovery evidence remain pending; fault reports are never performance evidence.

An [S50 ownership audit](performance-evidence/s50-viewshed-retention-gap/README.md)
finds unchanged viewshed volumes are still destroyed/reconstructed across hiding
and re-enabling, despite wireframe reuse. Three production-factory CPU cycles
reproduce this inherited behavior. Bounded volume retention/tint reuse and rendered
validation remain implementation work; S50 stays partial.
The three omitted browser identities remain unknown. Do not repeat the failed
run unchanged or relax delivery checks.

Reviewed [explicit map retry correction](performance-evidence/s57-construction-fallback-retry/README.md)
at `e5ff5303` (source `6cb55a5d`) removes a failed source's cached fallback alias
so a later manual selection can retry it. Root reproduces the old failure and
passes all 50 map tests after correction, including concurrent attempts and
destruction during pending fallback. The defective function is identical in the
frozen baseline, current main and dev. Standard integration passes at `f50565a0`;
native recovery fault controls remain pending. Healthy-provider reuse and shared
fallback ownership are retained.

The [exact-commit Windows recovery run at `feb067d3`](performance-evidence/windows-recovery-38401057945/README.md)
now passes all prerequisites and all five persisted-profile recovery checks.
Settings, workspace contents and saved assets survive interruption, rollback,
upgrade and failed verification. All browser closes complete within the unchanged
five-second deadline without forced termination. This is hosted SwiftShader
functional evidence; the historical failures are retained independently.

A [new primary Windows frame-delivery diagnostic](performance-evidence/windows-frame-delivery-20261013/README.md)
on the existing `a92c6921` diagnostic build reports UHD 620/D3D11, 301 frames over
five seconds and no context loss. It is short component evidence, not a current
QA full-application capture, matched performance comparison or hardware soak.

Reviewed [map startup preparation](performance-evidence/s47-map-startup-flight/README.md)
at `2d7c59ad` (source `0e6b2de0`) waits through the source-owned delayed startup
callback, then cancels the active flight before assigning the declared route
pose. Preparation is reported separately from route time and cleaned up during
cancellation. Root passes 90 focused checks including actual Cesium negative
controls and historical failure-report compatibility. Native
[run 38404611321](performance-evidence/s47-map-streaming/native-38404611321/README.md)
then passes the baseline's strict camera/journey validation but fails the later
interception audit: 83 missing imagery assets, with all eight retained paths at
level 15 while the corpus includes levels 0-12. The candidate does not run. Fixing
that fixture coverage is separate from pinning cross-platform 3D Tiles bytes;
strict settings, route, readiness and timeout gates remain unchanged.

The reviewed [canonical 3D Tiles corpus](performance-evidence/s47-map-streaming/canonical-corpus/README.md)
at `da75e90c` (source `7b0387b9`) pins 22 files with fixed hashes/lengths and
explicit v2 fixture provenance. Root verifies all 72 produced asset buffers,
geometry and coverage remain identical to the old Windows/Linux fixture and
passes 106 distinct focused checks. Existing cross-platform jobs verify the
same complete manifest hash and all pass at `b4a9ac81`. This does not
resolve the separate missing level-15 imagery coverage or hardware acceptance.

Terrain readiness history is implemented on QA at `c0666072` (reviewed source
commit `ca892212`). It reuses completed-render observations, retaining the first
and seven recent samples per readiness transition, with at most 24 ancestry rows
each. The final sample retains its actual render time. Missing observations stay
unavailable; no worker state, rendering demand, deadline or acceptance gate changes.
Root independently passes 85 focused map/delivery/failure-report checks, 25-file
capture lint, formatting and package boundaries. The actual CLI and outer smoke
adapters retain all 192 ancestry rows; malformed and conflicting histories are
rejected. Hosted integration and fresh native execution of this change remain
pending.

Completed-journey failure evidence and bounded missing-asset identities are now
implemented on QA at `fa4e1e04` (reviewed source `843a1bcf`). Strict validation
still rejects the original failure. Its diagnostic envelope preserves observed
route endpoints separately from readiness cameras, up to four transitions, and
explicit unavailable observations. Missing native assets retain at most eight
canonical paths, with bounded counts and explicit omissions. URLs and provider
payloads are excluded. Root independently passes all 88 focused checks, including
failure serialization, missing observations, repeated callbacks and saturation.
This is diagnostic coverage; a successful native map journey is still pending.

The [standard run at `d93f95b6`](performance-evidence/windows-recovery-38395686888/README.md)
finishes with six of seven selected jobs passing. Windows recovery fails its
prerequisite test when a mocked PowerShell subprocess exceeds
five seconds, before browser installation. The same ownership test file passes
all 41 checks locally; the hosted delay's cause remains unproven. This is separate
from the older Chrome shutdown failure. Test-only correction `7542775e` now waits
for an actual PowerShell readiness marker before sending the mocked script, with
separate startup, execution and cleanup bounds and timing evidence. Root passes
all 74 recovery/shutdown prerequisites, including both actual PowerShell cases
and deterministic timeout/cleanup controls. Production deadlines are unchanged;
the later hosted validation at `feb067d3` passes as recorded above. Root also [reproduces startup camera
ownership interference](performance-evidence/s47-map-startup-flight/README.md)
with actual Cesium camera/tween code: both an active startup flight and a delayed
startup callback can overwrite the map driver's declared route pose. The source
is identical in baseline and dev. The past Metal endpoint was not retained, so
the reproduction establishes a defect without identifying that run's exact cause.

Local and remote `dev` match `e8ccc268`. Main has advanced to `9beadbda`,
leaving dev fourteen commits behind; the active QA branch contains the reviewed
merge and has no missing main commits. Promotion awaits merged-candidate checks;
no rebase or diff discard is needed. Later QA changes have not been promoted to
dev or deployed to VM105.

| Work item                                   | Implemented scope                                                                                                                               | Automatic evidence                                                                                                                                                                                                        | Remaining acceptance                                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Austin operating workload                   | Current dev contains the reviewed canonical capture/projection contract                                                                         | [Exact-dev capture review](performance-evidence/s47-austin-operating/root-review/native-38334288585-review.json) and its seven standard CI jobs pass                                                                      | Matched physical-hardware runs and final retention                                                                                                         |
| Native map corpus and build profile (M1-M2) | Deterministic 599-asset v4 corpus, native provider adapter and receipt-bound inert fixture profile                                              | Cross-platform parser checks and [both native revision journeys at `4b60f453`](performance-evidence/s47-map-streaming/native-v4-38420739560/README.md) pass with no missing assets                                        | Reuse this pinned corpus in remaining fault controls and Windows comparisons                                                                               |
| Native map capture (M3)                     | Driver/report core, candidate CLI/outer wiring and corrected shared-document ownership are in QA; bounded fault-delivery adapter is implemented | Both production healthy routes and candidate CLI pass in the [hosted Metal diagnostic](performance-evidence/s47-map-streaming/native-v4-38420739560/README.md)                                                            | Wire and render candidate-only missing/corrupt/superseded-response recovery controls; do not require the frozen baseline to contain the retry fix          |
| Full standard validation                    | Main is merged into QA and production map capture fixes are integrated                                                                          | [Merged `4b60f453` run](performance-evidence/integration-4b60f453/README.md): six selected jobs pass; Windows recovery fails its PowerShell readiness prerequisite                                                        | Resolve or obtain discriminating evidence for the prerequisite failure and complete current-candidate Windows recovery; later changes need affected checks |
| Optional Windows Chrome-version diagnostic  | Strict manual Windows selection, read-only executable metadata and runtime version binding; default unchanged                                   | [Chrome 155 run `38350953804`](performance-evidence/windows-browser-version-diagnostic/run-38350953804/README.md) passes all five recovery stages at `2336337c`, with natural exits inside the unchanged five-second gate | Earlier intermittent Chrome 152 shutdown cause remains unresolved                                                                                          |
| Final performance acceptance (M4/S60)       | Exact-commit evidence and rejection contracts exist                                                                                             | Component and hosted results retain their documented limited scope                                                                                                                                                        | Five matched runs per workload, visual parity, interaction targets and the corrected 60-minute retention soak on the primary Windows machine               |

The next implementation packet is the [production map-streaming workload](performance-evidence/s47-map-streaming/IMPLEMENTATION.md).
The [first native attempt](performance-evidence/s47-map-streaming/native-38349484331/README.md)
at `14472b5b` fails during inherited dense-population preparation on baseline
`eb8c682`, before the candidate capture or map journey. Empty page/interception
error lists do not establish a cause; probe and worker cleanup are unconfirmed.
The proposed dedicated setup at `1058e811` is withheld after
[independent cancellation and disposal-order review](performance-evidence/s47-map-streaming/native-smoke-review-1058e811.json).
It rejects one legitimate cancellation despite balanced outcomes and finalizes
baseline delivery before its owning context retires. The follow-up `64d86946`
balances cancellations but remains withheld after [root review](performance-evidence/s47-map-streaming/native-smoke-review-64d86946.json):
baseline disposal is still early, cancelled-only required kinds can pass, and
five actual no-undef errors would prevent final report writing. Correct these
defects without extending deadlines, weakening cleanup or changing normal dense
tests. Neither rejected packet has run in a browser or reached dev.
Correction `0960fef2`, integrated at `7e7e50d2`, addresses these defects and
passes [independent focused, lint, formatting and boundary checks](performance-evidence/s47-map-streaming/native-smoke-correction-review-0960fef2.json).
Both variants share post-target-close/interception-release finalization, and
baseline reporting receives its completed evidence after cleanup. Required
asset kinds now need acknowledged bytes. The next gate is the real production
browser run; these component results do not prove native rendered delivery.
The [next native run at `495f0a71`](performance-evidence/s47-map-streaming/native-38353841324/README.md)
reaches the baseline map journey but fails its visual-settings observer.
Cleanup is confirmed. Source review and actual application-method replay show
two nonexistent scalar intensity properties; the values are present in the
existing visual snapshot. Correction `02151a21`, integrated at `aab42890`, reads
that snapshot and passes 65 focused checks plus lint. The next browser attempt
must verify the correction before any map-readiness claim.

The [native retry at `975318f6`](performance-evidence/s47-map-streaming/native-38354738080/README.md)
fails with a protocol timeout. Source inspection identifies an incompatible
harness contract: one awaited browser command contains a 60-second route but
has a 15-second command deadline. The reached in-page phase is not retained,
so this report cannot attribute additional runtime slowness. The next
correction uses an owned asynchronous journey with short bounded observation
commands and explicit cancellation; route and outer deadlines stay unchanged.
Late probe-cleanup confirmation remains a failure. All seven standard jobs
pass independently at `495f0a71`, including five natural Windows recovery
exits; that result does not cover this later map execution correction.

The correction at `e7cd78df` plus `1303aaf3`, integrated at `d0f34f05`, starts
the owned page journey and polls its state with short browser commands. It
adds a 150-second monotonic host limit and a five-second cancellation-drain
timer while preserving the 60-second route, readiness limits, 15-second smoke
protocol limit and outer capture deadlines. Validated failure checkpoints and
cleanup outcomes now survive both CLI and outer smoke report serialization.
Root passes 82 focused checks; these use controlled page/transport seams and
do not establish a real rendered journey or hardware acceptance. The next
native browser run must validate this exact integrated correction.

The [browser run at `4385f69b`](performance-evidence/s47-map-streaming/native-38357799656/README.md)
passes initial photoreal readiness and retains a useful failure at the first
Esri switch. Actual Cesium provider replay reproduces the cause: it requests
`MapServer/?f=json`, while the fixture adapter accepts only the path without
the trailing slash. Operation, probe and interception retirement are confirmed;
native delivery remains failed. Correct the exact metadata route before
retrying; this does not require application or upstream-main reconciliation.
The exact-path correction `88e5266c`, integrated at `8c7f1204`, passes
73 root focused tests, lint and changed-file formatting. Its regression uses
the actual Cesium provider's metadata request and real delivery callbacks.
Complete rendered journeys remain unproven until the next browser gate passes.

The [run at `0cae3037`](performance-evidence/s47-map-streaming/native-38358638098/README.md)
confirms the Esri metadata correction: the provider and map controller become
ready without page or interception errors. It fails later at transition
readiness because the globe load queues do not empty within the existing
deadline. Operation, probe and interception cleanup are confirmed. The failed
report lacks the finalized fixture delivery summary and individual queue
states; the next diagnostic preserves those bounded observations before
attributing a cause. No completed baseline/candidate journey, performance
improvement or hardware acceptance is claimed.
Diagnostic correction `8001cb34`, integrated at `bfe6d5fe`, passes 80 root
focused checks, capture lint and changed-file formatting. It preserves bounded
queue states and finalized partial/error delivery without changing acceptance
rules. A separate pinned CPU probe reproduces failed child upsampling outside
the clipped terrain patch; the hosted queue report must still determine whether
this is the cause of the readiness stall. Neither result completes M3.
The [run at `1b4c8dab`](performance-evidence/s47-map-streaming/native-38361544218/README.md)
retains 51 acknowledged requests, complete delivery/owner cleanup and the
actual pending globe queues. Eight sampled in-route level-17/18 tiles have
ready imagery but no terrain mesh; their terrain state also permits waiting
for parent upsampling and is not proof of a worker rejection. Source/bundled
worker comparison and live ancestor readiness are the next diagnostic boundary.
Do not substitute the unrelated off-route CPU failures for that missing proof.
The follow-up at `75a50fbb` plus `13344b8b` adds bounded live ancestor evidence
and a reproducible source/minified-production worker replay. Root passes
81 focused checks, capture lint, formatting and package boundaries; both CPU
worker variants match on the exact level-ten through level-seventeen chain.
These component checks do not complete native readiness or hardware acceptance.
The [run at `7fbbf1fa`](performance-evidence/s47-map-streaming/native-38366041110/README.md)
now retains that boundary: the sampled level-seventeen tile waits on its
level-sixteen parent, whose mesh is `TRANSFORMING`; every ancestor through
level fifteen is ready. All 51 deliveries and cleanup complete. The snapshot
does not provide task age or prove abandonment. Distinguish continuing terrain
progress during camera motion from an unresolved task before changing runtime
code or acceptance limits. This native run remains failed.

The [same-code hosted Metal control](performance-evidence/s47-map-streaming/native-38376714168/README.md)
reaches a later route-start validation failure on baseline. It records 104
missing-fixture-asset errors, but loses completed journey observations and
missing asset identities before failure serialization. Owner cleanup completes;
fixture delivery remains failed. The generated fixture manifest also differs
from the SwiftShader run: six of 51 shared delivered assets have different
hashes. Investigate cross-platform fixture determinism as well as the bounded
failure-reporting gaps before using these environments for comparisons. No
GPU cause or physical-hardware acceptance is established.

Next actions, in dependency order:

1. Preserve the completed healthy M3 journeys at `4b60f453` and frozen baseline
   `eb8c682`. Their hosted Metal pass includes post-retirement ownership and
   delivery validation with unchanged visual settings, terrain detail, cache
   budgets and build profile. It does not complete hardware acceptance.
2. Finish candidate-only rendered missing/corrupt metadata, superseded switches
   and recovery controls. The frozen baseline retains its known retry defect;
   keep its reproduction separate from candidate recovery acceptance. Fault
   reports are diagnostic and cannot supply performance measurements.
3. Complete matched workload coverage, the measured remaining S48-S59 work
   and the S60 comparison/retention gates in the detailed ledger. Retain
   accepted optimizations only with their required visual and measured proof.
4. Continue shutdown-cause investigation from retained failures when evidence
   supports a discriminating check. The successful Chrome 152 and 155 runs
   establish compatibility observations, not a browser-version effect or fix.

The [earlier Windows shutdown failure](performance-evidence/windows-recovery-38341548120/README.md)
retains its observed close acknowledgement, live parent PID at the five-second
limit and forced exit. Subsequent passing observations do not erase it. The
[first Chrome 155 attempt](performance-evidence/windows-browser-version-diagnostic/run-38350501407.md)
fails before browser installation on a test-only noncanonical temporary path;
its correction preserves the production containment checks. The corrected
155 run validates exact identity, five preserved settings/workspace/asset
checks and natural shutdowns of 318-537 ms. Chrome 152 remains the default.

Primary Windows UHD 620 foreground hardware validation remains required.
Hosted paravirtual/software rendering, Linux VM checks and unavailable
additional physical GPU coverage stay separate. No missing manual or hardware
evidence is converted into a pass. All older reports below retain their tested
revisions, failures and original validation scope.

## Earlier integration evidence

Integrated S48 shader-program diagnostic: the opt-in owned-context observer
is implemented with bounded program/query rows, exact cleanup ownership and
CLI/workflow/report validation. Root passes 151 focused checks with unchanged
source hashes. The first hosted diagnostic at `3384b8bd` finishes five samples
but hits the unchanged child deadline before tracking run 2. Seven reached
observers restore their wrappers; generic failure serialization drops the
per-parameter detail, so complete attribution remains unavailable. Preserve
the failed report and fix bounded evidence retention before another run.
All seven standard integration jobs pass at exact `3384b8bd`; this does not
validate the failed attribution run or the subsequent retention repair.
The bounded retention repair now passes 159 independent focused checks with
unchanged source hashes. Per-document checkpoints retain direct and late query
rows separately, verify payload/reference hashes and commit/receipt provenance,
and require matching document identities for complete captures. The general
failure-report cap and all deadlines remain unchanged. The hosted repair run
at `e54eaded` retains hash-bound parameter rows from six complete contexts:
143 programs, 429 first queries and zero repeated same-parameter queries.
LINK_STATUS accounts for 99.998% of synchronous query elapsed time, supporting
first-use link synchronization in this Linux SwiftShader workload. The capture
still fails after four of six samples at the unchanged child deadline; the
seventh reached context is unavailable with unconfirmed cleanup. All seven
standard CI jobs pass at exact `e54eaded` in run `38293247484`; later changes
are documentation/evidence only. Neither failed run is performance acceptance.
[Implementation, source/profile audit and limits](performance-evidence/s48-shader-program-attribution/README.md)
keep whole-document synchronous GL-call time separate from GPU timing and
matched performance. Production rendering defaults are unchanged; S48 remains partial.

Latest S47 weather/wind capture packet: the full-application short diagnostic
passes at exact `1e6f6f98`, with all fourteen fixture assets observed, four
completed samples, stable populations/settings and confirmed owned cleanup.
All seven standard jobs pass at the same revision. Independent raw replay then
finds and fixes a missing cleanup-validation gate: the original successful
report still passes, while ten corrupted reports are rejected. Root passes
76 focused checks for the correction; all seven standard integration jobs
pass at exact `d3134124` in
[run 38284389582](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38284389582).
[Raw reports, replay and limitations](performance-evidence/s47-weather-effects-capture/README.md)
separate this SwiftShader integration evidence from matched performance and
physical Windows acceptance. S47/S58/S60 remain partial.

Integrated diagnostic checkpoint: tooling reached `dev` at `0d2324e6`, with application,
harness and test code matching the seven passing standard jobs at `f7e0709c`.
The failed performance captures remain failed; this does not complete a slice
or establish a performance gain.
The subsequent [tracking integration](performance-evidence/s48-current-dev-capture/README.md#tracking-integration)
passes all 111 checks at exact `0d2324e6`, with natural browser/process cleanup.

The [current-dev S48 diagnostic port](performance-evidence/s48-current-dev-capture/README.md)
preserves the newer camera/prewarm and streamed-map ownership fixes. Root full
Node 24 validation passes 7,413 checks with zero failures and ten existing skips,
including all fourteen allocation gates. That integration exposed and repaired
an eager Cesium import before invalid CLI argument rejection; the five-second
limit and fixture timestamp semantics are unchanged. Hosted Node 24/26 at
`73018ec5` then expose a test assertion comparing different timing origins;
the repair compares timeout and late acknowledgement from the same stage
origin and passes 36 focused checks. Production deadlines are unchanged.
The separate [capture diagnostic](performance-evidence/s48-current-dev-capture/README.md)
finishes four samples and three complete CPU profiles, then fails at the outer
180-second child deadline before tracking warmup can finish. Final cleanup and
post-capture byte verification are incomplete. No performance gain or hardware
acceptance is claimed; S47/S48 remain partial. The repaired diagnostic tooling
passes all seven standard jobs at exact `f7e0709c` in
[run 38272643470](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38272643470).
This supports tooling integration; optional soak/performance jobs and PR-only
layer-token checks were not run and remain separate.
The subsequent control at `f7e0709c` disables optional profiling with runtime,
visual settings and deadlines unchanged. It still fails idle warmup before any
sample; the completed-frame result and final cleanup acknowledgement arrive
late. Optional profiling alone does not explain the failure. The original
failure remains recorded and no deadline is relaxed.

Latest isolated S48 fixture-release ownership repair at `947f1e12` passes
117 focused tests and independent original/candidate actual-CLI checks.
It cancels prepared responses, drains issued commands, and closes the owned
target without disabling interception on a live page. Command and close errors
remain failures. [Exact hosted evidence](performance-evidence/s48-fixture-release-ownership/README.md)
confirms all three fixture releases and reached renderer cleanups, but run
`38265309601` fails idle sample 1 warmup before measurement. The raw report
preserves expensive initial-pose and prewarm picks, a zero-ms same-revision
repeat, and sampled upload/shader-query costs; the profile remains incomplete
after a profiler-disable timeout. This isolated tooling is now included in the current-dev port above;
S48 and hardware/performance acceptance remain partial.

Latest isolated S48 experiment at `7f4f5e07` confirms every reached renderer
cleanup at the unchanged one-second deadline, but fails before sampling on a
fixture command sent while its interception session is releasing. The raw
report and actual-CLI negative control are preserved in
[run38261098402 evidence](performance-evidence/s48-registration-retirement-38261098402/README.md).
The next fix targets fixture-release ownership; this is not a performance pass.

Latest S49 shared camera-verb ownership repair at `4d077c7f`
passes the independent old/candidate replacement reproduction and all 180
focused checks. Viewer replacement no longer carries old motion; retired
callbacks cannot control a replacement or reinitialized viewer. Production scene
cleanup releases shared camera ownership before viewer destruction. All seven standard integration jobs and 111 hosted tracking checks pass at
`68aff52b`; whole-application retention and S49/S55/S60 remain
partial. See [exact evidence](performance-evidence/s49-camera-verbs-ownership/README.md).

## Historical checkpoint - 12 October 2026

Latest S48 follow-up at `5441b038` fixes the demonstrated cleanup scope error
and passes 175 focused tests. Its [hosted failure artifact is preserved and independently hash-verified](performance-evidence/s48-capture-ownership-38257168750/README.md),
but startup registration removal exceeds the unchanged one-second deadline
before any sample. Reached observer cleanup is confirmed; this remains a
failed diagnostic, with removal scheduling requiring investigation. No
performance or physical Windows acceptance is established.

Latest isolated S48 diagnostic at `d1da56e4` completes six short samples but
fails its final cleanup with an out-of-scope `page` reference. Its enlarged
completed report exceeds the inline failure budget, so caller/frame rows were
not preserved; three CPU profiles are intact and independently replayed.
[The original failure and next correction](performance-evidence/s48-depth-pick-38254885790/README.md)
are recorded. This is a harness failure, not a performance or Windows pass.
The candidate stays outside `dev`; S48 remains partial.

Latest S49 ownership follow-up: the action-runner prewarm fix at `3907df04`,
integrated as `92e449ae`, removes the camera listener and queued debounce/idle
work after final runner disposal. Seven lifecycle regressions fail against
the unchanged parent; all 102 action-runner checks pass with the fix. The
independent reproduction drains to zero owned listeners/callbacks and performs
no late pick. [Exact evidence and limits](performance-evidence/s49-view-target-prewarm-ownership/README.md)
are preserved. All seven integrated CI jobs pass at `c39c52c8`. This is a specific
ownership repair; S49, physical Windows retention and S60 remain incomplete.

Latest S48 attribution: [independent CPU-profile replay and source mapping](performance-evidence/s48-depth-pick-attribution/README.md)
verify all four preserved profiles' sample totals. The failed `0602cbe2` idle
warmup has 2,205.398 ms of sampled native depth readback under the camera-target
background prewarm callback. Buffer uploads and shader-program queries are also
prominent. These are statistical synchronous API samples, not measured GPU time
or a matched performance comparison. Cesium already caches same-window picks
within its cache lifetime; caller/frame observations must establish useful
reuse before another cache or scheduling change is accepted. S48 remains partial.

Latest S50 correction: [exact camera-pose ownership at `61c050ca`](performance-evidence/s50-exact-pose/README.md)
prevents rounded `p1` key collisions from retaining stale DEM supports, accepting
late terrain responses, or admitting shipped supports for a calibrated pose.
Six old-runtime regression failures are fixed; all 83 focused checks pass. The
five-cycle CCTV lifecycle and five-pair native calibration checks pass at the
exact clean candidate, with independent raw-report revalidation. Integrated into
`dev` at `40b9f5c9`; all seven standard CI jobs pass. This is a specific
revision-ownership repair; full S50 terrain/pose visual coverage and physical Windows acceptance remain open.

Latest S47 diagnostic: [atomic warmup boundary at `0602cbe2`](performance-evidence/s47-atomic-warmup-38241920477/README.md)
keeps clock holding and completed-render listener installation in one page
callback, but its hosted run fails idle run 1 warmup with zero completed samples.
Page entry takes 2,712.367 ms and the late page settles after another 3,597.2 ms,
exceeding the unchanged six-second host deadline. The full held-clock snapshot
and a complete CPU profile of this failed document are preserved. Co-location
alone does not resolve the failure; the candidate stays isolated. Attribute the
measured frame work before another change. Earlier failed reports remain intact.

Latest S57 component: the [actual HTTP streamed-tile gate](performance-evidence/s57-flat-readiness-owner-38236552746/README.md)
passes at `e1a6f5e4`, including superseded-request cancellation, reactivation
delivery, ten measured switches and complete owned cleanup. The readiness
publisher now records its observed owner; the strict validator is unchanged.
Root independently replays the raw report and verifies identities and ownership
counts. This is hosted Apple paravirtual Metal component evidence; physical
Windows, matched route timing and full S57/S60 acceptance remain outstanding.
Integrated into `dev` at `48329a9f`; all seven standard integration jobs pass.
Prior failed reports remain unchanged.

The [failure origin review](performance-evidence/failure-origin-20261012/README.md)
separates inherited runtime defects, defects introduced by our features or test
tooling, rejected experiments, and unresolved environment/rendering failures.
It compares the live upstream and fork main refs at `591f299d`; no blanket
attribution of the remaining failures to upstream is supported.

Recorded integration checkpoint: `40b9f5c91355ccc37f7c2ca664f92893be4ccdb2`.
[All seven standard jobs pass](performance-evidence/s50-exact-pose/standard-ci-dev-38240973936.json),
including Node 24/26, all three recovery jobs, Windows onboarding and the browser
journeys. This integration includes the bounded Windows shutdown diagnostic,
which is off by default. Older reports remain historical evidence.
The earlier dev check at `2d18433c` has a preserved
[Windows recovery failure](performance-evidence/windows-recovery-38203843444/README.md).
Its third prior-install stage preserves settings and workspace data, then
Chrome acknowledges shutdown but does not exit naturally within five seconds.
Forced cleanup remains a failure. The fresh successful runs do not explain
that intermittent shutdown failure; root-cause diagnosis remains open.
The bounded shutdown diagnostic at `eac89bb8` passes 30 independent tests and
[all five hosted recovery stages](performance-evidence/windows-shutdown-diagnostic-38205914812/README.md)
with natural exits. No timeout recurs, so the process snapshot path is not
exercised by that run and the earlier shutdown cause remains unresolved.
A separate Windows control at `9a0b6a08` passes
all five recovery stages without forced exits, confirming intermittency; it
does not establish a fix for the failed shutdown.
Rendering runtime is unchanged from `bbca229f`; subsequent work includes
diagnostic tooling, a command-palette focus repair, evidence and documentation. The HUD summary ownership fix is integrated; it does not establish a GPU
readback speedup or resolve the Windows frame-delivery failure.

The [early-document CPU diagnostic](performance-evidence/s47-early-document-cpu-profile-38214581314/README.md)
at `626087cd` passes 49 independent focused tests and covers idle samples 1-2
plus first motion, preserving actual document identities and bounded sidecars.
Its hosted run fails earlier during fresh-document preparation, reporting two
fixture interception errors before any profile starts. Error details are omitted
from the failure artifact despite being collected internally. That reporting gap
must be repaired before another run; no rendering root cause, performance pass or
unchanged retry follows. Production defaults and capture deadlines remain intact.

The reporting gap is repaired on the isolated branch at `9ec1172c`: up to eight
sanitized errors preserve their document/session owner, callback phase and
active/releasing/released lifecycle. Failure-artifact creation and outer smoke
compaction retain this evidence. Thirty independent focused tests pass; the
[exact-commit hosted check](performance-evidence/s47-interception-failure-evidence-38217259994/README.md)
completes three samples and all three CPU profiles, then fails at the unchanged
180-second capture-child deadline during the fourth sample. No interception
errors recur. The profiles attribute 2.1-3.0 seconds of sampled stack weight per
window to the harness's renderer/vendor `getParameter` calls; those immutable
reads will move to the existing early context probe, preserving live settings
and population checks. Other leading stacks include application depth picking
and Cesium shader preparation. This is diagnostic SwiftShader evidence, not
performance acceptance. No failure filters or render deadlines were relaxed.

The isolated renderer-evidence repair at `2de9501c` passes 83 independent focused
tests. Identity queries now occur once at real Cesium context creation; later
observers retain live context/settings/population checks. Variable query costs
remain reported without changing matched workload equality. Its
[hosted check](performance-evidence/s47-common-renderer-evidence-38219550027/README.md)
fails during baseline probe cleanup, before candidate measurements. The old helper
collapses exceptions and timeouts, so the exact failing cleanup step is unknown.
Bounded phase-specific evidence is the next correction; all deadlines stay fixed.
This is an isolated harness repair, not a demonstrated runtime performance gain.

The [cleanup diagnostic at `4f3f8de8`](performance-evidence/s47-renderer-cleanup-evidence-38221367337/README.md)
reproduces and identifies the phase: baseline document cleanup succeeds in
869.320 ms with the hook restored and both listeners removed. Future-document
registration removal consumes the remaining 130.480 ms of the shared one-second
budget and acknowledges completion late. The run correctly remains failed,
before candidate capture. Eighty-four independent focused tests pass. The next
ownership correction retires the future-navigation registration immediately
after its one required navigation while preserving current-document context
listeners through measurement. No deadline increase or GPU/root-cause claim
follows from this diagnostic.

The isolated lifetime correction at `3faa0afb` passes 88 independent focused
tests and removes the future-document registration after navigation. Its
[hosted run](performance-evidence/s47-renderer-cleanup-lifetime-38222535286/README.md)
confirms that removal in 889.862 ms, but final document cleanup itself now exceeds
the unchanged one-second deadline and completes late. Candidate measurements are
not reached. Browser scheduling delay versus cleanup execution remains unmeasured;
the correction stays isolated and the complete cleanup gate remains failed.

The [page-local timing diagnostic at `a342c54a`](performance-evidence/s47-renderer-cleanup-timing-38225433300/README.md)
passes 90 independent focused tests. Baseline smoke cleanup passes, but candidate
capture fails while replacing its main setup document, before measured samples.
The timed-out operation takes 0.100 ms inside the page and acknowledges completion
after 1,975.751 ms. The hook and both listeners are removed; the original timeout
remains failed. This locates the delay outside the cleanup callback without
distinguishing task scheduling, protocol delivery or host scheduling. A bounded
retired-document render-loop experiment follows; measured windows and deadlines
remain unchanged.

The [retired-document experiment at `09fec83f`](performance-evidence/s47-retire-render-loop-38227044680/README.md)
completes all six captures and three CPU profiles, with all eight CLI document
cleanups confirmed within the unchanged one-second gate. The outer validator
then fails because it reads an obsolete fixture-clock `start` field. Repair
`e3f7e096` validates the current phased producer, passes 70 focused tests, and
accepts the six retained clock records without changing the failed report.
Its [replacement exact-commit run](performance-evidence/s47-fixture-clock-contract-38228543716/README.md)
fails earlier again: main-setup retirement exceeds one second before any sample,
and the late response says `Target closed`. Moving document retirement ahead of
worker/fixture teardown is the next isolated ownership correction; the timeout
and clock-integrity gates remain unchanged. No renderer/vendor
`getParameter` calls are sampled in the three new profiles; application depth
picking and Cesium shader preparation remain prominent sampled stacks. This is
instrumented SwiftShader attribution, not latency or physical Windows acceptance.

The retirement-order correction at `29dc9f51` now runs the existing bounded
document retirement before worker audit, progress-binding disposal and fixture
interception teardown. A failed retirement prevents those later steps, leaving
outer cleanup responsible for the document. Root passes 64 focused tests; adopted
formatting and package boundaries pass. Its
[exact-commit run](performance-evidence/s47-retirement-order-38230635126/README.md)
passes setup retirement and two idle samples, then fails first-motion profiler,
scene-diagnostic and progress-binding cleanup after delivering both boundary
frames. Two profiles are complete; the third remains incomplete. The user's
[same-commit retry](performance-evidence/s47-retirement-order-retry-38231901628/README.md)
fails during baseline cleanup before candidate execution: a 0.200-ms page
callback acknowledges retirement after 1,208.135 ms, exceeding the unchanged
one-second gate. Neither failure is performance acceptance. The next ownership
review must move retirement to the end of observations before teardown, without
shortening measurements or relaxing deadlines.

The [S57 map-switch comparison at `3453fab5`](performance-evidence/s57-stream-comparison-38225231367/README.md)
executes five switch pairs and the native selection/recovery cases, then fails
report validation. Its publisher omits required ownership fields and overwrites
the comparison snapshot after later intentional collection replacements. Repair
`0c221261` freezes evidence at observer retirement and passes 46 focused checks,
formatting and package boundaries. Its [rendered fixture and unchanged validator pass](performance-evidence/s57-observer-epoch-38226108308/README.md),
but the workflow fails afterward because its log printer rejects the 3.2 MB raw
report. The full artifact survives. Correction `14f903cb` logs artifact identity
instead of its payload, preserving both the full upload and the existing log
limit. Its [exact-commit workflow passes](performance-evidence/s57-artifact-log-38226672796/README.md):
root independently validates ten measured transitions, four setup transitions,
stable four-entry provider caches, no new factory loads during measured switches,
zero pending work at ready boundaries and all native selection/recovery cases.
The fixture is integrated through `68ccdb92`; all seven standard jobs pass at
`4562e8ec`. Failed artifacts are preserved. Actual streamed 3D Tiles coverage,
physical Windows and full S57 acceptance remain gaps.

The first [actual HTTP 3D Tiles candidate at `bd347221`](performance-evidence/s57-tiles-streaming-38230236414/README.md)
passes 26 root-focused checks but fails its hosted content-supersession phase.
The manifest is delivered and the stale factory does not replace the flat owner.
After a content request is paused and the map is superseded, Chrome ends the
request before it reaches the server. The fixture records no cancellation reason
and incorrectly waits only for delivery. A correction must distinguish observed
cancellation from failure, verify real delivery after reactivation, and await
independent browser HTTP observations before capturing checkpoints. All owned
observers and the tileset are cleaned up, but no warmed tile pair completes.
This component remains isolated and the failed artifact is preserved.

The [cancellation/recovery correction at `ae477251`](performance-evidence/s57-tiles-cancellation-recovery-38235132582/README.md)
records an actual browser abort, real delivery after reactivation, and all five
warmed streamed-tile pairs with bounded cache ownership and cleanup. Final
validation fails because generic flat-terrain readiness omits an owner field
that the validator and synthetic test data assumed existed. The required owner
must be observed and published at readiness; the gate is not removed. All 21
focused tests passed but missed that producer contract. The failed raw report
remains preserved and no S57 completion is claimed.

A [fresh Windows Chrome tab](performance-evidence/windows-webgl-current-window-20261012/README.md)
restores screenshot delivery at an observed 894 x 529 viewport, while the old
fixture reported only 83 CSS pixels of document width. The standalone WebGL
diagnostic still delivers just 13 frames in five seconds (maximum gap 1,016.8 ms),
versus 300 callbacks and a 24.7-ms maximum gap for the no-WebGL control. Focus,
visibility and canvas intersection remain stable; desktop occlusion and system
load are unverified. This preserves fresh failure evidence at fixture `a92c6921`,
not current-dev or hardware acceptance, and does not establish a driver cause.

S47-S60 are still partially implemented. The isolated S54 candidate keeps Entity
defaults. The dam and cable collection experiments are now
**rejected for promotion**, under the plan's measured-benefit and visual gates;
their source and failed evidence remain on the isolated QA branch. This is an
experiment disposition, not completion of S54. The datacenter candidate remains
isolated for physical Windows and mixed-layer acceptance. See the
[disposition and remaining work](performance-evidence/s54-current-dev-20261012/README.md#experiment-disposition---12-october-2026).
The narrower datacenter candidate at `9a0b6a08` passes 92 independent focused
tests. Its [first rendered integration check](performance-evidence/s54-datacenter-isolated-38204994341/README.md)
fails in the Entity control: the fixture passes a nonexistent `layerId`
property instead of the layer API's `id`, rejecting native picks despite
settled geometry and completed frames. Correcting that caller and rerunning
the exact-commit check precede new benefit acceptance; the failed report is
preserved and production defaults remain unchanged. The
[corrected run at `f09aa36a`](performance-evidence/s54-datacenter-layer-id-38205435137/README.md)
accepts the point identities, but both stem picks return no object. It delivers
21 completed captures with ready geometry, then fails without a paired sample.
The remaining pick failure needs attribution; the independent benefit fixture
cannot override it.
The [bounded selection-order diagnostic](performance-evidence/s54-pick-path-38208241120/README.md)
at `8ae0a4dd` still fails: ten same-frame calls produce four point hits and
six stem misses, with selection restored. Its last image contains only the
point, despite declared geometry/data-source readiness. The prior failed run
eventually captured visible stems. No later-frame control completed before
the existing deadline, leaving actual stem materialization/readiness unresolved.
The [current-primitive diagnostic at `7a169618`](performance-evidence/s54-primitive-readiness-38212601518/README.md)
passes 48 focused tests and completes both renderer lifetimes in its hosted run;
the prior readiness failure does not recur, so its post-failure observer remains
untriggered. The run instead exposes a duplicate fixture comparator that rejects
expected renderer-specific pick metadata. Repair `24bebb1b` uses the existing
shared identity comparator and passes 15 focused tests. Independent decoding of
all twenty PNGs finds nine identical pairs and a 16-pixel difference in the first
camera-change pair. Replaying the raw report with the repaired comparator still
rejects that image difference. The visual cause remains unresolved; no unchanged
rerun, performance acceptance or production promotion follows.
The [current-update readiness check at `d94bfa16`](performance-evidence/s54-current-update-readiness-38216619573/README.md)
now passes both renderer lifetimes. It requires a successful current
`DataSourceDisplay.update()` and unchanged collection revision at the captured
frame, rather than relying only on latched `ready`. Root passes 69 focused tests
and independently decodes all twenty PNGs: all ten paired images are identical,
including all camera-change pairs. All thirty readiness observations qualify,
observer ownership is restored, and Chrome exits naturally. This closes that
instrumented hosted correctness check; it does not establish physical Windows,
latency, mixed-layer or final-soak acceptance. The earlier 16-pixel failure remains
preserved, and production Entity defaults remain unchanged.
The [standard gate at `5ba9a940`](performance-evidence/s54-current-update-gate-38218238754/README.md)
makes that current-update condition mandatory for ordinary datacenter captures,
without requiring diagnostic mode. Seventy independent focused tests pass;
the normal hosted report passes its default validator, all ten PNG pairs are
byte-identical, native point/stem ownership is verified, and teardown and natural
browser exit pass. The current hosted component correctness gate is closed;
physical Windows, mixed-layer and final performance/retention acceptance remain.
The [same-commit benefit comparison](performance-evidence/s54-datacenter-benefit-38205683313/README.md)
completes twenty runs with verified native owners and twenty byte-identical
image pairs. Whole-activation median improves 22.12% and enabled JS heap
16.15%, while source-ready median worsens 36.99% in a different phase of that
activation. Subsequent source review confirms that the two renderers place work
on different sides of the source-ready boundary, and the current-update gate
above closes the hosted pick/capture correctness check. Physical Windows,
mixed-layer and final retention acceptance remain open; this is hosted component
evidence only.
Datacenter component comparisons show repeatable activation and JS
heap benefits with identical captured pixels. The fresh dam comparison regresses
source-ready time by 15.02% despite lower heap, and fails benefit acceptance;
the earlier cable map-switch readiness failures remain unresolved. A subsequent
[cable comparison](performance-evidence/s54-cable-camera-38188781699/README.md)
passes readiness but fails all five camera-change image pairs with 50 different
pixels and different final geometry. The final-settling threshold and follow-up
render repair pass focused tests on the isolated candidate; its
[rendered retry](performance-evidence/s54-cable-settle-38190313885/README.md)
stops earlier because map-restoration geometry completes after the readiness
deadline. The repair therefore has no accepted rendered comparison yet.
The [classification attribution run](performance-evidence/s54-cable-attribution-38194333722/README.md)
completes all twenty captures at `12b2b6c9`, but all five camera-change pairs
still differ (114 pixels, different geometry, identical final camera). Map
classification changes replace the ground-line owner in both modes. The
notification control retains its owner; its timing includes initial geometry
readiness. The [geometry attribution run at `9752656c`](performance-evidence/s54-cable-geometry-38195525961/README.md)
captures the complete Entity witness, then times out in its later lifecycle
checks before the collection comparison. That partial result preserves the
failure; collection defaults stay off.
The [isolated lifetime run at `dc1f416c`](performance-evidence/s54-lifetime-isolation-38197633597/README.md)
now reaches both renderers. Independent decoding confirms all ten image pairs
match, while the fixture reports matching coordinates and picking. It remains
failed: Entity re-enable cycle 0 stops delivering completed frames and reaches
the unchanged 12-second deadline. Its owned viewer is destroyed; collections
then complete both lifecycle cycles and cleanup. The earlier visual mismatch
is not explained by this run. Bounded CPU/worker attribution and cross-run
visual diagnosis remain required before acceptance.
The [opt-in re-enable observation at `161b8896`](performance-evidence/s54-reenable-attribution-38199540554/README.md)
captures a successful Entity cycle, while the collection renderer now fails
re-enable cycle 0 outside that observer's coverage. Independent decoding finds
162 different pixels in every camera-change pair; full coordinate witnesses
confirm 287 changed hidden references and no changed visible references.
Their causal relationship remains unknown. Observation must cover both
renderer lifetimes before another lifecycle conclusion is drawn.
The [expanded coverage run at `01521081`](performance-evidence/s54-reenable-coverage-38201597528/README.md)
fails earlier, before any re-enable cycle: Entity photoreal classification and
the collection initial control finish ground-line preparation after 12,243 ms
and 13,332.5 ms respectively, beyond the unchanged 12-second deadline. Frames
continue during the recorded build phases. Zero re-enable observations and zero
matched image pairs are available; all four missing observation identities are
explicit. Late geometry readiness is a separate symptom from the earlier frame
delivery loss. The candidate remains isolated and no performance acceptance is
claimed.
S47's additional infrastructure workloads are under review:
the frozen-clock correction completes four samples, but
[outer worker-audit validation fails](performance-evidence/s47-infrastructure-smoke-38189117919/README.md).
The [next run](performance-evidence/s47-infrastructure-smoke-38190043475/README.md)
preserves a bounded capture projection and exposes a broader producer/validator
mismatch: infrastructure uses one measured document, while validation assumed
the dense workload's per-sample documents. The
[contract repair at `c21b3f21`](performance-evidence/s47-infrastructure-smoke-38193087266/README.md)
now passes the actual datacenter capture CLI and independent validation of
its complete raw report. The [dam workload also passes](performance-evidence/s47-infrastructure-smoke-38193737422/README.md),
and all seven standard jobs pass at this revision. The
[cable workload](performance-evidence/s47-infrastructure-smoke-38194088714/README.md)
and [combined workload](performance-evidence/s47-infrastructure-smoke-38194757027/README.md)
also pass their actual capture CLI and independent complete-report validation.
The [dense workload check](performance-evidence/s47-dense-smoke-38195133406/README.md)
fails after its first idle measurement at the completed-render boundary. It
delivers all 2,500 aircraft, but its long tasks and timeout need separate
host/page/render attribution. The harness integration is held; existing
deadlines and acceptance requirements remain unchanged. No timing acceptance
is claimed from this short, instrumented SwiftShader smoke.
The [bounded boundary diagnostic at `1b1fdb26`](performance-evidence/s47-boundary-observation-38196702994/README.md)
fails earlier during warmup. Its per-boundary progress-binding setup consumes
4,075 ms of the 6,000 ms host window; the subsequent page entry and render
request are acknowledged, but no completed frame arrives before the deadline.
This setup perturbs the boundary and does not explain the original failure.
The [pre-warmup binding correction at `bbf4e88f`](performance-evidence/s47-prewarm-binding-38198470641/README.md)
now completes two idle samples, with setup outside the boundary and all owned
bindings removed. It still fails the first motion sample's measurement boundary:
page-entry acknowledgement reaches the host at 5,987.5 ms of its 6,000 ms
window. The measured interval and long tasks remain large. These host receipt
times do not establish GPU time or one-way dispatch delay. The harness stays
unmerged pending attribution; deadlines remain unchanged and failed reports
remain separate evidence.
The [frame-attribution attempt at `827223f5`](performance-evidence/s47-frame-attribution-38200958796/README.md)
fails before installing its new observer: the diagnostic worker audit validates
12 blobs but counts 14 at restoration. Native-wrapper restoration and registry
cleanup succeed. The diagnostic path still separates its asynchronous reads
from restoration, while prewarm already uses an atomic snapshot. This harness
race was subsequently reproduced and repaired at `6ca6373e`. Its
[rendered check](performance-evidence/s47-atomic-audit-38202268223/README.md)
keeps creation/restoration counts consistent at 14 and confirms native-wrapper
restoration and empty registry. It still fails before any sample: one worker
target is observed after the frozen boundary. The current guard rejects every
late target, including potential delayed publication of already-frozen code.
That distinction needs a deterministic test and exact URL/body validation;
new or unaudited executable targets must remain failures. This result does not
explain the remaining rendering delay or provide a timed sample.
The [delayed-publication correction at `788b2bd8`](performance-evidence/s47-delayed-publication-38203199807/README.md)
passes 58 independent focused tests and retains strict validation of frozen
code. Its rendered run gets past audit, completes two idle samples and one
motion sample, then reaches the unchanged 180-second capture-child deadline
while preparing motion run 2. The motion observer cleans up and records
multi-second update/render spans. Its observer intentionally omits function
names and URLs; the bounded failure projection also truncates script timings.
A separate CPU profile is needed for function attribution. This is a failed short SwiftShader diagnostic, not
an accepted benchmark or a cause for the separate physical Windows stall.
No unchanged retry or deadline increase is justified; the harness remains
isolated pending complete integration evidence.
The [first-motion CPU-profile packet at `73e6c72c`](performance-evidence/s47-first-motion-cpu-profile-38210121293/README.md)
passes 40 independent focused tests and preserves bounded profiles outside the
failure projection. Its hosted run fails earlier, at idle run 2's six-second
measurement-boundary observation gate, before profiling starts. No sidecar is
available. Progress-binding removal also times out; wrapper-confirmed child
cleanup does not convert that cleanup failure into a pass. Earlier-document
profiling is required to cover the demonstrated idle-stage stall; no runtime
cause or physical Windows result has been established.
Austin, weather/effects and map-streaming workload
coverage remain open. Physical Windows performance acceptance and the final
candidate's full matched captures/retention soak remain pending.

[Current integration and S54 evidence](performance-evidence/s54-current-dev-20261012/README.md)
records exact revisions and separates implementation, automatic checks and
hardware coverage. The Windows GPU configuration export confirms hardware
acceleration only. New matched static/animated WebGL controls at `a92c6921`
retain 533-550 ms frame gaps while plain RAF reaches 301 frames in five seconds
with an 18.5 ms maximum gap. Changing pixels does not eliminate the stall;
the physical window's occlusion state is unverified. Historical checkpoints below retain their original failures
and limitations; their old branch/promotion statements are not the current state.

The animated diagnostic branch's earlier standard CI fails the inspector
focus-return check at `qa-accessibility.mjs:61`; six other jobs pass. Bounded
focus diagnostics at `5d0e3391` subsequently pass
[all seven jobs](performance-evidence/windows-gpu-20261012/standard-ci-focus-diagnostic-38194930631.json).
The earlier failure is still unresolved; a passing instrumented run does not
prove its cause or remediation. The existing timeout and focus requirement
remain unchanged. Diagnostic tooling can be integrated independently of that
open focus investigation and the minimal WebGL frame stall.
That tooling is now integrated at `c3c6c5a7`, including a passing browser gate.
The [focus fix at `311cc5ea`](performance-evidence/command-palette-focus-311cc5ea/README.md) removes redundant focus restoration in the
palette's queued close handler. Delayed-close and close/reopen unit regressions
fail against the old code and pass after the fix; a deterministic native-dialog
browser regression and all seven standard CI jobs now pass. The historical
failure has no focus trace, so this reproduction does not conclusively attribute
that particular run. The exact-commit evidence records this repair separately
from the unresolved Windows rendering and performance gates.

## Historical integration checkpoints

Integration checkpoint (12 October 2026): the S50 map-source ownership repair,
connection-scoped map-bridge cleanup and measured macOS recovery backend pass
[all seven standard CI jobs at `501aa8d8`](performance-evidence/s50-macos-recovery-38174948494/standard-38177697638/ci-run.json).
Independent inspection of the three raw recovery reports confirms all 15
stages preserve settings, workspace bundles and asset digests, with natural
browser exits within five seconds. The integration is pushed to dev at
`acc471e4afb4ff629244ec37caf2836b6aef89ef`; its difference from tested `501aa8d8`
is documentation only. This closes the
integration blocker, not full S50 or physical Windows/performance acceptance.
The rejected S59 scalar experiment remains on its separate opt-in QA branch.

Windows retry (12 October 2026): the user-exported Chrome GPU configuration
confirms hardware-accelerated WebGL on Intel UHD 620 / ANGLE D3D11 with zero
GPU-process crashes reported. A minimal WebGL retry still has a 1,016 ms RAF
gap while 20 ms timers continue. Its build identity is missing and the canvas
is only 90% in the viewport; it is retained as diagnostic evidence, not accepted
performance or soak evidence. Identified controls at `acc471e4` subsequently
reproduce an 850 ms WebGL RAF gap with the whole canvas visible (60 frames in
five seconds); the matched plain-RAF control receives 286 frames with a 200 ms
maximum gap. The minimal page contains no Cesium. Desktop occlusion is still
unavailable; the cause and full hardware acceptance remain unresolved.
[Configuration and raw results](performance-evidence/windows-gpu-20261012/README.md).
The exact `acc471e4` revision also passed all seven standard jobs in
[CI run 38183006552](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38183006552).
Its optional soak and push-inapplicable layer-token checks were skipped, not
passed; the Windows hardware frame stall remains a separate unresolved gate.
The subsequent fixture-only A/B/B/A preservation control at `b48c2e30` keeps
dimensions, context settings and visibility matched. Both true and false retain
783-1,000 ms maximum RAF gaps; disabling preservation does not eliminate the
stall. Production defaults remain unchanged. Raw controls and limited wind
observations are retained in the same evidence packet.

Previous dev checkpoint (11 October 2026): point integration is pushed at
`ba7c8738b8505244be06d0f0e3bd873e02d6b2ca`. [All seven standard CI jobs](performance-evidence/import-point-current-dev/validation-38171991819-ci.json)
pass on that exact revision: Node 24/26 suites and builds, three-OS recovery,
Windows onboarding, and browser journeys. The corrected frozen 60-minute hosted
soak at `7cea7aac` passes its supplemental retention gate; there is no intervening
runtime change in the promoted point integration. Physical Windows and final
performance acceptance remain pending.

S47 diagnostics: [atomic worker audit](performance-evidence/s47-atomic-audit-38171616725/README.md)
and [probe document disposal](performance-evidence/s47-probe-disposal-38172276737/README.md)
now complete, but the latter run fails waiting for a warmup render. Follow-up
`abb5c3d5` adds bounded held-boundary progress events; its run stops earlier on a
fixture interception error. [Cause capture at `d081a114`](performance-evidence/s47-fixture-cause-38173405378/README.md)
identifies a queued callback using Fetch after its document owner disabled it.
`c9447d40` disposes interception callbacks before protocol teardown; 56 focused
checks pass. [Smoke 38173706259](performance-evidence/s47-fixture-owner-38173706259/README.md)
passes that setup but fails at the render boundary: 4.25 seconds of its host
deadline were consumed before the browser callback entered. Entry and render
deadlines must be bounded separately, with delayed-timer negative controls.
No completed matched captures or speedup are established.

Follow-up `ac22669e` implements separate entry/render deadlines and rejects late
`postRender` completion even when page timers are blocked. Thirty-seven focused
checks and 1,544 adopted formatting checks pass. The first dispatch omitted its
candidate SHA and failed before browser startup; [the preserved setup failure](performance-evidence/s47-render-entry-38174659324/README.md)
records that limitation. [Exact-commit smoke `38174825435`](performance-evidence/s47-separate-deadlines-38174825435/README.md)
completes three samples, then fails the page render deadline on the fourth:
entry takes 4.86 ms, but the next update opportunity arrives over five seconds
later. This preserves the late-frame failure and requires further attribution.
The workflow's optional candidate now defaults to its dispatched immutable commit.

[Bounded CPU profiling at `94ab2536`](performance-evidence/s47-boundary-cpu-38184189829/README.md)
preserves a failed first-idle measurement boundary and a validated profile
sidecar. Its leading sampled cost is `readPixels`, reached through HUD summary
context and Cesium depth picking; shader-program queries also contribute.
Warmup profiling times out and remains unavailable. Statistical sample weights
are not exact CPU/GPU time, and this hosted software-rendering result does not
explain the separate Windows no-Cesium scheduling stall. Runtime remediation
and a successful controlled comparison remain outstanding.

S59 attribution: the [CPU/GC diagnostic at `d91e0873`](performance-evidence/s59-load-profile-38172396175/README.md)
passes independent recomputation; coordinate conversion takes 14.6 ms of the
20.8 ms instrumented load. Heap profiling exposed imprecise console clock
anchors. [The first failure](performance-evidence/s59-load-profile-38172541874/README.md)
records 24.6 ms uncertainty; [pre-profiler calibration](performance-evidence/s59-load-profile-38172977669/README.md)
still records 2.9 ms and remains failed. Explicit-start User Timing marks now
retain independently checkable trace start times and bounded raw profiles.
`552d1144` accounts for a one-ULP JSON timestamp difference observed at `a8fbb007`,
with 33 focused checks passing. The [exact heap diagnostic](performance-evidence/s59-load-profile-38173470721/README.md)
passes independent tree, sample-ownership, digest, trace-overlap and cleanup
checks. Its instrumented load takes 24 ms, including 17.8 ms coordinate
conversion; 463 allocation samples concentrate in position/Cartesian conversion.
The [CPU mode rerun](performance-evidence/s59-load-profile-38173617763/README.md)
also passes on the same harness. Its instrumented times vary; no performance
comparison is inferred from these diagnostic runs.
These QA branches contain rejected geometry prototypes and are not merged into
dev; none of these profiles is performance acceptance.

S50 source ownership at QA commit `0258bdf2`: mesh-floor cells are scoped to the
actual tileset identity. In-flight switches suspend reads; settled events cover
silent activation and failed recovery. CCTV invalidates only live mesh-derived
ground/probe values, preserves independent DEM/shipped samples, rejects stale
footprint results, and defers obstruction probes until the replacement is ready.
Deactivation/manual range changes cancel pending probes. Focused checks,
formatting and package boundaries pass. [Rendered CCTV and terrain/picking jobs](performance-evidence/s50-surface-owner/README.md)
pass at that exact revision, with five stable CCTV reuse cycles and all 171
terrain workers completed. They are software-rendered lifecycle evidence;
The integration candidate `7ab4f188` passes [all seven standard jobs](performance-evidence/s50-surface-owner/validation-38174089296-ci.json)
in `38174089296`, including three-OS recovery, Node 24/26 suites and builds,
onboarding, and browser journeys. This does not close full S50.

Review follow-up `8b68d54e` corrects map-bridge reconnection ownership: an old
disposer cannot unsubscribe the replacement, old callbacks cannot publish under
its owner, and equal generations across controllers do not suppress the new
state. The regression failed before the repair; 31 focused checks and package
boundaries pass afterward. This runtime change requires its own integrated CI
result before production promotion. Standard CI `38174948494` completed at
docs-inclusive `0c7d678b`: six of seven jobs pass. macOS preserved settings,
workspace contents and the rendered asset but failed Chrome's five-second
shutdown deadline. [The failure and diagnostic setup corrections](performance-evidence/s50-macos-recovery-38174948494/README.md)
remain explicit; dev stays `ba7c8738`. QA follow-up `ee45f9e1` supports matched
Windows/macOS/Linux shutdown controls with validated software-renderer flags;
49 focused checks pass. Both full-driver controls `38176078163` and WebGL-only
controls `38176248222` pass. Whole-application WebGL-only recovery
`38176373283` passes all five stages, retaining settings/workspaces/assets and
closing naturally in 121-290 ms. Counterbalanced same-host backend sequences
[38176631829](performance-evidence/s50-macos-recovery-38174948494/README.md)
pass in both orders at `46ed790b`. WebGL-only reduces median recovery boot
plus renderer-query time by 57.93% (AB) and 49.28% (BA), with no stage regression.
QA now adopts this backend for macOS recovery; Linux keeps its existing backend.
Full standard CI at the adoption commit passes in `38177697638`; the retained
three-OS reports above also pass independent recovery and natural-close checks.
These software checks do not establish physical GPU acceptance.

S59 coordinate-kernel follow-up at `05065532` completes two five-pair
[hosted comparisons](performance-evidence/s59-coordinate-kernel-05065532/README.md).
Both preserve images, picking, settings and cleanup. Combined load improves
35.58% and 40.82%, but the repeat has a 12.14% polygon first-usable regression
against the unchanged 10% limit. The repeat fails; the scalar kernel remains
opt-in and is not promoted. Large-feature four-millisecond batching remains
unfinished. Readiness attribution is required before adoption.

S59 large-geometry comparison (11 October 2026): the hosted browser experiment
at `df63fc43` passes image, picking, cancellation and cleanup checks, but both
256-coordinate chunking arms regress completion time in four of five pairs for
lines and polygons. Measured spans also remain above the 4 ms target. The
experiment is not accepted; production defaults remain unchanged.
[Raw results and independent review](performance-evidence/import-geometry-wake-current-dev/README.md).
Large-feature batching remains unfinished; the next experiment must reduce and
attribute active preparation cost before another scheduling change.
An ordinary-inner-loop follow-up at `844edfc9` also fails that gate (five of five
line pairs and four of five polygon pairs regress by more than 10%). Its thirty
decoded images remain identical; it is recorded in the same evidence packet.
Separate active-cost profiling is the next step, with neither prototype merged.

Point collection integration was promoted after the corrected frozen soak
at `7cea7aac`. All 252 cycles
complete; 40 gauges remain constant at 13 post-GC checkpoints, listeners stay
629, all workers drain, and maximum final-window heap growth is 1.937%. Both
browser owners close naturally within five seconds. [Raw evidence and independent review](performance-evidence/hosted-soak-38167171204/README.md)
pass the intact-envelope supplemental gate. All seven standard jobs at `806d4d3c`
pass, with no intervening runtime change. This closes the point-integration
retention gate; physical Windows and final-candidate acceptance remain pending.
The earlier [missing-cleanup report](performance-evidence/hosted-soak-38162032244/README.md)
remains historical and incomplete. Numbered slices retain their full scope.

S47 stage diagnostic `38165977957` fails at the unchanged child deadline during
the fourth sample's layer/camera setup. The first three worker audits finish;
the new evidence does not establish an audit stall. Dense SwiftShader setup and
render delays need further attribution. [Preserved failure](performance-evidence/s47-stage-diagnostic-38165977957/README.md).

S60 ingestion now accepts complete hosted soak envelopes at `f07ad0cf`, preserving
the outer outcome, cleanup and exact artifact digest. Missing provenance stays
pending; contradictory revisions and failed/forced cleanup fail validation.
Eighty-four focused checks, 1,538 scoped formatting checks and package boundaries
pass locally. All seven standard jobs also pass at `c2572ba8` in
[run 38163192400](performance-evidence/import-point-current-dev/validation-38163192400-ci.json),
including full Node 24/26 suites, builds, three-OS recovery and browser journeys.
These checks do not establish new hardware or retention acceptance.

The 60-minute hosted run at `26f383ed` passes operation and retention checks:
252 cycles, 13 post-GC checkpoints, stable application ownership and 1.568%
maximum final-window heap growth. [Preserved report and limitations](performance-evidence/hosted-soak-38155558706/README.md).
It predates point integration and lacks raw harness/cleanliness fields. It does
not close current-candidate or physical Windows acceptance. The numbered slices
remain partial; earlier entries below retain their historical scope.

The imported-point collection candidate passes five current-dev hosted pairs at
`eb2d6d95ab35bdbbf964eea305226cae763b8a48`. Cooperative imports improve in all
five pairs (median paired change -56.9%); independent decoding confirms 55 exact
image pairs and matching native picks. The asynchronous application import path
selects this renderer. The corrected frozen soak above supplies both shutdown
observations and passes the integration retention gate.
[Raw comparison and limits](performance-evidence/import-point-current-dev/README.md)
record slower synchronous capture waits separately. This is not full S59/S60,
capture-speed, physical Windows or retained-heap acceptance.

Imported Entity cleanup is corrected at
`82e2b0b1da8ac517710cdbdd8468cc3b502330c4`: clearing an import preserves an
external replacement that reuses an imported ID. All seven standard CI jobs and
15 three-OS recovery stages pass at that exact revision.
[Repair and raw evidence](performance-evidence/import-entity-ownership/README.md)
separate this accepted correctness component from the opt-in point-renderer
experiment, which still needs current-dev benefit evidence. Production renderer
and scheduling defaults are unchanged; physical Windows validation and the
remaining S47-S60 requirements stay pending.

The dev push at `26f383edc0a960a58db94e7abcbb24c795fe8a83` also passes all
seven standard jobs in [run 38154279746](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38154279746).
Its five Windows recovery stages preserve settings/workspaces and exit normally
within 325.0-612.3 ms. [Exact follow-up evidence](performance-evidence/main-weather-38152867100/dev-26f383ed-review.json)
does not establish the cause of earlier intermittent shutdown failures.

Latest integration: `7ef32a74afc7574d5fcad0dc19d2b4b33c49e815` passes all seven
standard CI jobs after incorporating main `591f299` and correcting disclosure
ownership in the accessibility journey. All 15 three-OS recovery checkpoints
preserve settings/workspaces and exit normally; 61 computed accessible control
names pass across the inspector, workspace library and timeline. Local token
checks pass against both frozen branch bases. [Exact evidence and limits](performance-evidence/main-weather-38152867100/README.md)
retain the earlier failed run separately. This accepts the integration for dev;
the intermittent Windows shutdown cause, physical frame-delivery failure and
remaining S47-S60 requirements are still unresolved.

Cable multipart source mapping is corrected at `64a607e` with 39 focused
checks and all seven ordinary integration jobs passing. All 1,913 bundled cable segments resolve to their actual 712
source features, retaining native Entity IDs and one reference per source.
[Evidence and scope](performance-evidence/cable-source-identity/README.md)
separate this correctness repair from infrastructure batching and hardware
acceptance. The exact-commit CI record includes Windows/Linux/macOS recovery.

The isolated Cesium no-op terrain-collision transform fix is accepted at
f26f4dd738a518c6cefa96b5f809c5d9c53afa83 after all seven ordinary integration jobs
and 111 tracking checks pass. It removes redundant tracked-camera transform
writes while preserving actual terrain correction. [Exact scope and raw evidence](performance-evidence/cesium-collision-transform/README.md)
are recorded separately from fleet scheduling, full-scene performance and physical
Windows acceptance, which remain unfinished. No entire performance slice is
completed by this component correction.

S51 traffic render demand is accepted as a component at
`bda6146d2c7f978e682421bd29a7c7f087b5a491` against current development baseline
`4dfea32b4e63c0d28d22cd031e61e290e81f6f2a`. Five hosted pairs preserve exact
controlled pixels while enabled-empty frames fall from 233-297 to zero per
ten seconds. All seven integration jobs and 111 tracking checks pass at that
exact revision. [Current-dev evidence](performance-evidence/s51-traffic-current-dev/README.md)
includes independent verification of all 60 images. Physical Windows, full-scene
performance and full S51/S60 acceptance remain pending.

Placement reuse at `4686ea3b6d33cf02e822f04e122bfb0afdcc9cf5` is accepted as a
component optimization after exact-source CPU, pixel, allocation, native font
and all seven integration gates pass ([acceptance record](performance-evidence/s52-placement-direct-filter/acceptance.json),
[CI results](performance-evidence/s52-placement-direct-filter/ci-run.json)).
Static/periodic workloads improve in all twenty pairs; moving generic and
infrastructure medians regress 3.34%/2.36%, with no individual pair exceeding
the 10% limit. This tradeoff and the limits of Node/component measurements are
explicit below. Conditional painting, full-scene performance and hardware
acceptance remain unfinished; this does not complete S52 or S47-S60.

Further conditional-paint review reproduced two callback-lifecycle failures in
an unpublished prototype. A per-frame callback guard fixes both in the revised
prototype; production already passes the same controls. Both new production
regressions and the focused suite pass (90/90). The expanded 44-case browser
fixture passes five same-commit pairs at `61606d0`; independent decoding verifies
all 880 PNGs, source hashes, recorded conditions, hits and accessible actions
([baseline control](performance-evidence/s52-paint-baseline-44/README.md)).
[Raw failure controls and
source snapshots](performance-evidence/s52-paint-callback-regressions/README.md)
preserve the rejected result separately from the corrected experimental result.
No conditional-paint runtime is accepted by these unit checks alone.

The conditional-paint cache experiment is now **rejected**, with the existing
production paint path retained. Its final revision passes 72 focused checks and
twelve allocation gates, but the mixed infrastructure/FIRMS/vessel/tracked
workload exceeds the unchanged allocation limit: 160.1 versus 154 bytes per
candidate/frame. A narrow rocket comparison crosses its own limit by only seven
bytes/frame and does not override the full-suite failure. No further permutations
of this design are planned. [Rejection and raw evidence](performance-evidence/s52-paint-rejection-07/README.md)
record the exact frozen sources and failed gate. Earlier prototype diagnostics
and the first current-base rocket failure remain [historical evidence](performance-evidence/s52-paint-didpaint-target/README.md).
The accepted projection, layout and placement improvements remain in production;
S52 full-scene performance and hardware validation are still pending.

All seven ordinary integration jobs also pass at
`38f8d70ce087939fa6d4b57a5c8257c5d6b84293`, whose production renderer does not
include the rejected paint cache
([run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38106226841),
[archived results](performance-evidence/s52-paint-rejection-07/production-dev-38f8d70-ci.json)).
The [earlier successful f301cba results](performance-evidence/s52-placement-direct-filter/dev-f301cba-ci.json)
remain preserved.
PR-only layer-token and optional diagnostic/soak checks remain skipped.

The S53 point-collection image failure is now attributed to the changed command
bounds and fitted frustum planes. The unchanged split still fails by 24 pixels;
a capture-only bounds control restores exact mixed-collection pixels, and
restoring natural split bounds restores the original failure. Both captures use
active OIT. This is causal diagnostic evidence, not an accepted private-engine
override or runtime split. [Exact revisions, four decoded images and raw runs](performance-evidence/s53-bounds-attribution/README.md)
are preserved. The current split is rejected; production keeps its existing
collection layout, and the remaining S53 work stays partial.

The subsequent `dev` run at `e89715c3d46414107cc7996cce98d34aa1a09e8f`
also passes all seven ordinary integration jobs, including Windows recovery and
the final browser journey ([run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38103646706),
[archived results](performance-evidence/s52-placement-direct-filter/dev-e89715c-ci.json)).
PR-only layer-token and optional diagnostic/soak checks remain skipped in that run.

The previous `dev` baseline `72694089e7fa0fa414042cde48765e1418a70d7e` passes all seven
ordinary integration jobs, including the final browser gate
([run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38096363702),
[archived results](performance-evidence/s52-placement-reuse/baseline-dev-ci.json)).
The PR-only published layer-token check and optional diagnostic jobs did not run;
their absence is not a pass. This revision is the integration baseline for the
placement comparison below.

Updated on 11 October 2026. All seven full integration jobs pass at
`f25154a61326e881e2223f2238d94b06cf231df8`
([CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38095198493),
[job results](performance-evidence/s52-layout-reuse/ci-run.json)). The projection
and normalized-entry layout optimizations now have repeatable isolated CPU benefit,
five paired 24-case exact-pixel comparisons for each change, and applicable unit,
allocation and integration checks. The idle font wake fix also passes native
browser failure-control comparisons, including with layout reuse enabled.
These component optimizations are retained. Conditional painting,
full-scene latency and physical Windows acceptance remain unfinished. Details,
raw evidence and earlier failures are preserved below; this is not full S52
acceptance. Earlier `33d9856` and remote `dev` revision `d2c5aa1` also pass all seven
integration jobs ([projection results](performance-evidence/s52-33d9856/ci-33d9856.json),
[previous dev results](performance-evidence/s52-33d9856/ci-d2c5aa1.json)).

Earlier, all seven full integration jobs pass at
`167ba62c047fe94f36d0d60066aa4d648ede7519` after the workspace save ownership fix
([CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38090393482),
[job results](performance-evidence/ci-167ba62.json)). This covers Node 24/26,
production builds, formatting, boundaries, Windows onboarding, three-OS recovery
and the existing browser gates, including the previously failing mixed-use smoke.
The earlier `f598310` conflict remains recorded as a failure
([historical results](performance-evidence/ci-f598310.json)). All seven full integration jobs also pass at
`996a8d3b8b73da0d3f64392b993bdff81a1e857f` ([CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38083652826), [job results](performance-evidence/ci-996a8d3.json)),
including Windows recovery. The earlier Windows shutdown failures at `084a771`
and `0940b57` remain historical evidence; this successful run does not establish
their cause or a permanent fix. Subsequent code requires its own applicable checks.
The separate tracking run at that revision fails one of 109 checks. Its GitHub
job was incorrectly green because a logging pipeline masked the test exit code;
the raw failure and the pipeline correction are recorded below. The corrected
fixture at `8c3e99a` passes 111 hosted tracking checks; this later result does not
change the failed historical result at `996a8d3`.
Windows UHD 620 isolated capture checks recovered at `0edfb8e` after the manual
foreground check; [raw evidence and limitations](performance-evidence/WINDOWS_FRAME_RECOVERY.md)
are recorded separately from the unresolved earlier stall cause and soak gates.
The subsequent Windows wind check at `a83dd7a` fails its fresh-frame deadline;
the standalone WebGL control also exhibits long frame gaps. The earlier recovery
does not establish a permanent fix; see the new evidence below.
The latest isolated hosted wind/capture checks pass at
`d905f301bd6856a21c9f648200a380f792d29968`; the latest 60-minute hosted Metal
retention pass belongs to `996a8d3b8b73da0d3f64392b993bdff81a1e857f`, not the current tip.
The comparison baseline remains
`eb8c6828d0d03e1c04bda94c8c4fb99915a577b7` (Cesium 1.138.0).

This ledger separates code delivery, automatic checks, and hardware acceptance.
`Partial` means a foundation exists but the full slice contract is not delivered.
`Pending` means the planned change or acceptance evidence remains outstanding;
existing behavior alone does not complete a new slice. No S47-S60 slice has full
acceptance evidence yet. Reconcile engineering closure against
[the amended checklist](CESIUM_ACCEPTANCE.md) separately from final qualification. The [S32-S46 ledger](IMPLEMENTATION_PLAN_NEXT.md) retains
the earlier release requirements and historical results.

| Slice                                    | Code implemented                                                                                                                                                                                                                                                                                                                                             | Automatically validated                                                                                                                                                                                                                                                                                                                                                                                                                                    | Hardware validated                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S47 baseline and comparable capture      | Partial: density synchronization, observed dense-production comparison export, weather/wind fixture capture, staged fixture clock, actual tracking endpoints, build identity and before/after condition guards                                                                                                                                               | Unit integrity gates and six-step share/slider/profile/workspace density journey pass at `d70dac9`; matched-run evidence remains pending                                                                                                                                                                                                                                                                                                                   | Pending matched captures and negative control                                                                                                                                                              |
| S48 attribution and resource diagnostics | Partial: bounded opt-in CPU/resource diagnostics, depth-pick and owned shader-program observations, lifecycle-safe profiler/interception ownership, immutable renderer reads and hash-bound failure checkpoints                                                                                                                                              | All seven standard CI jobs pass at `e54eaded`. Failed hosted capture preserves six complete contexts: 143 programs, 429 first parameter queries, no repeated queries; first LINK_STATUS waits dominate. Independent raw replay verifies identities, scope and incomplete cleanup. Dense captures remain failed                                                                                                                                             | Software-renderer attribution only; complete workload traces, allocation profiles, overhead comparisons and primary Windows evidence remain pending                                                        |
| S49 worker/lifecycle retention           | Partial: stale GeoJSON/cable, traffic and CCTV lifecycle cleanup, corrected worker interception, isolated import/workspace, CCTV and terrain/picking lifecycle runners                                                                                                                                                                                       | Import/workspace/cancellation passes at `7b92db4`; five rendered CCTV toggles and disabled-module reinitialization pass at `db298d4`; five terrain cycles and three native selection/re-enable cycles pass at `d7f25ed`                                                                                                                                                                                                                                    | Hosted paravirtual Metal retention run passes at `996a8d3`; current Windows UHD 620 plateau pending                                                                                                        |
| S50 geometry coalescing                  | Engineering closed: cursor/coalesced latest builds, exact pose/source/terrain ownership, bounded fourteen-volume retention, metadata-only reuse and supported tint updates; see the 13 October closure audit.                                                                                                                                                | 183 focused checks pass at 81a5cc79; native retained/rebuilt pixel and construction comparison passes at fa0e8a49, with zero visibility-cycle builds and complete teardown. Real-layer workspace restore preserves primitive identity.                                                                                                                                                                                                                     | Hosted native component evidence passed; full-application primary Windows appearance, interaction and retention qualification pending.                                                                     |
| S51 render demand scheduling | Engineering closed: corrected dense/core/focus cadence, scheduled demand, owner/callback inventory and enabled-empty fleet release; see the 14 October closure audit. | 74 focused checks and three negative controls reused with exact source hashes; both-base c5802408 integration passes. Hosted static probe passes with one frame, repeat zero. | Primary Windows static/periodic/tracking/visibility qualification pending. |
| S52 overlay invalidation                 | Engineering closed under the [13 October audit](performance-evidence/closure-audit-20261013/README.md): retain pure-projection reuse at `33d9856`, idle font wake fix at `0d431f2`, normalized-entry layout reuse at `f25154a`, and direct-filter placement reuse at `4686ea3`; conditional paint cache evaluated and rejected, production painting retained | Current component checks: 90/90 pass; source bytes and 13 original artifact hashes verified. Placement previously passes 87 focused checks, 13 allocation gates, five 24-case exact-pixel pairs, two native font failure-control pairs and all seven integration jobs. All 20 static/periodic CPU pairs improve; moving generic/infrastructure medians +3.34%/+2.36%, no pair over +10%. Rejected paint failure preserved; merged full integration pending | Pending; component Canvas2D and software WebGL results do not establish GPU or full-scene performance                                                                                                      |
| S53 collection uploads | Engineering closed: retained satellite scratch/write reuse; real snapshot/fleet mutation audits; natural-bounds split rejected and mixed blending retained. | Clean 51033433 fleet audit and 15 focused tests pass; prior coordinate/mutation and 24-pixel split attribution evidence reverified. | Physical selected/horizon/focus/fade qualification pending; no production GPU-upload benefit claimed. |
| S54 infrastructure batching              | Partial: identity separation implemented; dam/cable prototypes rejected for promotion, datacenter candidate isolated; Entity defaults retained                                                                                                                                                                                                               | Datacenters at `d05e5415` improve activation and retained JS heap with 20 exact image pairs. Dams regress source-ready time 15.02%; cable camera-change mismatches recur and lifecycle runs fail. Failed experiments are preserved, without unchanged retries or relaxed gates                                                                                                                                                                             | Hosted Apple paravirtual Metal only. Datacenter physical Windows and mixed-layer acceptance remain pending; no full S54 or final-soak acceptance                                                           |
| S55 tracking updates                     | Engineering closed: shared tracked time/pose, independent fresh fleet queries and camera authority audited; 83 current checks and a failing duplicate-write control pass                                                                                                                                                                                                              | Civil: 49 focused checks and 109 hosted tracking checks at `47dbee4`; military: 34 focused checks at `afe83bc`; each five-repeat exact-source comparison preserves outputs and eliminates one time sample per frame                                                                                                                                                                                                                                        | Pending tracking p95 and full camera-ownership comparison                                                                                                                                                  |
| S56 fresh-frame capture                  | Engineering closed: shared fresh-frame ownership, real viewport/pointer caller cleanup, all three temporary surfaces released; explicitly retain preserveDrawingBuffer=true.                                                                                                                                                                                 | 199 frame/pointer/voice checks pass at d73f3c89, after fourteen before-fix sampler-surface failures. The real viewer destroy-pending component passes in native run 38439815077. Full app capture matrix remains separate.                                                                                                                                                                                                                                 | Historical isolated Windows viewer matrix passes at 47dbee4; current full application idle/moving/portrait/resized/restored/hidden qualification and any benefit claim remain pending.                     |
| S57 map-resource lifetime                | Engineering closed: superseded imagery/terrain/tileset ownership, comparison leases, explicit retry after fallback, native fixture coverage and rendered fault controls; detail/cache defaults retained.                                                                                                                                                     | 50 map tests pass; current native production journeys and all three fault/recovery controls pass at e0710bd5. Historical streamed-tile component at e1a6f5e4 retains its original cancellation/cache/cleanup evidence. See the 13 October closure audit.                                                                                                                                                                                                   | Hosted native integration passed; physical Windows equivalent-detail, route-time and retention qualification pending.                                                                                      |
| S58 weather/effects                      | Partial: retain the current wind scalar image across equal decoded forecasts; broader weather/effect work remains                                                                                                                                                                                                                                            | 223 wind/weather tests pass; three five-pair CPU comparisons preserve raster bytes, reducing repeated image builds to zero                                                                                                                                                                                                                                                                                                                                 | Hosted Metal speed/temperature/pressure pixels match at `d905f30`, with 1,200 paths and 152,736 vertices preserved; full effect matrix and Windows checks remain                                           |
| S59 cooperative ingestion                | Partial: shared incremental GeoJSON coordinate validation and preview summaries, owned deferred normalization, bounded render cohort, workspace/import ownership guards and header-only CSV setup; full document decoding and wider UI maintenance remain                                                                                                    | All seven integration jobs pass at `9a665b2`; CSV header setup also passes 24 focused checks and an exact-source 5-pair CPU comparison. Earlier rendered comparisons belong to `ee38af4`                                                                                                                                                                                                                                                                   | Hosted Metal ten-capture comparison passes at `ee38af4`; two normal Windows UHD 620 ten-capture runs pass at `0edfb8e` after foreground check; earlier stall cause and full interaction acceptance pending |
| S60 final candidate                      | Partial: S60.1 hash-bound raw comparison/retention ingestion; remaining slices and final candidate pending                                                                                                                                                                                                                                                   | Version-2 manifest recomputation and negative evidence checks implemented; exact-commit integration results recorded below                                                                                                                                                                                                                                                                                                                                 | Primary Windows comparisons and full retention remain pending; hosted/software results are supplemental                                                                                                    |

The visual default remains Manual. Resolution, MSAA, label density, source
populations, tracking behavior, effects, and visual fidelity are not reduced as
a performance shortcut. Auto quality remains opt-in.

### S52 direct filtering and paint fixture controls - 11 October 2026

QA candidate `4686ea3b6d33cf02e822f04e122bfb0afdcc9cf5` removes the separate
copy from complete placement variants into the filtered list. UI filtering now
reads the complete variants directly; protected-card filtering still owns its
separate mutable list. All 87 focused checks and 13 unchanged allocation budgets
pass, and the existing work witness retains output parity with 28 -> 14 variant
builds ([raw work report](performance-evidence/s52-placement-direct-filter/work-report.json),
[review and test hashes](performance-evidence/s52-placement-direct-filter/review.json)).
The 18-run local CPU diagnostic is noisy, including both improvements and
regressions, and is explicitly not acceptance evidence.

The [fresh visual comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38101751467)
passes all five 24-case pairs. Independent decoding verifies 240 PNG pixel
hashes, exact repeated states, hits, accessible actions, inputs and source
identities ([review](performance-evidence/s52-placement-direct-filter/visual/review.json),
[raw report](performance-evidence/s52-placement-direct-filter/visual/report.json),
[all image files](performance-evidence/s52-placement-direct-filter/visual/images.zip)).
The [40-pair CPU comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38101751521)
is complete. Independent recomputation verifies exact source, fixture, lockfile
and harness identities, all before/after input conditions and all forty paired
ratios ([raw report](performance-evidence/s52-placement-direct-filter/cpu-report.json),
[review](performance-evidence/s52-placement-direct-filter/cpu-review.json)).
Static infrastructure/radio paired medians improve 30.65%/22.93%; periodic
infrastructure/radio improve 31.11%/17.65%, with improvement in every one of
those twenty pairs. Moving generic and infrastructure medians regress
3.34%/2.36% (all ten pairs regress; largest individual regression 6.14%). Moving
radio's median improves 1.90%; detection's median regresses 0.20%, with mixed
individual results. No pair exceeds the 10% regression limit. These are
synchronous Node algorithm timings with mock Canvas2D, not browser painting,
GPU timings or full-scene motion p95. The component meets the measured-benefit
and regression threshold with this explicit moving-path tradeoff.
[Exact-commit CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38102509524)
passes all seven ordinary jobs at `4686ea3`, including Windows recovery and
browser journeys ([archived results](performance-evidence/s52-placement-direct-filter/ci-run.json)).
The [native font wake control](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38102807734)
passes both alternating pairs: the pre-fix control misses the wake twice,
while the candidate wakes only the current host and changes its width from
283 to 299 px ([independent review](performance-evidence/s52-placement-direct-filter/native-font-review.json)).
The [acceptance record](performance-evidence/s52-placement-direct-filter/acceptance.json)
binds all artifacts and records the component's promotion decision. PR-only
published layer-token checks and optional diagnostic/soak jobs were skipped;
their absence is not a pass. Subsequent evidence-only commits do not change
the tested application or harness bytes.

Additional scalar-paint diagnostics reject a typed-buffer prototype that both
increases allocation and publishes invisible hit targets on a stable frame.
An independent failure control reproduces the stale opacity-field read, while
the named-field reference passes. A new regression covers consecutive hidden
frames, visible recovery and returning to low opacity; all 88 focused checks
pass on the unchanged production runtime. [Raw evidence and reproduction](performance-evidence/s52-paint-scalar-diagnostics/README.md)
preserve the rejected source and distinguish diagnostic omission controls from
eligible implementation changes. Conditional painting remains unfinished.

The expanded paint fixture adds actual font loading, selection promotion and
demotion, and shared/separate custom painter transitions. Its first baseline run
[failed](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38101521814)
because the test retained a pooled rectangle beyond its documented single-frame
lifetime. The recorded immutable observations already show 283 -> 299 px widths;
this was a fixture assertion bug. Harness `d5ed890` copies rectangles before
another frame. The [corrected baseline control](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38101675504)
passes five 38-case pairs with identical application commit `698752a` on both
sides. Root independently decoded and verified all 760 images and all recorded
states ([review](performance-evidence/s52-paint-baseline/review.json),
[raw report](performance-evidence/s52-paint-baseline/report.json),
[all image files](performance-evidence/s52-paint-baseline/images.zip),
[original failed report](performance-evidence/s52-paint-baseline/failed-pooled-rect-report.json)).
These results validate the fixture; they do not accept the staged repaint
optimization, demonstrate GPU performance, or complete S52. The repaint
prototype remains isolated while its allocation failures are corrected.

Three rejected paint prototypes are now preserved with their exact source
bytes, all twelve original test logs, the semantic hold-test transform and
an [independent source-graph and failure review](performance-evidence/s52-paint-allocation-rejections/review.json).
The original `613795ba` variant and typed-placement `3d02c3bc` variant each fail
eight of thirteen allocation checks. Direct named-field capture `291e1a4e`
reduces that to six failures: infrastructure, infrastructure plus FIRMS, two
vessel regimes, rocket and cable cohorts. Its focused checks pass 87/87, but
that does not override allocation failure. Both the frame ceiling and the
154 B/candidate ceiling remain enforced unchanged. The original focused test
failure is retained; its assumption that stable pixels must be redrawn is
replaced identically on both sides for the later two trials by checks for
fresh promotion/demotion paint, retained pixels without clearing, current hit
identity and accessible output. Real pixels have a separate browser fixture.
No paint prototype is accepted or added to the runtime by this evidence commit.

### S52 placement reuse: moving-workload regression found - 11 October 2026

The QA candidate retains complete placement variants on each existing projection
record. It reuses them only when entry, layout, source/UI/font revisions and every
pure geometry input match. Current UI exclusions, protected-card collision
filtering, arbitration, presentation callbacks, painting, picking and accessible
actions still run. The full variant list is separate from the filtered list,
so a temporarily rejected choice can return on a later frame.

The [exact-source work report](performance-evidence/s52-placement-reuse/work-report.json)
and [independent review](performance-evidence/s52-placement-reuse/review.json)
bind the proposed source to SHA-256
`c43194668c660a84e3aba94e94208d0ce1fd5378ce004aef1e7d86cced71872b`.
Baseline `f25154a` and integration baseline `7269408` have identical overlay
source bytes. The baseline fails exactly the unchanged-work assertion; the
candidate passes all four comparison checks. Both pass the behavior controls.
The sampled rectangles, hit identities and painted text agree; variant builds
fall from 28 to 14. Each changed input rebuilds once, followed by reuse.

Two permanent regressions cover radius-derived geometry, UI occlusion and
offscreen recovery, plus restoration after a moving protected card filters out
an unchanged ambient label's placement. All 85 focused checks and 13 existing
allocation checks pass. The archived allocation log preserves its original
UTF-16LE bytes; the review records its encoding and hash. Formatting and package
boundaries pass. The reproducible runner rejects existing evidence output and
checks consumed source bytes before and after the comparison.

The committed candidate is `21523d5c5ff7f17329e139f23582a883a91a7c92` on
`qa/s52-placement-reuse`. Its [browser comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38097676379)
passes five alternating pairs across the unchanged 24-case matrix. All 240 PNG
files were decoded and their pixels independently hashed; all 120 baseline and
candidate comparisons, repeated cases, hit targets, accessible actions and input
conditions agree. Source and harness hashes match their Git objects. The
[raw report](performance-evidence/s52-placement-reuse/visual/report.json),
[review](performance-evidence/s52-placement-reuse/visual/review.json) and images
are archived. This is real Canvas2D with a mock Cesium host, not full-scene WebGL.

The [native font comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38097677965)
also passes two pairs. The pre-fix baseline reproduces both missing-wake failures;
the candidate changes its hit width from 283 to 299 px after actual font loading.
All four idle controls have zero frames and requests; retired hosts remain idle,
and cleanup completes normally. The [raw report](performance-evidence/s52-placement-reuse/native-font-report.json)
and [independent review](performance-evidence/s52-placement-reuse/native-font-review.json)
retain the SwiftShader renderer and exact revisions.

The [eight-workload CPU comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38097674690)
finished, but **this candidate is not accepted for promotion to `dev`**. The
[raw report](performance-evidence/s52-placement-reuse/cpu-report.json) and
[independent review](performance-evidence/s52-placement-reuse/cpu-review.json)
verify all 40 alternating pairs, exact source/fixture/lockfile/harness hashes,
matched trajectories and populations, and instrumentation-disabled timing.
On the hosted AMD EPYC 9V45 with Node 24.14.0, every one of the 15 moving ordinary
pairs regresses. Two individual regressions exceed 10%. Fixed and periodic inputs
improve in every pair, so the unchanged-work benefit is real but does not excuse
the moving-path cost.

| Workload                    | Update cadence  | Median paired CPU change | Individual pair range |
| --------------------------- | --------------- | -----------------------: | --------------------: |
| Generic, 250 entries        | Every frame     |                   +7.53% |     +4.66% to +10.78% |
| Infrastructure, 320 entries | Every frame     |                   +8.14% |     +4.92% to +10.90% |
| Radio, 864 entries          | Every frame     |                   +3.22% |      +1.46% to +5.37% |
| Detection, 5,000 entries    | Every frame     |                   +2.32% |      -3.87% to +6.53% |
| Infrastructure, 320 entries | Fixed           |                  -22.36% |    -25.26% to -22.01% |
| Radio, 864 entries          | Fixed           |                  -19.12% |    -21.27% to -18.17% |
| Infrastructure, 320 entries | Every 60 frames |                  -22.11% |    -25.63% to -21.52% |
| Radio, 864 entries          | Every 60 frames |                  -15.30% |    -16.42% to -13.43% |

Separate instrumented samples localize the moving overhead to candidate
preparation: its projection phase grows approximately 8-13%, while solve and
paint remain broadly unchanged. The cache miss path's repeated snapshot writes
and variant-list copying are being investigated; attribution does not yet prove
which operation is responsible. A corrected candidate must repeat the same
comparison and correctness gates before promotion. This report measures the Node
algorithm with mock Canvas2D, not browser painting, GPU time or motion p95.

The [candidate integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38097900422)
passes all seven ordinary jobs at `21523d5`: Node 24/26, Windows onboarding,
three-OS recovery and the browser gate
([job and step results](performance-evidence/s52-placement-reuse/ci-run.json)).
The PR-only published layer-token check and optional diagnostics did not run.
Passing these integration checks does not override the moving CPU regressions.
Conditional painting is staged only and will follow the placement decision.
Full-scene latency and physical Windows acceptance remain separate requirements.

### S52 revised placement signature: allocation gate failure - 11 October 2026

The next staged variant reads its pooled `placementInput` as the previous scalar
signature before writing new inputs. It checks changed anchors first and removes
eleven duplicate scalar cache fields; the complete variant list and collision
filtering remain separate. Its source SHA-256 is
`a42a7235062b379223aa29f8a21922f167514476d1500ef48ce998b5a3bbb616`.
The [source artifact](performance-evidence/s52-placement-revised-a42/runtime-candidate.js),
[work report](performance-evidence/s52-placement-revised-a42/work-report.json) and
[review](performance-evidence/s52-placement-revised-a42/review.json) preserve the
experiment without promoting its runtime to `dev`.

All 86 focused checks pass, including a new original-pose/configuration -> moved
pose/new configuration -> same moved pose/original configuration -> original
pose transition. The work witness still performs 14 variant builds versus 28,
with identical sampled rectangles, hit identities and text. Formatting and
package boundaries pass.

However, only 12 of 13 allocation checks pass. The 250-entry above-cap workload
uses **13,682 bytes/frame** against the unchanged **13,000 bytes/frame** budget.
A separate focused repeat reproduces the same median and 13,880-byte maximum.
Both [full-suite log](performance-evidence/s52-placement-revised-a42/allocation.txt)
and [repeat log](performance-evidence/s52-placement-revised-a42/allocation-control.txt)
retain their original UTF-16LE bytes and recorded hashes. This variant is also
rejected for promotion. Its allocation increase must be explained and corrected
before a fresh timing comparison; no performance benefit is claimed for it.

### S52 corrected placement signature: moving regression remains - 11 October 2026

The correction is frozen at `698752adcd27b59040affc0d0a1a9bd643025833`
on `qa/s52-placement-revised`. Its fresh
[visual run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38099700920)
passes five 24-case pairs. Independent review decoded all 240 PNGs, checked
their raw pixel hashes and alpha counts, and compared all recorded input,
hit-test and accessibility states within and across pairs. The
[raw visual evidence and review](performance-evidence/s52-placement-revised-fixed/visual/review.json)
are scoped to browser Canvas2D with the deterministic mock viewer.

The [native font run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38099702643)
also passes both alternating pairs against the pre-fix `33d9856` control.
The old missing-wake failures reproduce twice; the corrected candidate wakes,
changes the label width from 283 to 299 pixels, and does not wake the retired
host. All four 800-ms idle samples have zero frames and render requests.
[Raw font evidence and review](performance-evidence/s52-placement-revised-fixed/native-font-review.json)
retain software-WebGL scope. These are correctness checks, not hardware or
performance acceptance. All seven standard jobs in the
[full integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38099704275)
pass at this exact candidate: Node 24/26, production builds, formatting,
boundaries, Windows onboarding, recovery on Linux/macOS/Windows, and every
ordinary browser journey, including the mixed-use smoke and portable panel.
[Job evidence](performance-evidence/s52-placement-revised-fixed/ci-run.json)
and [review](performance-evidence/s52-placement-revised-fixed/ci-review.json)
record the skipped PR-only published layer-token checks and optional diagnostics
separately. The frozen candidate's
[CPU comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38099699273)
is complete and **the candidate is rejected for promotion to `dev`**. Remote
`dev` stays at `7269408`. The
[raw report](performance-evidence/s52-placement-revised-fixed/cpu-report.json)
and [independent review](performance-evidence/s52-placement-revised-fixed/cpu-review.json)
verify all 40 alternating pairs, exact revisions and source hashes, matching
conditions and populations, and instrumentation-disabled latency samples.
On AMD EPYC 7763 with Node 24.14.0, all 15 ordinary moving pairs regress;
one generic pair exceeds 10%. Static and periodic cases improve in every pair.

| Workload                    | Update cadence  | Median paired CPU change | Individual pair range |
| --------------------------- | --------------- | -----------------------: | --------------------: |
| Generic, 250 entries        | Every frame     |                   +7.52% |     +3.04% to +11.06% |
| Infrastructure, 320 entries | Every frame     |                   +5.58% |      +3.01% to +7.73% |
| Radio, 864 entries          | Every frame     |                   +0.77% |      +0.07% to +2.81% |
| Detection, 5,000 entries    | Every frame     |                   -0.36% |      -1.71% to +2.67% |
| Infrastructure, 320 entries | Fixed           |                  -26.41% |    -26.93% to -25.05% |
| Radio, 864 entries          | Fixed           |                  -20.24% |    -22.88% to -16.95% |
| Infrastructure, 320 entries | Every 60 frames |                  -25.35% |    -26.02% to -23.49% |
| Radio, 864 entries          | Every 60 frames |                  -15.53% |    -15.84% to -15.05% |

Removing duplicate signature fields resolved the allocation failure but did not
resolve moving CPU overhead. Separate instrumented samples still place that
overhead in preparation/projection, which grows 6.61-8.11% for the three moving
ordinary workloads. Further controls must isolate the remaining cause before
another candidate is retained. These Node/mock-canvas results do not establish
browser painting, GPU performance, motion p95, or S52 acceptance; green visual
and integration checks do not override the timing result.

The allocation increase is isolated to the moving anchor comparison path.
Checking unequal anchors before `Object.is` removes the measured increase while
retaining `Object.is` as the final equality decision, including signed zero and
`NaN`. In the same isolated 250-entry workload, the failing signature measured
13,682 bytes/frame and the correction measured 9,681.67 bytes/frame. Removing
anchor or size locals alone did not change the failure. This is empirical
allocation attribution; a specific V8 boxing mechanism has not been established.
The [hash-bound controls and independent review](performance-evidence/s52-placement-revised-fixed/review.json)
preserve source, worker and dependency identities, before/after checks and raw
measurement chunks.

The applied, formatted runtime SHA-256 is
`936bd09078074958554d33e479e46046cf58822f05195082d7fae73e6889ddd6`.
All [86 focused tests](performance-evidence/s52-placement-revised-fixed/focused.txt),
the [13 allocation gates](performance-evidence/s52-placement-revised-fixed/allocation.txt)
and a separate permanent above-cap allocation control pass without changing any
budget. The [work witness](performance-evidence/s52-placement-revised-fixed/work-report.json)
still matches sampled output and reduces variant builds from 28 to 14. The new
configuration-transition regression is included in the permanent test suite.

This correction is on the QA branch only. It has no accepted timing or rendered
comparison yet. Repeat the unchanged eight-workload CPU matrix, 24-case Canvas2D
matrix, native font failure control and integration gates at its frozen commit
before promotion to `dev`. Both preceding failures remain historical evidence.

### S52 layout reuse: accepted component optimization - 11 October 2026

A new experiment stores the font revision with each normalized entry's existing
layout. Source replacement creates a fresh layout; a font change invalidates it.
Position, presentation, placement, hit testing and painting retain their existing
per-frame behavior. Font revision is read lazily only when an ordinary candidate
needs projection, so empty and detection-only frames gain no global counter write.
This differs from the rejected earlier cache; that earlier detection regression
remains recorded and must still be covered by the comparison workload.

The [work witness](performance-evidence/s52-layout-reuse/report.json) fails against
font-fix baseline `0d431f2`: ten unchanged text frames perform 20 redundant width
writes. The candidate performs none, remeasures on a font event, and retains live
position/scale and updated hit bounds. The companion behavior control covers all
six card variants, source replacement and visibility restoration. All 83 focused
overlay/Draw/font tests and all 13 existing Node 24 allocation gates pass.
The isolated CPU and rendered comparisons now pass as recorded below. The change
is retained within that measured scope; broader S52 acceptance remains pending.

The first [rendered comparison attempt](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38095195178)
at candidate `f25154a` stopped during preflight: both newer application commits
already contain the fixture, whereas the original runner required absent paths.
No browser observations were collected. The
[raw log](performance-evidence/s52-layout-reuse/visual-preflight-failure.txt) and
[run state](performance-evidence/s52-layout-reuse/visual-preflight-run.json) retain
that failure. The runner now reuses existing files only when their bytes match
the harness exactly, leaves those files untouched, and removes only temporary
files it created. The retry keeps baseline `0d431f2` and candidate `f25154a` fixed.

The [retry](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38095302602)
at harness `eadc099` passes five alternating pairs across all 24 cases. All 120
comparisons and within-side repeats match exact pixels, hit rectangles, feature
identities and accessible actions. All 240 PNG hashes were independently verified.
The [raw report](performance-evidence/s52-layout-reuse/visual/report.json),
[review](performance-evidence/s52-layout-reuse/visual/review.json),
[run metadata](performance-evidence/s52-layout-reuse/visual/run.json) and images
are retained. This is real browser Canvas2D with a mock Cesium host, not full-scene
WebGL or hardware performance. All owned resources and temporary fixtures clean up.

The [Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38095198493/job/114339570915)
also passes all five scenarios at `f25154a`: settings, workspace contents and
persisted assets survive interruption, upgrade and verification-failure rollback.
All five browsers close normally in 235-402 ms, within the existing 5,000 ms
deadline, without process termination. The
[raw recovery report](performance-evidence/s52-layout-reuse/windows-recovery.json)
has SHA-256 `7dd6be29d603cd5a23406d13dad551f65bd84c2c1a1502bef13d4ef5cef372a6`.
This hosted Windows run uses SwiftShader and is not physical GPU evidence.

The [combined layout/font check](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38096074317)
also passes two native FontFaceSet pairs at `fee5ed6` (production files identical
to `f25154a`). Baseline `33d9856` still fails both missing-wake controls; the
candidate reflows from 283 to 299 px after the actual font change, while retired
hosts stay idle. The [raw report](performance-evidence/s52-layout-reuse/native-font-report.json)
and [independent review](performance-evidence/s52-layout-reuse/native-font-review.json)
verify source hashes, four zero-frame idle controls and complete cleanup.
The harness now reuses byte-identical committed fixtures, validates them again
after the run, and removes only its temporary copies. Both ownership paths pass.
The preceding [cancelled dispatch](performance-evidence/s52-layout-reuse/native-font-cancelled-run.json)
used an incorrectly shortened candidate SHA; it was cancelled and replaced with
the full immutable SHA. It provides no application acceptance evidence.

The [isolated CPU run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38095196924)
compares baseline `0d431f2` against candidate/harness `f25154a` on Node 24.14.0,
Linux 6.17.0-1022-azure and AMD EPYC 9V74. All 40 alternating pairs complete with
identical fixture trajectories, populations and before/after conditions. Root
independently verifies source, lockfile, fixture and harness hashes and recomputes
every median and ratio from the five instrumentation-disabled timed samples.
The [raw report](performance-evidence/s52-layout-reuse/cpu-report.json),
[review](performance-evidence/s52-layout-reuse/cpu-review.json) and
[run metadata](performance-evidence/s52-layout-reuse/cpu-run.json) are retained;
raw SHA-256 `9dd53e5152e246e5eb05d99262626285cbfea99494dab7702554ad6be681cd5a`.

All 35 ordinary-overlay pairs improve by 6.01-17.34%. Paired median changes for
moving generic/infrastructure/radio are -16.30%, -11.24% and -9.25%; fixed
infrastructure/radio are -12.96% and -11.37%; periodic infrastructure/radio are
-12.37% and -9.88%. The 5,000-observation detection control has a +0.50% paired
median and a -0.99% to +4.57% individual range, below the 10% regression threshold.
This is synchronous Node algorithm CPU with a mock canvas, not a browser/GPU result.
Do not multiply or pool it with the earlier projection experiment: that used a
different comparison baseline and Intel Xeon host.

All seven [full integration jobs](performance-evidence/s52-layout-reuse/ci-run.json)
pass at `f25154a`: Node 24/26 each report 6,980 tests, 6,979 passing, one skipped
and zero failures. Node 24 additionally passes one isolated check and 13 allocation
checks. Formatting, package boundaries, production builds, Windows onboarding,
three-OS update recovery and the browser journeys pass. The workflow's
published-layer-token check is PR-only and was skipped by this dispatch; this
run does not satisfy the separate representative-PR requirement.

### S52 font lifecycle: idle invalidation regression - 11 October 2026

Review of layout invalidation found that `document.fonts.ready` and `loadingdone`
only cleared cached text widths. They did not wake an idle scene or invalidate
static placement. A font could therefore leave the overlay and its hit bounds
stale until another source or camera change. The fix connects those events to
the existing host invalidation path, with host-generation checks and owned
listener removal at destruction. It adds no per-frame work or continuous hold.

All four new regression checks fail against the unchanged production modules
at harness baseline `1da828a` (runtime identical to `33d9856`). The candidate
passes 81 focused overlay checks, including static re-layout, updated edge hit
bounds and ignored callbacks from a destroyed or replaced host.
The [report](performance-evidence/s52-font-wake/report.json),
[baseline failures](performance-evidence/s52-font-wake/baseline.log) and
[candidate results](performance-evidence/s52-font-wake/candidate.log) are retained.
These Node tests use a mocked host. The separate native browser comparison below
validates real font events and render wake; neither result establishes a speedup.

The [first native attempt](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38095416446)
failed before loading the font: after a 250 ms quiet period the baseline still
requested and delivered one frame during the required 800 ms idle control.
The [raw report](performance-evidence/s52-font-wake/native-startup-failure.json)
preserves the failure and successful cleanup. The fixture now requires a full
second of continuous quiescence within a bounded startup period before beginning
the unchanged zero-frame 800 ms control. Bounded request call traces record
unexpected wakes. This changes fixture settling only, with both application
commits fixed; it does not claim to identify the earlier startup wake's cause.

The [native retry](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38095572435)
at harness `b7b96be` passes two alternating pairs of baseline `33d9856` and
candidate `0d431f2`. All four runs deliver zero frames and request zero renders
during the 800 ms idle control. Real FontFaceSet loading changes measured glyph
width on both revisions. The baseline reproduces the missing wake twice, retaining
its stale 283 px rectangle and pixel hash. The candidate wakes, repaints and
reflows to 299 px, retaining the selected feature's hit identity. After host
replacement only the new host wakes; the retired host has zero requests or frames.
The [report](performance-evidence/s52-font-wake/native-report.json),
[independent review](performance-evidence/s52-font-wake/native-review.json) and
[terminal run metadata](performance-evidence/s52-font-wake/native-run.json) retain
source hashes, native events, frame observations and successful cleanup. Raw SHA-256:
`a30f41702c26795e16d8d409cbadc738bdd416cea6e3c4fc1f71efc77f3c006b`.
This uses Chrome 152 software WebGL with a pinned test font; it is a functional
regression check, not production font fidelity, hardware or latency acceptance.

### S52 projection reuse: local CPU diagnostic - 11 October 2026

The [complete Windows CPU report](performance-evidence/s52-33d9856/cpu-windows.json)
contains all 40 baseline/candidate pairs across eight workloads. The
[independent review](performance-evidence/s52-33d9856/cpu-windows-review.json)
recomputes the medians and verifies identical fixture populations, positions,
camera inputs and settings before and after each sample. The report's SHA-256 is
`1817f9b19fd5f1d0933c08e406fc180297b080b398112de5246c0120928d277f`.
The source checkouts remained unchanged and their temporary harnesses were removed.

This batch is **diagnostic only**: repository checkout, formatting and Git/file
inspection ran concurrently on the Windows host. Pair timing spread is large;
for example, periodic infrastructure ranges from -25.76% to +29.87%, and
periodic radio has a +5.68% paired median. Fixed radio has a -16.65% paired
median, but that does not make the confounded batch acceptable. All samples,
including regressions, remain in the report. These are Node algorithm timings
with a mock canvas and fixed camera, not browser frame times or hardware evidence.

The [isolated hosted confirmation](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38094279142)
uses the same eight-workload driver at harness `1da828a`, with immutable
baseline `886b7d2` and candidate `33d9856`. It completes all 40 pairs with no
concurrent test workload. The [raw report](performance-evidence/s52-33d9856/cpu-hosted.json),
[independent review](performance-evidence/s52-33d9856/cpu-hosted-review.json) and
[run metadata](performance-evidence/s52-33d9856/cpu-hosted-run.json) are retained.
Raw SHA-256: `cd4a04b63c528ca6d3cc76cd6d8b333298c3cf014faace6bbcb9d65b5ef344a6`.
The environment is Node 24.14.0 on Linux/Xeon Platinum 8573C, using five alternating
pairs per workload, 3,000 warmup frames per process and five instrumentation-disabled
600-frame timed samples per side. Instrumented diagnostic samples are excluded
from timing medians; no forced GC occurs in the timing run.

All 20 fixed/periodic pairs improve by 2.62-8.78%. Paired median changes are -4.09%
for fixed infrastructure, -7.44% for fixed radio, -7.01% for periodic infrastructure
and -5.88% for periodic radio. Moving generic/infrastructure/radio and detection
paired medians change by +2.40%, +1.45%, +0.98% and +1.20%; no individual regression
exceeds 4.02%. Independent checks reproduce ratios and verify source, fixture,
lockfile, population and before/after condition parity for every pair. This supports
retaining the pure-projection optimization within its measured scope. It does not
establish browser layout cost, GPU speedup, motion p95 or full S52 acceptance, and
these Linux samples are not pooled with the confounded Windows observations.

### S52 projection reuse: component correctness - 11 October 2026

The experimental cache at `33d985657c8949a02cfce2f0f1ad4131d3da774c` reuses only
the pure projection, distance, altitude and visibility calculations whose
observed inputs are unchanged. Dynamic position and presentation callbacks,
placement, painting, hit targets and accessible actions still execute through
their existing paths. The comparison baseline for this individual change is
`886b7d2927b6eb3a546c0dfaf629684973d9e501`; the overall S47 baseline remains
`eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`.

The [hosted component gate](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38093700809)
uses harness `55f0c964205f1cc658625f6b5828acc9deb796fc`, the same fixture bytes
in both clean application checkouts, Chrome 152.0.7977.75, Node 24.14.0 and
Ubuntu with kernel 6.17.0-1022-azure. Its browser viewport is 1024 by 768 with
initial DPR 1; fixture cases independently vary the overlay CSS surface and DPR.
Both application revisions use Cesium 1.138.0 and the same dependency lockfile.
Five alternating pairs pass all 24 cases: settled output, entering/exiting fades,
mutable and periodic positions, camera matrices, style/selection replacement,
dynamic presentation, hide/restore, DPR-only changes, CSS resizing, UI occlusion
and accessible activation. Within each side, repeats also match exactly.

Root independently compared the named case records and verified all 240 PNG
artifact hashes against the raw report. Source commits, source/fixture hashes,
runtime versions, pixels, paint/hit rectangles, feature IDs and accessible actions
are retained. All owned pages, the browser, servers and temporary fixtures clean
up, and source checks confirm unchanged trees. No pixel masks or tolerance were
used. The [raw report](performance-evidence/s52-33d9856/report.json), SHA-256
`121d6c5221a7f1df1bc6d01f84846990030c568d02d5bc5c1b3168f6214fa6a0`,
[independent review](performance-evidence/s52-33d9856/review.json),
[terminal run metadata](performance-evidence/s52-33d9856/run.json) and all
report-referenced PNGs are archived together.

This gate exercises real browser Canvas2D with the production overlay module and
a deterministic mock viewer, camera and render event. It does not exercise the
Cesium WebGL scene, full application composition, physical Windows GPU, latency,
or retained-resource plateau. Those requirements remain pending.

Two earlier harness failures remain recorded. [Run 38093516108](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38093516108)
completed the baseline's 24 cases, then rejected Chrome's reduced page user agent
(`152.0.0.0`) because the browser API reported the full version (`152.0.7977.75`).
The correction compares the observed major version and rechecks the full browser
API version on every capture; it preserves both observations.
[Run 38093593401](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38093593401)
matched the first complete pair, then stopped on a repeat navigation's HTTP 304.
The runner now disables browser cache reuse for each fresh page. Both
[failed reports](performance-evidence/s52-33d9856/failed-harness-38093516108.json)
([second report](performance-evidence/s52-33d9856/failed-harness-38093593401.json))
are retained; neither is relabeled as a complete pass.

Full integration CI at `33d9856` separately passes all seven selected jobs:
Node 24/26 (6,973 ordinary tests passed, one skipped), 14 additional Node-24
allocation checks, formatting, package boundaries, production builds, Windows
onboarding, Windows/macOS/Linux recovery and the existing browser journeys.
Published layer-token PR checks, separately dispatched tracking and 60-minute
soaks were not part of this run. Windows recovery preserves settings, the complete
workspace and its asset hash in all five scenarios, with no forced termination;
browser closes take 456, 368, 314, 323 and 334 ms under the unchanged five-second
limit. This is hosted SwiftShader recovery evidence, not physical GPU validation
or proof of the historical shutdown failure's cause
([raw recovery](performance-evidence/s52-33d9856/windows-recovery-33d9856.json),
[review](performance-evidence/s52-33d9856/windows-recovery-33d9856-review.json)).
The preceding `d2c5aa1` five-scenario recovery result is also preserved
([raw](performance-evidence/s52-33d9856/windows-recovery-d2c5aa1.json),
[review](performance-evidence/s52-33d9856/windows-recovery-d2c5aa1-review.json)).

The full standard integration run at `61d662a870f4b1e5c82711a18676a2f3c623e847`
[passes all seven selected jobs](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38079112938)
([exact job metadata](performance-evidence/ci-61d662a.json)): Node 24/26 suites,
formatting, boundaries, production builds, Windows onboarding, Windows/macOS/Linux
installation recovery, and the Street Level/browser journeys. The separately
selected tracking and 60-minute soak jobs, and published layer-token PR checks,
were skipped. This green integration run does not override the rendered CCTV
comparison failures below, and does not cover subsequent camera compatibility
changes.

### Hosted accelerated retention recheck - 10 October 2026

The [60-minute hosted Metal run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38084725843)
passes at `996a8d3b8b73da0d3f64392b993bdff81a1e857f`: 252 measured cycles in
3,603,211 ms, including 1,008 source toggles, 252 imports, 252 replay seeks,
504 workspace reloads, 252 archive failures and 252 camera recoveries. Across
13 post-GC checkpoints, all 40 declared application resource gauges equal the
warmed baseline. Browser listeners return from 629 to 629, with intermediate
counts up to 639. Five checkpoints contain one newly submitted terrain worker
task aged 10.0–15.5 ms; all final tasks are completed and none are pending. This
does not claim every intermediate snapshot has zero work.

Final-window retained heap grows 1.70%, below the unchanged 5% limit; peak growth
in that window is also 1.70%. The complete retained-heap range is 75,301,404 to
82,050,228 bytes, with a separately sampled peak heap of 110,911,592 bytes.
Root independently checked checkpoint chronology, collection completion,
worker conservation, resource equality, operation totals and the heap window,
then recomputed the existing stability verdict without changing its thresholds.
The preliminary capture matrix also passes all 12 checks.

The environment is GitHub's macOS 26 image `20260907.0351.1`, Apple M1 (Virtual),
three logical CPUs, approximately 7 GiB RAM, Chrome 152.0.7977.75 and verified
Apple paravirtual Metal. This is a forced-GC retention diagnostic, not a latency
measurement or physical Windows acceptance. It does not clear the later
`f598310` import smoke failure or validate subsequent commits.
[Raw log-extracted report](performance-evidence/hosted-mac-996a8d3.json),
SHA-256 `dad43a0a25013dd621f9e1b4e0b9060c5ca57d1ad0162a9764646b76c125177b`;
[independent review](performance-evidence/hosted-mac-996a8d3-review.json);
[terminal run metadata](performance-evidence/hosted-mac-996a8d3-run.json).

### Windows recovery recheck - 10 October 2026

The Windows recovery job at `f59831067a27b223781956af5430afda300be569`
[passes all five scenarios](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38087067518/job/114315686324):
prior install, interrupted update, rollback, successful upgrade, and failed
verification followed by rollback and reopening assets. Settings and complete
workspace contents match at every checkpoint; the persisted asset hash remains
`0de37a471d02bb57a555ac30082025624f55ddc576d312db772d9deb62f66fcc`.
Every owned application page closes, no unexpected page target appears, and all
five browser processes exit normally without forced termination. Close durations
are 552, 436, 344, 1,065 and 619 ms against the unchanged five-second deadline.

This is a clean, unchanged candidate on hosted Windows with Node 24.14.0,
Chrome 152.0.7977.75 and SwiftShader. It verifies recovery behavior, not physical
GPU performance, and does not establish the cause of historical intermittent
shutdown failures. Root independently checked each persisted-content and close
observation. [Raw report extracted from the job log](performance-evidence/profile-recovery-38087067518-windows.json),
SHA-256 `c6ec2f2d41dde357ea4c9b6897176687087faa4515d725dbe55c960730f2748b`;
[terminal job metadata](performance-evidence/profile-recovery-38087067518-windows-job.json).

### Mixed-use save conflict - 10 October 2026

The [full CI run at `f598310`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38087067518)
fails its mixed-use smoke during cycle 1's import application. The page reports
that a newer workspace revision prevents applying the import, while its main
status reports `Autosaved revision 3.` All worker tasks have completed, pending
worker counts are zero, the import layer is empty, and the document is visible
and focused. This is a failed save operation, not evidence of a retained worker
or a frame deadline problem. The harness waits for success until its unchanged
30-second limit.

The autosave and import handlers in that revision call the same optimistic-revision
save independently. Deterministic delayed-commit tests reproduce overlap in both
orders against the unchanged parent implementation; both writers try to commit
the same expected revision. Another negative control shows that refreshing the
list could adopt an external revision without restoring its view, bypassing the
next save's conflict protection. Root independently reproduced all three
failures against `1a1688c`, whose workspace panel source matches `f598310`.
No rerun or timeout increase clears the historical failure. Node 24/26, three-OS
recovery and Windows onboarding pass at this SHA, but the integration result is
**failed**. [Raw failure extracted from the job log](performance-evidence/mixed-use-smoke-f598310.json),
SHA-256 `a4bcaad72e57f71b5e5420a162eb7fc1b827b8eb137d13839769b77c8fab3b18`.

The follow-up patch gives panel writes an ordered queue. It captures workspace
identity and generation at enqueue time, builds snapshots and content patches
from that owner's latest state at execution, and publishes the saved revision
and chunks before releasing the next writer. Autosave, imports, saved queries,
evidence pins, manual Save, history recovery and duplicate operations share this
ordering. Refresh only updates the listing; it cannot silently adopt a newer
external revision. Reopening drains earlier writes, and backup imports restore
their own view before becoming an active save target. Superseded or disposed
owners cannot redirect queued writes into another workspace. Real external
revision conflicts remain failures without retries. The focused workspace,
import, history, restore and storage suite passes 44/44 checks, including 19
panel tests. Repository formatting passes for 1,508 source files, and package
boundaries pass for 1,003 modules and 78 portable entries. Exact-commit rendered
and full integration results for this fix are recorded below.

The follow-up is committed as `167ba62c047fe94f36d0d60066aa4d648ede7519`.
Its [isolated rendered smoke](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38090185732)
passes both warmup cycles and one measured cycle in 21,423 ms. The measured
cycle completes four source toggles, one import, one replay seek, two workspace
reloads, one archive failure/recovery and one camera recovery. Application,
candidate and harness identities match, and source state remains clean and
unchanged throughout. Root independently checked these fields and recomputed
the unchanged stability verdict: **pending**, because this is a short smoke.
This uses hosted Ubuntu 24 and Chrome 152.0.7977.75 with SwiftShader; it is not
physical GPU evidence or a full integration pass.
[Raw report](performance-evidence/mixed-use-smoke-167ba62.json),
SHA-256 `eba6049984179fa3a13805944b7c7baeb2523f4bf07db1ddb8c6fe5d5bf720ef`;
[terminal run metadata](performance-evidence/mixed-use-smoke-167ba62-run.json).

The subsequent [full integration](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38090393482)
passes all seven selected jobs at the same `167ba62` revision. Each Node suite
reports 6,968 passes, zero failures and one skip; Node 24 additionally passes all
14 calibrated allocation checks. Node 26 does not run those Node-24-calibrated
allocation probes. The browser job passes every selected journey, including
its own mixed-use smoke, accessibility, evidence transfer, visual settings,
director sharing and portable panels. Separate tracking, 60-minute soak and
published layer-token PR checks were not selected and remain separate gates.
[Full job metadata](performance-evidence/ci-167ba62.json).

The current [Windows recovery report](performance-evidence/profile-recovery-38090393482-windows.json)
passes all five scenarios with matching settings, complete workspace bundles and
the same persisted asset hash as the earlier run. All five owned browser
processes exit normally in 685, 442, 343, 390 and 388 ms, under the unchanged
five-second deadline; no forced termination or unexpected page targets occur.
Report SHA-256 `aa60c9e8b3db8850a073e43985f163eaf3d59ebd06e5998ad062abc119482535`;
[terminal job metadata](performance-evidence/profile-recovery-38090393482-windows-job.json).
This validates hosted Windows/SwiftShader recovery at this revision, not the
root cause of the earlier intermittent shutdown failure or physical GPU behavior.

The dedicated workspace journey added in
`886b7d2927b6eb3a546c0dfaf629684973d9e501` also passes in the
[isolated hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38091408792).
It opens a second independent application page against the same IndexedDB
origin, saves a newer revision through its UI, and verifies that the stale
first-page Save reports a conflict without changing the stored revision,
document or chunks. Save as, duplicate/open, GeoJSON import and reload,
command-palette dismissal and the synthetic demo also pass. The accompanying
mixed-use smoke completes two warmups and one 21,777-ms measured cycle with
clean, unchanged application/harness identities. This is hosted SwiftShader
functional evidence; the 60-minute stability verdict remains **pending**.
[Reviewed assertions and environment](performance-evidence/workspace-browser-886b7d2-review.json),
[raw smoke](performance-evidence/mixed-use-smoke-886b7d2.json),
[terminal steps](performance-evidence/mixed-use-smoke-886b7d2-run.json).
Raw smoke SHA-256:
`054a8210603eabbde67cc1bdb5ae054983cbc8875b17c609afc017a9e4522133`.

### Tracking fixture ground coverage correction - 10 October 2026

The failed `996a8d3` tracking report observed a 192.4-m floor after initially
seeding 440 m. The ground service's mesh cells do not expire; the moving
12-m/s contact can leave the fixture's old three-by-three seed patch during
its existing model-load wait. A structural service reproduction loses mesh
coverage after 180 m; the earlier browser report did not record its actual
cell, so that reproduction alone does not establish the exact failed route.

The fixture now seeds a bounded corridor from the observed display position
through the feed fix and the forward distance allowed by its unchanged
43.1-second operation budget. Route construction fails before changing the
cache if it exceeds 64 cells or 1,024 samples. Cold, model-visible and
billboard-visible checkpoints record actual cells, mesh floors and elapsed
time, and fail outside the declared coverage. Off-route and missing-floor
controls retain the distinction between known ground and unavailable ground.
The existing model/billboard ownership assertions remain unchanged. No runtime
tracking or floor-service behavior is changed. Four focused helper/wiring
checks pass. The [rendered run at `8c3e99a`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38086425275)
passes all 111 checks, with zero failures/skips. Its cold/model/billboard
observations occur at 5.3/9.7/10.5 seconds, 66/119/129 m from the starting
position, each with the intended 440-m mesh floor. Thirty seeded cells cover
the declared route; off-route and missing-floor controls remain unclamped.
The tracked model renders while the billboard floor stands aside, then the
billboard returns at 441.5 m after model exit. This confirms the corrected
fixture's invariants without a production floor change. Normal close takes
1.23 seconds; no console or HTTP 5xx errors occur. The downloaded source
revision is clean and matches `8c3e99a8f17e9fd0bc67ad4632d50516fc6d03c9`.
[Raw output](performance-evidence/tracking-8c3e99a.txt),
[terminal job metadata](performance-evidence/tracking-8c3e99a-run.json).
Raw SHA-256: `8fac4832d61c964f609685c182610fee286c4f053dfdb4ada525706dac3e61cb`.
Hosted software rendering remains separate from physical Windows p95 acceptance.

### S50.3 asynchronous CCTV revision validation - 10 October 2026

The lifecycle runner now has a version-2 acceptance path for rapid calibration
changes. It first captures separately settled revisions A and B, then withholds
one real `createGeometry.js` response before normal main-thread delivery, applies
B, and releases the original response unchanged. A second case disables the
layer while A remains outstanding, releases A while disabled, then re-enables B.
The fixture checks pixels, geometry, styles, picked identities, worker-counter
conservation and settled resource ownership. Disabled reference captures detect
unexpected visible geometry during and after late delivery. Only fixture-owned
listeners and held data are released; shared workers are not terminated.

This tests delayed delivery of a completed worker result; it does not claim
overlapping worker computation. Legacy version-1 reports retain their original
validation scope and cannot supply this new acceptance evidence. Root's 20
focused checks pass, including cleanup failures, mismatched worker ownership,
visible resurrection, stale pixels and legacy report compatibility. The archived
version-1 pass at `db298d4` also validates through the legacy path. Package
boundaries pass. The rendered version-2 run now passes at `4206611`, as recorded below.
No production geometry change or broader S50 completion is claimed by adding
this fixture.

The first [rendered version-2 run at `1125996`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38085781697)
fails before arming the response gate: its fresh-capture helper assumed a
`window.Cesium` global, which the Vite module application does not expose. The
five existing toggle cycles pass, and fixture cleanup releases all boundary
listeners with normal 77-ms browser close. The capture helper now reads the
viewer's authoritative clock and projects Cartesian coordinate records without
a global namespace. The focused capture test explicitly omits that namespace
and passes; formatting passes. Rendered validation of the correction remains
pending. [Raw failed report](performance-evidence/cctv-lifecycle-38085781697.json),
[terminal job metadata](performance-evidence/cctv-lifecycle-38085781697-run.json).
Raw SHA-256: `7170f6c6d4d183ea6b3c5e8c71a9242e862952bf493a569c0f0fcff805d80ea3`.

The [follow-up at `78e41ef`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38086026418)
fixes the missing global and captures revision A successfully. All five toggle
cycles pass again, but the settled B capture rejects an unexpected pick identity
before the response gate is armed. The old error did not preserve that identity;
the next diagnostic includes its bounded value and sample index while retaining
the rejection. Twenty focused checks pass, including the diagnostic assertion.
This is not delayed-response acceptance. There are no page errors; boundary
listeners and payload are released, and the browser closes normally in 71 ms.
[Raw failed report](performance-evidence/cctv-lifecycle-38086026418.json),
[terminal job metadata](performance-evidence/cctv-lifecycle-38086026418-run.json).
Raw SHA-256: `adc4ad3c14292a18a1c37080db8a6fb499fa6c01dd90f39649a201e8541515d4`.

The [identity diagnostic at `8c3e99a`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38086422967)
observes `cctv-qa-cctv-lifecycle-camera-001-plane` at a ray/cap corner. This is
the active camera's real projection Entity, recognized by the production click
ownership resolver; restricting every pick to wireframe IDs was incorrect.
The capture now records that resolver's camera ID and permits the projection
plane only with matching live ownership. Missing/foreign owners still fail,
the complete pick sequence must match the settled B reference, and disabled
captures still require null picks. No production geometry or visual threshold
changes. A separate review also corrects the disabled-state assertion to read
the manager's actual `{enabled, lifecycleState, uncertain}` object; tests reject
uncertain and incomplete transitions. Rendered validation remains pending.
[Raw failed report](performance-evidence/cctv-lifecycle-38086422967.json),
[terminal job metadata](performance-evidence/cctv-lifecycle-38086422967-run.json).
Raw SHA-256: `14332f5202d97f082c1fcdec5821e6d42d2da10aec504f08a6117c6126937036`.

The [rendered version-2 run at `4206611`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38086695433)
passes all five unchanged toggles, disabled reinitialization and both delayed
response cases. Root independently recomputed report validation. Revision B's
geometry, style, PNG and exact pick sequence match its settled reference after
enabled late delivery and after disabled delivery/re-enable. Both disabled
captures match the hidden reference, with zero visible coverage entities and
null picks/owners. Each held task belongs to a real `createGeometry.js` worker;
B submits six geometry jobs while its prior response remains held. After drain,
worker pending jobs are zero and scene/module ownership equals the warmed
enabled/disabled baselines. All fixture listeners and held payloads are released,
there are no page errors, and normal browser close takes 69 ms.

[Raw passed report](performance-evidence/cctv-lifecycle-38086695433.json),
[terminal job metadata](performance-evidence/cctv-lifecycle-38086695433-run.json).
Raw SHA-256: `d604a6b0900fa27c56aa0a07934d1c5fb241160230cbdae3f0c981d611e896ac`.
The source was clean at exact commit `4206611abc06c6fa3161c0f88e99a86624201ebf`.
Twenty fixture tests, four existing production pick/ownership tests, formatting
across 1,501 source files and package boundaries pass. This is hosted SwiftShader
lifecycle evidence, not a physical GPU performance result. Pose/terrain revision
coverage, full visual comparisons and the broader S50 acceptance remain open.

### S50.2 CCTV calibration handle geometry reuse - 10 October 2026

The next candidate compares numeric Cartesian positions before replacing the
five calibration-handle polylines and point anchors. Cesium's constant array
property otherwise treats equivalent newly allocated arrays as a definition
change. Changed arrays own cloned positions so later in-place source edits cannot
silently mutate materialized geometry. Handle IDs, widths, colors, geometry and
visibility remain unchanged; the existing explicit render invalidations remain.

Root repeated all 15 focused gizmo tests, including actual Cesium
`PolylineGeometryUpdater` notifications for unchanged refreshes, disable/enable,
equivalent cloned records, heading, range, pitch, cap/FOV, terrain height and
in-place pose edits. The reproducible comparison is
`node scripts/qa-cctv-gizmo-geometry.mjs --out qa-artifacts/gizmo-comparison.json`.
It compares five pairs of ten exact numerical entity snapshots against
`aea307c211e99f2f23a538a8356825723edd0097`, recording source hashes and dirty state.
This measures definition-change notifications, not submitted worker jobs, GPU
work or frame time. Frozen-commit, rendered and integration results follow below.
This does not complete the wider S50.1 revision audit.

The frozen, clean-source [five-pair Node comparison](performance-evidence/gizmo-geometry-996a8d3.json)
at `996a8d3b8b73da0d3f64392b993bdff81a1e857f` passes all 50 exact snapshot
comparisons. Actual updater notifications fall from 375 to 80 across the fixed
sequence. Root's 15 focused tests, formatting across 1,499 adopted files and
package-boundary checks pass. [Rendered comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38083654918)
and [full integration](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38083652826)
both pass at this revision. No FPS, GPU-build or full S50 acceptance claim follows from the Node
result.

The [raw rendered report](performance-evidence/calibration-38083654918.json)
passes five alternating pairs, with 1,433 total legacy-control idle frames versus
zero candidate idle frames. All native drags, current-geometry readiness, exact
pair pixels, stable camera poses and ten-viewer cleanup checks pass, with zero
page errors or external requests and normal 455-ms browser shutdown. The
[cross-commit endpoint comparison](performance-evidence/gizmo-rendered-996a8d3.json)
also matches all twenty before/after pixel digests against `aea307c`, plus all
ten trials' numeric camera/geometry, calibration, pick identity, viewport and
effective visual settings. The fixture, Chrome/renderer and hosted image
identities match; source-report hashes bind the comparison to both raw inputs.
[Terminal job metadata](performance-evidence/calibration-38083654918-run.json)
identifies the exact candidate. This is Apple paravirtual Metal acceleration,
not a physical Mac or Windows comparison. It validates this fixture's geometry
reuse without proving full-app FPS or the rapid-edit async publication contract.

### Recovery integration follow-up - 10 October 2026

The [completed integration run at `aea307c`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38082567321)
passes both Node versions, Windows onboarding and all browser journeys, but fails
all three installation-recovery jobs ([job metadata](performance-evidence/ci-aea307c.json)).
The current release stager attempted to copy the new Cesium patch script out of
the historical `6b896e2` installation, where it does not exist. `e82d12a` includes
patch support files only when the staged package declares the patch hook; current
packages still fail staging if required support files are missing. Seven focused
staging/recovery checks pass. The failed CI result remains failed.

The [Windows-only run at `e4a163c`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38083013719)
gets past staging and preserves the same asset digest, settings and workspace in
all five recovery checkpoints. It nevertheless **fails** the final checkpoint's
browser shutdown. The page closes and zero pages remain; Chrome acknowledges
`Browser.close` in 11.1 ms and disconnects in 41.9 ms, but the parent process
exceeds the unchanged five-second deadline and needs confirmed forced cleanup.
The first four closes complete normally in 381-625 ms. This repeats the unresolved
Windows post-acknowledgement shutdown failure, rather than proving its cause or a
fix. [Raw report extracted from the CI log](performance-evidence/profile-recovery-38083013719-windows.json)
and [terminal job metadata](performance-evidence/profile-recovery-38083013719-run.json)
retain the failure. The runner uses hosted SwiftShader; this is not physical GPU
evidence.

All seven selected jobs in the subsequent [full integration at `996a8d3`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38083652826)
pass ([terminal job metadata](performance-evidence/ci-996a8d3.json)): Node 24/26
unit suites and production builds, formatting/package boundaries, Windows
onboarding, all browser journeys and recovery on Windows, Linux and macOS.
The separately selected tracking, full soak and published layer-token PR checks
are not part of this standard run. Tracking at this exact candidate fails as
recorded below.

The [Windows recovery report](performance-evidence/profile-recovery-38083652826-windows.json)
preserves the same asset digest, settings and workspace across all five
checkpoints, with no forced termination. Four browser closes take 323-536 ms;
the final failed-verification rollback closes normally in 4,383 ms, still within
the unchanged five-second gate. That near-limit observation is retained and does
not establish the cause or closure of the previous intermittent process-shutdown
failures. The report was extracted unchanged from its delimited CI log JSON;
SHA-256 `24b4342de53193d5c4d79e54e92c0cc8ee161610bdfd4900cf080bf45d04368b`.

### Tracking failure and CI exit propagation - 10 October 2026

The [tracking run at `996a8d3`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38084308489)
reports **108 passed, one failed, zero skipped** in its [raw output](performance-evidence/tracking-996a8d3.txt).
The failed `display-floor/regime` check observes the tracked entity at 204.5 m
with a sampled floor of 192.4 m, after the scenario had planted a 440 m floor.
The fixture's floor ownership and seeded-cell coverage need investigation before attributing
this to a runtime regression. Normal browser cleanup takes 700 ms; no forced
termination occurs. Raw SHA-256:
`f2684bcf11bb5f2dc650a51255149e720de08ceac28e0ed773854643efc02ba0`.

The [job metadata](performance-evidence/tracking-996a8d3-run.json) nevertheless
reports success. The tracking step used an unspecified shell and piped Node's
output through `tee`; the pipeline returned `tee`'s successful exit status.
The step now explicitly selects Bash, which enables `pipefail` under
[GitHub's documented shell semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell).
An [executed negative control](performance-evidence/tracking-shell-control.json)
reproduces exit 7 being masked as zero with the old invocation, then propagated
as 7 with the corrected invocation; successful exit zero and logged output are
preserved. This fixes the reporting gate, not the underlying tracking failure.
The already-failed run remains failed acceptance evidence despite its green badge.

### S51.4 CCTV calibration render-demand candidate - 10 October 2026

The next candidate removes the permanent `cctv-adjust` render hold. Accepted
calibration edits, gizmo hover/visibility changes, committed ground results and
teardown instead invalidate the scene explicitly. The `cctv-projection` animation
owner is unchanged. Manual visual settings and calibration geometry remain in
force. Root's focused CCTV, camera-health, focus and native-input-driver suite
passes 309 checks; rendered acceptance and integration CI are still pending.

The new comparison constructs the production viewer and CCTV layer with one
synthetic camera and deterministic ground. Five alternating control/candidate
pairs each observe ten seconds of settled calibration mode and perform a native
east-handle drag. The control adds the former continuous hold; the candidate uses
explicit invalidation. The report retains actual picks, trusted input events,
calibration values, camera and gizmo geometry, before/after pixels, foreground
conditions and cleanup for every attempted viewer, including failed trials.
Capture requests are excluded from the idle measurement. Local Windows control
and the hosted runner use the same visible pointer instructions.

This isolates idle calibration and native drag behavior. It does not establish
full-application projection/coverage equivalence, motion p95, CPU/GPU time, or a
60-minute retention pass. The candidate must remain unaccepted until the rendered
comparison and applicable integration checks pass at its exact revision.

The first rendered revision, `e2e099a8693220159f5b3ff174019b802661ae73`, is
not accepted. The [Windows report](performance-evidence/calibration-windows-e2e099a-2026-10-10.json)
records 14 preparation frames followed by a failed 400 ms camera-pose capture,
before the first measured interval. Its one viewer and all layer owners clean
up. The reported renderer is Intel UHD 620/ANGLE D3D11, Chrome 154. SHA-256:
`2ee87a76f1b02f512b5fcacfdeb3481cc006a03203875cbddec243a43b9b8473`.

[Hosted run 38078104191](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38078104191)
also fails ([raw report](performance-evidence/calibration-38078104191.json),
[job result](performance-evidence/calibration-38078104191-run.json)). Its first
control renders 261 frames in 10,021 ms, but the native drag picks no gizmo and
does not change calibration. All six pointer moves are trusted; input dispatch
alone is therefore insufficient acceptance evidence. Cleanup succeeds and no
external requests, page errors or interception errors occur. The report also
exposes an invalid fixture layout baseline: the initial 1200x800 buffer changes
to 1200x787 before capture. The standalone fixture omitted the shared overlay
positioning rules; those inserted elements participated in its grid layout.
That fixture defect must be corrected before comparisons. It does not establish
the cause of either the missed pick or the Windows capture failure. Raw SHA-256:
`bfe9e875034afe9637e718189ffbad11894cadea371009b36ba5d7b481385b53`.

A separate input-path reproduction confirms that the gizmo can drop the final
drag position: two moves one millisecond apart reach 10 m and 20 m, but release
previously commits 10 m because the second move is throttled. The fix flushes
the release position to the pinned record if it is still selected, skips an
already-applied endpoint, and restores navigation in a `finally` block. Thirteen
focused tests pass, including the former failing sequence, equal-endpoint writes
and selection changes. This correctness fix does not explain the earlier missing
scene pick or the Windows capture timeout; rendered acceptance remains pending.

The corrected foundation styles at `04ff0c8a769fcccb9a8c49dc7c7c0d2f823a5664`
stabilize the initial height, but do not pass the comparison.
[Hosted run 38078622285](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38078622285)
([raw report](performance-evidence/calibration-38078622285.json),
[job result](performance-evidence/calibration-38078622285-run.json)) records a
1200x800 settled canvas, then a 1278x800 buffer when the visible pointer
instruction is inserted. The grid's intrinsic content width moves the handle:
the native click picks the camera billboard, clears selection, and fails.
The next fixture constrains its column and overflow, and checks canvas dimensions
through instruction insertion, pointer down, release and completed capture.
Raw SHA-256: `98a99c1cf8e08e1eb0bfcb19e65026eae2a34f1912f40ed6c9139fc6d9a4f01c`.

The [Windows run at the same revision](performance-evidence/calibration-windows-04ff0c8-2026-10-10.json)
has a stable 888x425 canvas and still fails its first 400 ms capture. Its
failure-only follow-up sees two scene renders over 2,488.5 ms, a first RAF after
428.7 ms, and roughly 2,047 ms timer / 2,049 ms RAF gaps. No render errors,
pending layer jobs, visibility changes or cleanup failures are reported.
This identifies delayed frame and timer delivery, not its cause. Bounded
scene-event spans and browser long-task observations are being added only to
the failed-trial follow-up; the acceptance deadline and measured idle intervals
remain unchanged. Raw SHA-256:
`bcce1d96e2f59a1e70e4e0223c9a6e1238293d1619463a45f347369364d3c82d`.

At `61d662a870f4b1e5c82711a18676a2f3c623e847`,
[hosted run 38079038864](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38079038864)
([raw report](performance-evidence/calibration-38079038864.json),
[job result](performance-evidence/calibration-38079038864-run.json)) verifies
stable canvas dimensions and genuine east-handle picking in both first-pair
trials. Both commit an east offset of 28.8 m, preserve selection, restore camera
input, and produce identical post-drag geometry hashes. Acceptance still fails:
the candidate has 17 idle frames, above the two-frame gate, and its post-drag
pixel hash differs (1,492 versus 1,493 non-background pixels). Before-drag pixels
match. No image mask or relaxed frame threshold is accepted. The next diagnostic
must identify the requests and actual differing pixels. Raw SHA-256:
`08f1d3c8dd78cfd0a128aa8fb8848c725e73cbac8e174e4850f2fdf82af519fe`.

The [Windows 61d662a failure](performance-evidence/calibration-windows-61d662a-2026-10-10.json)
still occurs before the measured interval, at the 400 ms camera-pose capture.
During its one-second failure follow-up, 50 timer ticks arrive normally (maximum
21.4 ms gap), but only two animation frames arrive, 433.9 ms apart. The measured
scene update spans are 0-0.2 ms and render spans 1.4-2.9 ms; supported browser
long-task and long-animation-frame observers record no entries. These are
failure-follow-up CPU spans, not GPU execution times or a measurement of the
failed capture interval. The evidence narrows this occurrence to delayed frame
delivery without establishing a browser, desktop-occlusion or GPU cause.
Manual foreground verification is requested before another Windows run.
Raw SHA-256: `336ccfcdc8a9e6cee3011078a432924ace19e25b365d62403363a98881dd8e56`.

The next [hosted diagnostic, 38079510733](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38079510733),
tests `a5c400f2c3bdd8da5b38637700899fb823ff27f5`
([raw report with mismatch PNGs](performance-evidence/calibration-38079510733.json),
[job result](performance-evidence/calibration-38079510733-run.json)). Exact
comparison finds **1,299 differing pixels**, not the one-pixel difference that
could incorrectly be inferred from the earlier non-background population counts.
Decoded PNG bytes reproduce the stored RGBA hashes. The candidate image lacks
the visible central polyline rings despite equal geometry and material hashes.
The control camera's up vector also changes during the drag; these are separate
leads requiring validation of visualizer completion and pointer ownership.

The candidate renders 18 idle frames. Its 16 observed explicit render requests
come from camera-move notifications through the world overlay and CCTV horizon
cull/card refresh paths, with no governor requests. Independent reproduction
against the installed Cesium 1.138.0 finds that 600 stationary
`Camera._updateCameraChanged()` calls preserve the camera without change
listeners but drift its direction by approximately 2.61e-14 with a listener.
The actual engine `View.checkForCameraUpdates` reports **25 false camera
changes** over those 600 calls. The engine's heading/roll getters temporarily
change and restore the live camera transform. A scoped compatibility fix is
being validated; removing listeners or increasing motion tolerances is not the
proposed remedy. This engine reproduction does not establish the cause of the
larger native-drag camera rotation or the Windows frame-delivery delay.
Raw report SHA-256:
`b63d7b275f3480e292ee814f6a61f3e1d5c0ce5a9b3f49d7975c428dd11abc79`.

The camera compatibility candidate is `48153a0bf3beb5d3ba271c621f7d08bafbb7ef31`.
Its instance-owned heading/pitch/roll getters use Cesium's ENU angle formulas
without changing the live camera transform. It applies only to Cesium 1.138 in
3D, delegates other modes to the native getter, and restores prior descriptors
on disposal or partial installation failure. Ten camera/viewer checks pass,
including native-value parity at tracked, polar and near-singular poses; the
actual engine now reports zero false changes over 600 stationary polls. Rendered
acceptance, full integration and tracking regression are being run separately.

The geometry diagnostic also observes the current public
`DataSourceDisplay.update()` result. Cesium's `ready` property latches true
after its first successful update and cannot prove that a later edit is ready.
The diagnostic preserves the first captured frame and records a bounded passive
follow-up on incomplete geometry; it never substitutes later pixels into a
failed comparison or extends the 400 ms fresh-frame deadline.

[Hosted run 38080298432](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38080298432)
([raw report](performance-evidence/calibration-38080298432.json),
[job result](performance-evidence/calibration-38080298432-run.json)) confirms the
new candidate has **zero idle frames** over ten seconds; its control has 243.
The comparison remains failed: the control still rotates slightly on native
drag release, and the candidate's first after-drag capture precedes completion
of its edited geometry (current update result false although latched ready is
true). A passive natural render 12.6 ms later reports complete geometry and the
follow-up image has 1,653 non-background pixels versus 1,495 initially. The
control's final image has 1,655. Those later pixels remain diagnostic evidence,
not a substituted pass. Both viewers clean up, with no page errors or external
requests. The next comparison must observe a completed post-release geometry
frame before applying the unchanged fresh-frame capture deadline. Raw SHA-256:
`7c93c3f5a7644d7858956109e38a465589237b73f95cfd18daf8a3933d12fda0`.

The independent [tracking regression run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38080322288)
at `48153a0` passes **109 checks, zero failures and zero skips**
([raw log](performance-evidence/tracking-48153a0.txt),
[exact run metadata](performance-evidence/tracking-48153a0-run.json)). It uses
the existing deterministic full-application harness with bundled imagery and
software rendering; it establishes tracking behavior, not hardware performance.
Browser shutdown completes normally without forced process termination.

The [standard integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38080324298)
at the same `48153a0` commit also passes all seven applicable jobs
([exact job metadata](performance-evidence/ci-48153a0.json)): Node 24/26 suites,
formatting, package boundaries, production builds, Windows onboarding,
Windows/macOS/Linux installation recovery, and the application browser journeys.
Published layer-token checks and the 60-minute soak were skipped in this dispatch.
This validates the camera-angle compatibility change at that revision; it does
not validate the later input-handoff change or replace the failed rendered comparison.

The drag-release candidate is `b80b3793cfeab8fa873c67b1332b04b90a2eeb65`.
A production-gizmo regression with Cesium's actual input controller and event
aggregator reproduces queued movement surviving pointer release. The fix keeps
the public camera-input lock through the next `postUpdate`, after the controller
drains that movement. A controller-owned lease remembers later input-state
requests and survives gizmo replacement; CCTV teardown no longer unconditionally
enables input belonging to another owner. Forty-three focused gizmo, source,
lifecycle and report-integrity checks pass, together with targeted formatting
and package boundaries. Its rendered comparison is
[run 38081150864](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38081150864);
acceptance remains pending until the raw report passes.

That comparison replaces the former fixed post-release delay with a bounded
passive wait for a naturally rendered, complete edited scene. The 400 ms
fresh-frame deadline and exact-pixel comparison remain unchanged. The validator
also requires that calibration leave the viewer's position, direction and up
vector unchanged, even if both representations would otherwise drift equally.

[Run 38081150864](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38081150864)
at `b80b379` remains **failed**
([raw report](performance-evidence/calibration-38081150864.json),
[job metadata](performance-evidence/calibration-38081150864-run.json)). Both
post-release captures now have a successful current geometry update and natural
completion evidence. The candidate again has zero idle frames (control 276),
but the control's camera up vector still changes and 712 pixels differ. Geometry
and style hashes agree, and cleanup succeeds. The queued-input regression did
not cover movements separated by disabled controller updates; Cesium retains
last-movement data across its aggregator reset, making residual inertia the next
specific reproduction to test. The handoff code is not rendered-accepted.
Raw SHA-256: `3ee5b9a63e9ae0c8f4b14a242abf1bae5b93754a1e08e2663064188222ef1f6d`.

A subsequent reproduction with the actual Cesium 1.138 controller confirms the
residual-inertia path: five mouse moves interleaved with disabled controller
updates leave the camera unchanged through the locked release update, but it
moves on all eight updates after input is restored. The aggregator retains a
valid last movement; inertia consumes it even though the drag was never applied
to the camera. The next fix must reject that history while preserving inertia
from ordinary manual gestures. This engine-only reproduction explains the
missed lifecycle path; rendered acceptance still requires a new comparison.

The next candidate applies a narrowly scoped, hash-guarded dependency patch to
the locked Cesium version. A disabled input update cancels the affected inertia
state; a fresh enabled gesture restores it through Cesium's existing path. The
same insertion covers engine source and all four distributed browser/CommonJS
bundles. Installation, development, test and build hooks apply the patch; release
staging includes its applier and manifest. See
[patch scope and removal guidance](CESIUM_DEPENDENCY_PATCHES.md).

Thirty-four focused checks pass, including the real controller regression across
all five distributions, exact stock/candidate camera-pose comparisons for manual
rotate/zoom/tilt and action transitions, subsequent navigation after unlocking,
installer guards and release recovery. The original reproduction now leaves the
camera unchanged through all eight enabled updates. Package boundaries and a
production build pass; the built browser bundle's hash matches the patched
distribution. These are implementation and automated checks only. A fresh
rendered calibration comparison and exact-commit integration run are still
required before accepting the candidate.

Candidate `aea307c211e99f2f23a538a8356825723edd0097` is under validation in
[rendered calibration](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38082567573),
[standard integration](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38082567321),
and [tracking regression](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38082567836).
The standard run exposed a release-staging compatibility error during Linux and
macOS profile-recovery setup: the current stager required the new patch files
from the prior `6b896e2` checkout, which predates them. New packages still require
their declared hook and manifest, while historical packages without that hook
remain stageable. Seven focused release/recovery tests pass after this correction,
including rejection of a new package with a missing applier. The existing CI
failures remain failures; a new exact-commit recovery run is required.

The [rendered calibration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38082567573)
at `aea307c` subsequently **passes all five pairs**
([raw report](performance-evidence/calibration-38082567573.json),
[exact job metadata](performance-evidence/calibration-38082567573-run.json)).
Each candidate renders zero frames during its ten-second settled observation;
the corresponding controls render 271, 258, 262, 251 and 234 frames. Every pair
has exact before/after pixel agreement, completed edited geometry, and unchanged
camera pose. All ten viewers and governors dispose successfully, with zero page
errors or external requests. Root revalidated the downloaded report against its
exact application/harness commit. This proves the isolated calibration-demand
comparison on hosted Apple paravirtual Metal, not physical Windows performance,
full-application equivalence, or long-run resource stability. Raw SHA-256:
`f98a6a036d050cb13cec7cb6bebd8e0c50622efd898cd2ab1aa14f54b7c00aed`.

The [tracking regression](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38082567836)
at the same clean `aea307c` revision passes **109 checks, zero failures and zero
skips** ([raw log](performance-evidence/tracking-aea307c.txt),
[job metadata](performance-evidence/tracking-aea307c-run.json)). Browser cleanup
completes normally in 722 ms without forced termination. This is the existing
full-application, fixture-based software-rendered tracking regression, not
hardware latency evidence.

### S51.3 vessel render-demand candidate - 10 October 2026

The vessel layer can use the governor's owned scheduler instead of holding
continuous rendering throughout an enabled session. Its existing 800 ms visibility
and 80 ms focus policies remain in force. Deadlines are derived from the last
actual pass, so an early timer or an intervening render cannot postpone work by
another full interval. Shared focus identity changes wake the owner; repeated
publication of the same identity does not restart its timer. Disable and destroy
dispose the scheduled update and focus subscription. Discrete source, selection,
visibility and geoid changes still request a frame. Services without the scheduler
retain the continuous-render compatibility path.

The isolated comparison uses that compatibility path as the control, fixed
synthetic observations through the production vessel adapter, and five alternating
control/candidate pairs. It checks visible billboards, focus attack/release,
completed render counts, endpoint pixels and owned cleanup. The hosted integration
uses the existing direct Fetch interceptor and short host-side result polls;
partial failures are preserved. It does not establish full application overlay,
tracking, motion-p95 or physical Windows acceptance.

Root's broader vessel, analyst, evidence, source, label, focus and governor suite
passes 136 tests; the runner's cleanup/interception suite passes 19 tests.
Four fixture-contract tests pass, including a settled release tail returning to
the normal visibility cadence. Formatting passes for 1,485 adopted files, and
package boundaries and syntax checks pass. This is not yet an accepted
optimization or a performance claim.

The first rendered comparison at exact app/harness
`fdf0bbd33c16a4a8f891157383b3a12d36adf8e9` fails
([run 38074635334](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38074635334),
[raw report](performance-evidence/vessels-38074635334.json),
[job result](performance-evidence/vessels-38074635334-run.json)). Both modes keep
all 32 billboards at alpha 255 during the required focus phase; the five-pair
comparison stops after its first pair. Although that pair reports 72 versus 3
frames before focus and 52 versus 2 afterward, the missing focus/release exercise
prevents acceptance. Capture preflight (12 checks), import preflight (10 samples),
zero page/interception errors and zero external requests are recorded separately.
Both constructed viewers are destroyed; the overall ten-viewer completion flags
remain false because the comparison stopped early. Normal browser close takes
548 ms. The renderer is hosted Apple paravirtual Metal/Chrome 152, not physical
Windows coverage. The failed raw report is preserved without changing dimming
gates or frame deadlines. Raw SHA-256:
`0b8b45fa47cf8437872e97a254840571b343c667dbed41ee7b9ce77c34b17720`.
All seven standard integration jobs pass at this revision: Node 24/26 tests and
builds, Windows onboarding, Linux/macOS/Windows install recovery, and browser
journeys. Node 24 records 6,867 passes, one skip, zero failures, plus 14
separate allocation checks. The PR-only layer-token and dedicated aircraft tracking jobs were
skipped. This CI pass does not override the failed rendered comparison.

The fixture correction places the synthetic target halfway along the camera ray
to a visible vessel. The former 10 km height difference was inside the default
8% camera-distance hysteresis band, so production correctly kept it undimmed.
The corrected preflight records actual positions, distances and competing counts
from the production focus helper. No focus tuning, phase duration or capture
deadline changes. Report validation also rejects missing contacts and contradictory
focus endpoints. Six focused tests pass, including the old geometry negative
control; a fresh rendered comparison is required.

### S51.3 corrected focus geometry exposes endpoint and Windows failures

At `4782c1822c7c5b3e4874ae2519c61f07d424b821`,
[hosted run 38075273339](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38075273339)
fails its second pair ([raw](performance-evidence/vessels-38075273339.json),
[job result](performance-evidence/vessels-38075273339-run.json)). All 32 vessels
now qualify for focus treatment under unchanged production settings. The first
pair matches all four endpoint images; the second candidate releases only to
alpha 254 while the control reaches 255, producing different pixels that persist
in the following idle phase. The existing epsilon-based completion and alpha-write
deadbands can stop the shared fade before its exact endpoint. This is a production
correctness issue, not a reason to relax image-equivalence checks. Four viewers
and their demands clean up; page/interception errors and external requests remain
zero. Raw SHA-256:
`b722f4c97e3e933fb254454dfc04deb0990ee2eb7222c5020639a0d0a98c3877`.

The same revision also fails one Windows UHD 620/ANGLE D3D11 comparison
([raw](performance-evidence/vessels-windows-4782c18-2026-10-10T18-19-56.json)).
The control renders two frames during release and still has all 32 vessels dimmed
at its deadline, recovering later. The candidate performs ten focus updates but
records zero completed frames during its 800 ms focus-active interval. Both
viewers and owned demands are destroyed. The 888x529 drawing buffer, DPR 2, four
MSAA samples and renderer are recorded; browser-version and phase foreground
conditions were not captured by this fixture revision. These observations do not
establish the cause of the Windows frame gaps or a performance pass. Raw SHA-256:
`7fbf7ca5596c45fedb075a116188d10a594e27bf3b18becfe64d81f73f131d23`.

The next comparison adds bounded visibility/focus/resize observations before,
during and after each phase, actual user-agent identity, and strict endpoint
validation. Desktop occlusion remains explicitly unavailable. Hidden, unfocused,
resized or incomplete samples fail. The shared fade endpoint fix keeps ownership through the configured endpoint
and delivers one final color write before releasing it, including composed base
alpha in CCTV and satellites. Attack, partial-focus and release values retain
their existing timing and ordinary intermediate write suppression. The helper
resets its shared completion flag on every return path. Root
passes 130 focused tests across the three production consumers, the exact failed
timestamp sequence, scheduler ownership, tracking refresh, and report integrity;
the separate calibrated allocation test also passes. Package boundaries and
formatting for 1,485 adopted files pass. A fresh rendered comparison
and integration run are required; the failed runs remain historical evidence.

### S51.3 exact-endpoint comparisons pass - 10 October 2026

Both independent report validations pass at exact application/harness revision
`65fd7f3e106f214340c1bab4afcebb9c35a0cce7`. Each comparison constructs ten fresh
viewers in five alternating control/candidate pairs. All 20 endpoint pixel
comparisons match within their pairs, all 32 vessel billboards remain present,
focus reaches its configured floor and release returns exactly to alpha 255.
All ten viewers, governors and scheduled demands clean up in each environment.

| Environment                                                                                            | Idle rendered frames, control to candidate | Evidence                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical Windows, Intel UHD 620 through ANGLE/D3D11, Chrome 154; 888x529 drawing buffer, DPR 2, MSAA 4 | 1,508 to 25 across ten idle intervals      | [Raw report](performance-evidence/vessels-windows-65fd7f3-2026-10-10.json)                                                                                                                                                  |
| GitHub hosted Apple paravirtual Metal, Chrome 152; supplemental virtual hardware                       | 502 to 25 across ten idle intervals        | [Raw report](performance-evidence/vessels-38075992435.json), [run 38075992435](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38075992435), [job result](performance-evidence/vessels-38075992435-run.json) |

The Windows comparison ran from 18:30:06 to 18:31:25 UTC. Its before-focus
intervals render 180-181 control frames versus three candidate frames; after
release they render 121-122 versus two. Before/after observations and bounded
events show unchanged viewport and visible, focused document conditions during
every phase. Desktop foreground/occlusion verification remains unavailable.
The renderer string is observed from the fixture's WebGL context. A separate
current Chrome acceleration-feature-status check is unavailable: the permitted
browser control rejects `chrome://gpu`. No browser-level status is inferred from
that blocked check or substituted from a different browser.
The comparison was started with native browser input after removing an unused
blank diagnostic tab. That differs from the earlier failed Windows run and
does not prove the cause of the historical frame-delivery failures.

The hosted run has no page errors, interception errors or external requests;
its browser closes normally in 659 ms. The shared capture and import preflights
also pass. These are isolated billboard-only comparisons, with the shared
overlay service excluded. Fewer completed idle frames do not establish lower
motion p95, CPU time, GPU time, full-application stability or the 60-minute
retention gate. The fixture uses `preserveDrawingBuffer: false`; the production
default remains unchanged.

All seven standard integration jobs pass at this exact revision
([run 38075994264](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38075994264),
[job results](performance-evidence/ci-65fd7f3.json)): Node 24/26 tests and production
builds, Windows onboarding, install/update recovery on all three operating
systems, and browser journeys. Node 24 records 6,872 passes, one skip and zero
failures, plus 14 separate allocation checks. PR-only layer-token, dedicated
aircraft tracking and full-soak jobs are skipped, not passes. This admits the
isolated vessel optimization; it does not complete S51 or final acceptance.

Raw SHA-256 values, in table order:
`3db7e1672a6bb664183dd98f75350678fcd61c91731cad10ece94c4d18031a98`,
`602cb7fa57a2fd64dd12d0f1de5bd6d20d4834bd47724f0dfbaf10fc56f24e23`.
The earlier failed reports remain intact. The next S51 packet audits calibration
gizmo demand while preserving CCTV projection's independent continuous ownership.

### Windows frame controls after Chrome reconnection - 10 October 2026

Four fresh-viewer controls used the existing frozen diagnostic build
`7e09988616e3242eef0b2349416e36b523243441`, not the current development tip.
Chrome 154 reports Intel UHD 620 through ANGLE/D3D11, a 640x360 drawing buffer,
and an 888x585 viewport at DPR 2. Settings and the 400 ms deadline are unchanged.

| Control (UTC)                   | Frame results                            | Raw report                                                                                                      |
| ------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Globe only, no copy (17:45:36)  | 3/3 delivered; 3.8-90.1 ms               | [JSON](performance-evidence/wind-frame-delivery-globe-only-no-copy-7e09988-2026-10-10T17-45-36-323Z.json)       |
| Paused wind, no copy (17:47:46) | 3/3 delivered; 9.8-32.5 ms               | [JSON](performance-evidence/wind-frame-delivery-paused-wind-no-copy-7e09988-2026-10-10T17-47-46-921Z.json)      |
| Paused wind, copy (17:48:05)    | First two copied; third failed at 412 ms | [Failure JSON](performance-evidence/wind-frame-delivery-paused-wind-copy-7e09988-2026-10-10T17-48-05-412Z.json) |
| Globe only, copy (17:50:40)     | 3/3 copied; 14.7-304.2 ms                | [JSON](performance-evidence/wind-frame-delivery-globe-only-copy-7e09988-2026-10-10T17-50-40-780Z.json)          |

The failed request observes no new animation-frame callback or Cesium render
event between its before/after observations. Its preceding two pixel hashes
match. Each control reports successful listener, diagnostic, wind and viewer
cleanup. Page focus/visibility and canvas intersection remain positive; desktop
foreground verification is explicitly unavailable. The failed variant was not
retried. These short controls preserve the intermittent failure and do not prove
its cause, current-candidate correctness, performance or Windows soak acceptance.

SHA-256 values, in table order:
`033fa3c1b56d0be3605ef3a03b72c9b894161966d7a78688b7594e80672e87d6`,
`a74fc2b2eb746ed65324e920fae8a53d2bd6d56130fc0d2629794564bca00d7a`,
`b40b10087dce291a029d6c405f80e988dcc44ece8478b288774f47b4f596c60d`,
`9ef1f7fcd192569b471634615b216ffa61cebde145ebaa0c0c9fde87319caf1b`.

### S49.1 isolated terrain and picking ownership - 10 October 2026

GPT-6 Luna's fixture and root's hosted integration at
`79f319fb7cd10bc30c985acae313b040b46981e3` exercise the production map controller
and submarine-cable layer with local heightmap terrain, local imagery and
synthetic GeoJSON. Five relief/ellipsoid cycles compare equivalent warmed
resource checkpoints after completed rendering and bounded worker drain. The
first heightmap transition must produce actual tile requests and additional
worker submissions and completions. Startup/cable work is reported separately;
these cumulative counters include all fixture work and are not exclusive terrain
CPU timings.

Native Cesium picks invoke the production click handler, followed by camera reset
and settled rendering. Three disable/re-enable cycles reject injected retired
Entities and accept current native picks. Delayed terrain completion cannot
replace a newer selected stack; destruction aborts pending creation. The late
Ellipsoid provider's disposal hook is fixture-owned because that Cesium provider
has no native `destroy()` method; it does not prove native terrain reclamation.

Six focused tests cover installed Cesium constructors, report validation, wrong
served commits, partial failures and runner cleanup. Root repeated them and
passed formatting and package boundaries. The isolated
[hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38071843269)
fails before initial readiness, with no measured cycles. Its top-level error is
`Waiting failed`; no page errors or external requests are recorded, and owned
browser/server cleanup succeeds. [Partial raw report](performance-evidence/terrain-picking-38071843269.json),
SHA-256 `bcf294b99c0e6468f30a3a38db279877642ae0bc5be55bdd30e9a039ff9b2618`;
[run metadata](performance-evidence/terrain-picking-38071843269-run.json).

Inspection of the installed Puppeteer identifies a harness timeout conflict:
`waitForFunction` awaits the poller's result through one `Runtime.callFunctionOn`
command, whose 15-second connection timeout is shorter than the fixture wait.
Changing its polling mode alone cannot fix this. The original report does not
retain the nested cause, so it cannot independently establish which protocol
command failed. A correction must use short synchronous status reads, retain
bounded causes on failure, and preserve the existing fixture/command deadlines.
No application retention conclusion follows from this failed run.

The host-polling correction at `b4db0b7ff1e79289190eb4f566b375736b53a345`
passes eight focused tests. Its
[hosted rerun](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38072252632)
gets past the former command cutoff, then fails the unchanged 30-second initial
readiness gate. At the final observation it has rendered 822 frames, globe tiles
are loaded, and DataSourceDisplay remains unready. One geometry job and five
terrain-picker jobs have been pending for about 28-29 seconds; 42 heightmap jobs
have completed. No worker errors or external requests are recorded. Owned browser
cleanup completes normally in 593 ms. [Raw failure report](performance-evidence/terrain-picking-38072252632.json),
SHA-256 `35a55857146c2ef115c52fe1284e08478f5aea9df6bd035beb7a744028a10dc7`;
[run metadata](performance-evidence/terrain-picking-38072252632-run.json).

The new runner used Puppeteer's paired request interception instead of the
repository's existing direct `Fetch.requestPaused` implementation. That repeats
the previously diagnosed worker-module interception risk. Reuse the existing
interceptor and verify paused worker requests settle without a Network event
before attributing these pending jobs to Cesium or the production layers.

That correction at `d7f25edd040a5e1d92da0e6eea63f26f97a28c44` passes
[run 38072562918](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38072562918).
All five terrain cycles return to the warmed counts: three cable data sources,
four cable listeners, two cable cache entries, four map cache entries, one imagery
layer, one scene primitive and zero pending jobs. The initial heightmap transition
requests 162 tiles and observes 174 additional worker submissions and replies.
Three native selection/re-enable cycles, injected stale picks, late terrain
replacement, fixture-owned disposal hook and final cleanup pass. Browser shutdown
completes normally in 391 ms, without forced termination. External requests remain
zero. Root independently recomputed the report validator; the nine focused tests
include a paused worker request without a matching Network event.

[Passing raw report](performance-evidence/terrain-picking-38072562918.json),
SHA-256 `b943f6c27655e5650333d870d336347332f013198f519ba3bbe02a8b01b03b4e`;
[run metadata](performance-evidence/terrain-picking-38072562918-run.json).
This unchanged production-code comparison supports request interception as the
cause of the isolated fixture stall. The historical failures remain preserved;
it does not establish the cause of the earlier physical Windows soak growth.

This fixture uses one-sample MSAA and continuous rendering for
ownership observation; it is not a visual-equivalence or performance comparison,
quantized-mesh/network-provider test, physical Windows result or heap-soak pass.
Production visual settings and the VM deployment are unchanged.

### S60.1 raw performance evidence ingestion - 10 October 2026

The candidate runner accepts version-2 manifests with SHA-256-bound raw paired
captures and retention reports; [the contract and invocation](PERFORMANCE_EVIDENCE.md)
describe required provenance and pending/failure behavior. Version-1 manifests
retain their existing behavior. Version 2 automatically enables computed
comparison and retention gates; an explicit flag enables them before evidence is
available. Cached success summaries and manual certificates cannot satisfy them.

Raw comparisons use the existing five-run validator, require a complete recorded
physical Windows environment, and keep software/hosted evidence supplemental.
Partial workload sets from different Windows machines cannot be combined.
Retention recomputes ownership and heap stability from chronological, completed
post-GC checkpoints, requires the full duration and positive mixed-use operations,
and binds application and harness to the candidate. Invalid supplemental artifacts
remain failures. Producers now record bounded host/graphics metadata outside timed
capture samples and successful GC completion at retained checkpoints.

This packet does not complete visual or interaction acceptance, remaining runtime
optimizations, the physical Windows soak, or final candidate qualification.
Synthetic acceptance tests verify the consumer and do not constitute hardware
evidence. Root repeated the focused manifest, paired-report, build-provenance,
capture-integrity and soak tests: 68 passed. Formatting passes for 1,476 adopted
files; package boundaries, modified-script syntax and diff checks also pass.
Full integration at `20e53bebe83d7a6f9598969b9dda3048649dfaad` passes all seven
standard jobs in [run 38070091246](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38070091246)
([job results](performance-evidence/ci-20e53be.json)): Node 24.14/26 suites and
production builds, Windows onboarding, Linux/macOS/Windows installation recovery,
and all browser journeys. Node 24 reports 6,847 passing tests, one declared skip,
zero failures, plus 14 separately run allocation checks. Pull-request-only
published layer-token checks were skipped, not passed.

The Windows [recovery report extracted from job logs](performance-evidence/profile-recovery-38070091246-windows.json)
preserves settings and workspace contents through all five checkpoints, including
interrupted update, rollback and failed verification. All owned browsers close
normally in 289-435 ms with no forced termination. Its renderer is SwiftShader;
this is functional recovery evidence, not physical GPU evidence. Extracted report
SHA-256 of the committed UTF-8/LF report: `942ac8e5edd1d3ac0dedb6725ea19b92b667e5987e1ffde4f0eec02edb562f9d`.
Later fixture and documentation commits are distinct from this tested revision.

### S54.2 Entity-compatible color encoding - 10 October 2026

The explicit `entity-color-attribute-byte` fixture variant at
`fdc2ab9da861f9b33c0ad01aa3275ffaf086f284` passes
[hosted run 38070594759](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38070594759).
All 20 samples (five alternating pairs for each of two styles) have exact pixels,
matching populations and point/stem picks; all 17 checks and owned cleanup pass.
The original direct-float variant remains selectable and its failed report below
remains historical evidence. [Raw report](performance-evidence/infrastructure-38070594759.json),
SHA-256 `abef2a3e408ac751c0d34e8a29fc1e2c90dcb32563b5eebb89315d1aa4e9de13`;
[run metadata](performance-evidence/infrastructure-38070594759-run.json).

The change uses Cesium's actual `ColorGeometryInstanceAttribute` byte encoding
before constructing the candidate stem material. Raw source/style colors remain
recorded; only the explicitly declared stem representation may differ, and its
effective encoded color must match. Point style, all other stem properties,
positions, feature identity, visibility and complete pixels remain exact. The
focused 0.55 alpha maps to 140/255, and the previous 184-pixel mismatch disappears.
Real-Cesium unit tests cover numeric RGBA arrays, collection readback and this
encoding contract. Root repeated all 16 focused checks plus syntax/format checks.

This is hosted Apple paravirtual Metal with Chrome 152, a 960x640 drawing buffer,
and the unchanged 704-feature dam source. It is not physical desktop evidence.
Both modes still retain all source Entities, polygons and the production update
loop. The sampled DataSourceDisplay median is 0.4/0.3 ms for the two Entity styles
and 0.2 ms in both collection cases, but candidate stem updates add a separately
measured 1.2 ms median. Entity-owned primitive update costs are not instrumented
symmetrically, so these figures do not establish a total CPU improvement. All
samples submit 48 buffer bytes. Activation and retained-memory benefit remain
unmeasured; no production batching change or performance acceptance follows.

### S54.2 native infrastructure comparison - 10 October 2026

GPT-6 Luna's fixture and root's hosted runner integration are delivered at `d6062cfe1ef2b3ea88f22c28f7b10e5b3dd48c93`. The fixture loads the production dam layer and compares its actual Entity point/stem graphics with direct Cesium point/polyline collections. It preserves all 704 source features, 716 rendered Entity parts, canonical feature identity, polygons and line-only geometry. It measures native picks, independent position/style/population hashes, exact pixels, synchronous update calls and buffer submissions. Entity storage remains present in both modes, so this experiment cannot establish total Entity memory savings. No production renderer is changed.

Ten focused contract tests pass, including actual Cesium collection ownership, item-level pick IDs, multipart source identities, cleanup, and malformed/incomplete reports. Formatting and package boundaries pass. The exact-commit [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38068347111) **fails** on `entity stem pick did not resolve to the source feature` in the first measured Entity sample after representation warmup. Initial native Entity point/stem picks pass, and the two warmup frames for each representation have identical pixel hashes. The first subsequent Entity frame differs and has a valid point pick but no matching stem pick. This is consistent with incomplete asynchronous geometry materialization after show/hide, but does not yet establish its cause. No performance or visual-equivalence acceptance follows from this run.

[Raw report](performance-evidence/infrastructure-38068347111.json), SHA-256 `73fca67fa5bcf505c4ba595cb951d7b028a6620fd707f64f31cde0eb880a32bb`; [job metadata](performance-evidence/infrastructure-38068347111-run.json). All fixture cleanup checks pass. Chrome verifies Apple paravirtual Metal acceleration; this remains hosted evidence, not physical Mac or Windows coverage. The existing 400-ms fresh-frame deadline and production visual defaults remain unchanged.

The transition-readiness correction at `73c5c05010d39c0d7a465f7efbf4979f0d3ca764` passes 12 focused tests. Its [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38068716327) stops earlier, before collection construction: after four completed frames and stable public source values, `DataSourceDisplay.ready` is true but no verified Entity point/stem pick target is available. No comparison samples or mode transitions execute, so this result cannot validate or refute the transition correction. [Raw report](performance-evidence/infrastructure-38068716327.json), SHA-256 `1f5a14d235ed640c26b69a0e77cd1ddb42b2a2239b41f90f7c0bd6b9e144d638`; [job metadata](performance-evidence/infrastructure-38068716327-run.json). The unconstructed collection cleanup flags are false; viewer and initialized layer cleanup succeed. Initial readiness now also requires actual native picks within the original setup deadline; no deadline or visual acceptance threshold is relaxed.

At `4b13e866d6bb1f69a65f4c73a59d6fba8a2ed8c9`, [run 38068928355](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38068928355) needs 11 initial frames, including seven frames with public readiness but no valid pick target. It then fails the unchanged Entity-only repeat-frame control before any A/B sample: the next two pixels hashes differ. This demonstrates why a public readiness flag and stable source values alone cannot establish a settled image. [Raw report](performance-evidence/infrastructure-38068928355.json), SHA-256 `dbc1374cd23f75d9a6335d767fd9cccd6f80cff000b3abfdfe3b1b066cf6f2e2`; [job metadata](performance-evidence/infrastructure-38068928355-run.json). All cleanup checks pass. The next fixture revision additionally requires three consecutive equal whole-frame pixel hashes within the existing readiness bounds. It retains the independent Entity repeat-frame control and exact A/B pixel gate.

The settled-frame fixture at `dc94ddfd4dc9982da78c2365e13dbf35d26d45dd` reaches the actual representation comparison in [run 38069176623](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38069176623). All five alternating default-style pairs match exact pixels, public positions/styles, full populations and native point/stem picks. After the camera/style change, the first translucent pair retains matching source/style/position hashes and picks but differs in **184 pixels**. All resource cleanup checks pass. [Raw report with both mismatch PNGs](performance-evidence/infrastructure-38069176623.json), SHA-256 `10ca03f767acb6108a5f780500b5b7a0bf505d6d4af10a0356f73440466407e6`; [job metadata](performance-evidence/infrastructure-38069176623-run.json).

Root's independent [decoded-image audit](performance-evidence/infrastructure-38069176623-image-audit.json) locates every difference along the selected stem, with a one-unit increase in the blue channel only. Cesium's Entity static color batch stores unsigned-byte color attributes, whereas the direct polyline candidate supplies a floating-point color uniform. The result is consistent with alpha quantization, but a renderer alternative has not yet been measured to establish causality. The current prototype is rejected without masking pixels or relaxing tolerance. It establishes neither an accepted infrastructure optimization nor a full-app performance gain. A subsequent alternative should preserve the Entity-compatible color representation and must still prove activation/memory benefit.

### S59.1 document decode worker prototype - 10 October 2026

A diagnostic compares the actual public GeoJSON, CSV and KML preview APIs on
the Node main thread and in a persistent `worker_threads` worker. It preserves
complete output hashes, IDs/order and counts for 50,000-vertex lines, a polygon
with a hole, and 50,000 CSV rows. Five alternating pairs measure end-to-end
completion including message cloning; worker startup and warmups are separate.
The maximum one-ms timer gap is a responsiveness observation, not CPU task
duration or proof of the four-ms application batch target. No browser worker,
production import path or default is changed.

The prototype permits one owned task, bounds fixtures and deadlines, rejects
aborted replies, and releases request state on cloning errors, worker exit and
timeout. Thirteen focused tests cover parity, malformed input, cancellation,
reuse, bounded ownership, startup readiness, exit and injected blocking controls.
An exploratory dirty-tree measurement missed synchronous KML timer gaps and is
not acceptance evidence. The corrected clean-commit comparison at
`f59831067a27b223781956af5430afda300be569` preserves all 40 sample outputs and
finishes with zero pending jobs and a terminated owned worker. Root recomputed
the five-pair medians and complete output/count comparisons from the raw report.

| Workload                     | Main completion median | Worker completion median | Change  |
| ---------------------------- | ---------------------- | ------------------------ | ------- |
| 50k-vertex GeoJSON line      | 49.87 ms               | 79.20 ms                 | +58.8%  |
| 50k-vertex polygon with hole | 39.92 ms               | 86.17 ms                 | +115.8% |
| 50k CSV rows                 | 535.47 ms              | 701.03 ms                | +30.9%  |
| 50k-coordinate KML line      | 66.82 ms               | 102.23 ms                | +53.0%  |

Worker startup is 59.86 ms, excluded from these warmed comparisons. CSV's
main-thread timer-gap median falls from 129.22 to 18.44 ms and KML's from 66.93
to 16.14 ms, but total completion regresses for every workload. This whole-result
worker prototype is **rejected as a production default**. Its report's `passed`
status describes output parity and cleanup, not performance acceptance. The next
experiment must address result-cloning overhead and include packing, rehydration
and scheduling costs rather than hiding them. The production parser is unchanged.

[Raw comparison](performance-evidence/s59-document-decode-worker-f598310.json),
SHA-256 `e8ee9a9813dbdc73a859aa3e555561d37eb53b5e4a8308726bbb9d204c72eff3`.
Environment: Windows 10.0.19045, Node 24.16.0, i7-8665U, approximately 16 GB RAM.
This is Node CPU/queue evidence on the available Windows machine, not browser or
GPU evidence. GPX and browser interaction acceptance remain open.

### S59.1 transferable-coordinate experiment - 10 October 2026

The diagnostic at `ef6fcd5de4ead7e5771a08f4eecc0cd35bd6ecb5` adds a
third path: transferable numeric coordinate buffers with cloned metadata and
cooperative reconstruction on the main thread. It uses the existing batch
consumer with a four-ms target. Packing, reconstruction, delivery and scheduling
remain included in total completion. Startup and all three warmups are measured
separately. Neither this prototype nor the preceding worker prototype changes
the production import path.

Twenty-two focused tests pass, including exact metadata/key-order preservation,
50,000-coordinate and 200,000-instruction bounds, malformed packets, cancellation,
and timeout/disposal while reconstruction owns a scheduled wake. Root repeated
these checks; package boundaries and formatting of 1,506 source files pass.
The clean comparison has five rotated triples for each of four workloads, all
60 outputs matching their complete hashes and expected counts/order. Source
identity remains clean and unchanged through cleanup, with no pending jobs and
the owned worker terminated. Root independently recomputed all medians.

| Workload                     | Main median | Clone-worker median | Transfer-worker median | Transfer reconstruction median |
| ---------------------------- | ----------: | ------------------: | ---------------------: | -----------------------------: |
| 50k-vertex GeoJSON line      |    40.40 ms |           105.07 ms |              418.38 ms |                      330.63 ms |
| 50k-vertex polygon with hole |    39.36 ms |            83.18 ms |              333.45 ms |                      256.78 ms |
| 50k CSV rows                 |   455.29 ms |           593.71 ms |              901.64 ms |                      269.70 ms |
| 50k-coordinate KML line      |    53.79 ms |            81.37 ms |              331.31 ms |                      246.55 ms |

Transfer is **rejected as a production path**: total completion regresses for
every workload, and the CSV median main-thread timer gap remains 104.49 ms.
Observed reconstruction batches reach 4.16 ms; the four-ms target is not a hard
wall-clock guarantee. The unassigned remainder explicitly combines cloning,
delivery, reconstruction and scheduling; it does not isolate clone cost. Worker
startup takes 68.00 ms and is excluded from warmed samples. The next S59 packet
targets the existing CSV scanner and final summary pass instead of accepting
the transport regression.

[Raw comparison](performance-evidence/s59-coordinate-transfer-ef6fcd5.json),
SHA-256 `27df11a6abcf6aee2472087930735fe407ec93db524031ceaae439374eed851d`.
This is Windows 10.0.19045 / Node 24.16.0 / i7-8665U CPU evidence, not browser
interaction or GPU acceptance. A passing report means output parity and cleanup;
it does not mean the performance target passed.

### S59.1 cooperative CSV scanner disposition - 10 October 2026

The shared-generator scanner candidate at
`00aecc4c46f83e53bb7bb778fd604f64d95eff3e` preserves synchronous public parser
contracts and all 60 outputs in a clean exact-source comparison against
`ef6fcd5`. However, full preview completion regresses from 392.15 to 540.39 ms
(37.8%) for 50,000 ordinary rows, and from 802.24 to 1,036.39 ms (29.2%) for
5,000 long quoted records with aligned CRLF boundaries. Median main-thread timer
gaps decrease from 70.77 to 17.44 ms and from 257.90 to 36.92 ms respectively,
but that improvement does not waive the completion regression. The cooperative
scanner is rejected and the original synchronous parser/scheduling is restored.
Pre-cancellation checks and summary accumulation are isolated for a separate
comparison; full bounded document decoding remains unfinished.

Thirty-nine focused parser, batching, workspace ownership, cancellation and
comparison checks pass before measurement. The deterministic CRLF/escaped-quote
tests caught and corrected an index-skipping yield bug in the rejected prototype;
passing those tests did not establish acceptable throughput. Root independently
recomputed five paired medians and full output hashes for all six workloads.
[Raw comparison](performance-evidence/csv-decode-comparison-00aecc4.json),
SHA-256 `931d65a5b73ba88bce9cc50712b5e1011b5f9048d98735b264844eb2a7eadffa`.
This is local Windows/Node CPU and event-loop evidence, not browser interaction
or GPU acceptance.

The isolated summary candidate at `01ab8671f250e83b6b8a7c386b8b555a4bd6630d`
also preserves all 60 complete outputs with clean source before and after its
comparison, but does not demonstrate a repeatable preview benefit. Ordinary
preview medians are 366.96 versus 374.41 ms (2.0% slower), and long quoted CRLF
preview medians are 686.22 versus 713.42 ms (4.0% slower). The summary optimization
is therefore not accepted. Only the separately demonstrated correctness fix for
already-cancelled CSV requests is retained; bounded full decoding remains open.

The synchronous long-record parser comparison also reports 235.62 versus
267.40 ms (13.5% slower, candidate slower in four of five pairs). Root verified
that the scanner, header validation and synchronous public wrappers are
byte-identical between these revisions. This does not prove an algorithmic
regression or excuse the observed result: load/JIT/GC and measurement-order
controls remain needed before attributing it. No performance pass is claimed.
Short header operations now report a null timer gap when the observer receives
no tick, instead of implying a measured zero gap. [Raw comparison](performance-evidence/csv-decode-comparison-01ab867.json),
SHA-256 `dafbaf5a20b32dacb328488287192b95e9930c3c5ebe6ddf0b27d2aaf7f1cd88`.

### S59.1 CSV column setup - 10 October 2026

GPT-6 Luna's `9a665b2bcbd17c081544ccd21b1d4ea2591e68ee` adds a header-only mode to the existing CSV scanner. Column mapping no longer materializes every data row merely to discover the column names. The public full decoder and preview retain complete body validation, output ordering, quoted multiline/BOM handling and existing error precedence. A malformed body is still rejected when the user requests a preview; header setup deliberately validates only the header. Twenty-four focused parser, cancellation and import panel checks pass in the root review, and package boundaries pass.

Root's independent [exact-source comparison](performance-evidence/csv-header-comparison-9a665b2.json) uses baseline `2b269e3` and the clean candidate on Windows/Node 24.16.0. Each of four workloads has two warmups per variant and five alternating pairs over the same 50,000-row, 2,892,263-byte fixture. All 40 timed samples match their complete expected output hash. No forced GC or profiler is active. [Reproduction harness](performance-evidence/csv-header-comparison.mjs).

| Local CPU workload             | Baseline median | Candidate median |                                              Change |
| ------------------------------ | --------------: | ---------------: | --------------------------------------------------: |
| Column-name discovery          |        87.77 ms |         0.024 ms |                     Removes the redundant body scan |
| Column setup plus full preview |       433.15 ms |        327.29 ms |                                         24.4% lower |
| Standalone full preview        |       346.26 ms |        339.48 ms |                                          2.0% lower |
| Public full decoder            |        74.62 ms |         79.43 ms | 6.4% higher; within the 10% investigation threshold |

Report SHA-256: `b272baad50b091ab2f0c197f45e7e07cde1e7800930ce8d6ae62809fb45ff6ce`; harness SHA-256: `5233ff694d80309addb67c7dc8f1a4df6f5d460bfcbcca06f2231e09611c8d43`. Run `node docs/performance-evidence/csv-header-comparison.mjs 9a665b2bcbd17c081544ccd21b1d4ea2591e68ee` from that clean checkout with the retained harness and locked dependencies.

This accepts the narrow redundant-scan removal, not full CSV cooperative decoding or browser interaction/GPU acceptance. The separate cooperative prototype was not retained. Its early exploratory median summaries used incorrect alternating-sample grouping and are invalid; they do not establish a regression or acceptance. A future cooperative design requires new, versioned measurements, including repeated preview without header setup. The code is pushed to `dev`. All seven jobs in its exact-candidate [full CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38065661135) pass ([job results](performance-evidence/ci-9a665b2.json)): Node 24/26, production builds, every browser journey, Windows onboarding, and installation/update recovery on Linux, macOS and Windows. Node 24 passes 6,824 tests with one declared skip, plus 14 separate allocation checks. The [Windows recovery report](performance-evidence/profile-recovery-38065661135-windows.json) passes all five persisted-settings/workspace checkpoints with normal shutdown in 310?542 ms and no forced termination; SHA-256 `7d1fe1dda03be3098bbcb4931db0bfdaaa283b245e712df702c1e262ec567715`. Hosted SwiftShader recovery is functional evidence, not physical GPU coverage.

### S59.2 import form ownership - 10 October 2026

GPT-6 Luna's `2b269e368efd92a39ef3f4128ea7d1d6684c8f62` gives asynchronous file reads and previews explicit ownership. A new selection clears the previous summary and disables Apply immediately. Replaced, cancelled or disposed reads cannot publish data or errors; pending workspace-bound work cannot complete into a different workspace. Completed previews remain editable when the user chooses another destination workspace. An already-started save persists its original import, while a newer selection retains control of the form and status even if the old save finishes rendering later.

Twenty-one focused parser, cancellation, ownership and panel-event checks pass, alongside syntax, formatting and package boundaries. Root independently ran the same four panel-event regressions against the exact previous panel (`4170838`) and the candidate: all four reproduce stale summary/status failures before the fix and pass afterward. [Comparison record](performance-evidence/import-owner-regression-2b269e3.json), [baseline output](performance-evidence/import-owner-baseline-output.json), [candidate output](performance-evidence/import-owner-candidate-output.json). This uses a lightweight DOM and in-memory storage with the production panel, not browser timing or GPU evidence.

The code is pushed to `dev`. All seven jobs in the exact-candidate [full integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38064518478) pass ([job results](performance-evidence/ci-2b269e3.json)), including every browser journey and the previously failing mixed-use smoke. Node 24 passes 6,821 tests with one declared skip, plus all 14 separate allocation checks; Node 26 and both production builds pass. Installation recovery passes on Linux, macOS and Windows. The [Windows recovery report](performance-evidence/profile-recovery-38064518478-windows.json) passes all five persisted-settings/workspace checkpoints with normal browser shutdown and no forced termination (SHA-256 `be53a298038d88853ca24ecbab86ea42ccea12ccd8a7dbef4856b12a9cb1d31a`). This uses hosted SwiftShader and is not physical GPU evidence.

The patch fixes demonstrated import ownership failures. This successful run does not establish the cause of the earlier intermittent mixed-use timeout or complete S59 interaction/performance acceptance. The CSV header optimization is recorded separately above.

### Mixed-use timeout diagnosis - 10 October 2026

GPT-6 Luna's harness-only `3e87cc828950441768cb04427315a40a1f2106c5` adds named workspace/import phases and bounded, URL-redacted failure diagnostics. The original 30-second operation deadlines, polling and assertions remain unchanged. Diagnostics cannot replace the primary failure and have their own 1.5-second bound. Twenty-four focused tests pass, including the serialized browser callback contract and a stalled diagnostic request.

The isolated [hosted smoke run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38063609361) passes at that clean, unchanged revision: both warmup cycles and one measured cycle complete every workspace/import phase, archive failure/recovery, replay and camera recovery. The measured cycle takes 24.32 seconds. [Raw report](performance-evidence/mixed-use-smoke-38063609361.json), SHA-256 `bba884886942b6811a5ac13343d44604f8c5536287d8bc3919b0d3e2d9f55a9b`; [run metadata](performance-evidence/mixed-use-smoke-38063609361-run.json).

This does **not** identify or repair the timeout in full integration run `38062012141`; it records non-reproduction in an isolated hosted job. Ubuntu/Chrome uses SwiftShader. The short report correctly leaves stability pending; it is neither a 60-minute soak nor physical GPU evidence. A separate source audit found unowned asynchronous import file reads and stale preview text; that application fix requires its own regression tests and candidate validation.

### Windows fresh-viewer controls - 10 October 2026, 15:14-15:16 UTC

GPT-6 Luna's fixture-only `7e09988616e3242eef0b2349416e36b523243441` creates one fresh viewer for each selected control, preserving the 400-ms deadline and stopping on the first failed request. Copy mode separately times the wait/copy, pixel extraction and hashing. A bounded follow-up observation cannot convert failure into success. Five helper tests and 12 existing capture/diagnostic checks pass; syntax and targeted formatting pass.

All four downloaded reports identify UHD 620/ANGLE/D3D11 and Chrome 154, a 640x360 drawing buffer, normal 888x585 viewport, DPR 2, antialiasing and preservation enabled. Each reports complete fixture cleanup. Desktop foreground/occlusion remains externally unverified.

| Control               | Observations                                                    | Raw report                                                                                                         |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| globe-only / copy     | Three completed frame requests                                  | [JSON](performance-evidence/windows-wind-frame-delivery-globe-only-copy-7e09988-2026-10-10T15-14-49-910Z.json)     |
| globe-only / no-copy  | Three completed frame requests                                  | [JSON](performance-evidence/windows-wind-frame-delivery-globe-only-no-copy-7e09988-2026-10-10T15-14-36-081Z.json)  |
| paused-wind / copy    | Three completed frame requests                                  | [JSON](performance-evidence/windows-wind-frame-delivery-paused-wind-copy-7e09988-2026-10-10T15-16-18-682Z.json)    |
| paused-wind / no-copy | First frame request failed; no RAF delivered during 411 ms wait | [JSON](performance-evidence/windows-wind-frame-delivery-paused-wind-no-copy-7e09988-2026-10-10T15-15-34-029Z.json) |

The paused-wind/no-copy failure occurs without any preceding pixel copy, readback or hash in its fresh viewer. Copying is therefore not required to trigger this failure. The separate wind-copy run then completes three requests; that does not erase the failure or identify its browser/OS/compositor cause. No production rendering change, deadline increase, hardware soak pass or performance improvement follows from these controls. Globe-only omits both wind geometry and its generated imagery, so this is not a pure geometry comparison.

Report checksums:

- `windows-wind-frame-delivery-globe-only-copy-7e09988-2026-10-10T15-14-49-910Z.json`: `752e834200c7ac2e0eed96307003ba8f7b5daf8034bb5ee7ad0aa39418958ef0`.
- `windows-wind-frame-delivery-globe-only-no-copy-7e09988-2026-10-10T15-14-36-081Z.json`: `d850c25eebf6bdd39b4b779aee2e9f4935358b2363b1e31868e4cdee143667fe`.
- `windows-wind-frame-delivery-paused-wind-copy-7e09988-2026-10-10T15-16-18-682Z.json`: `4414fe3f0164d08f7deb2291eec28808c36f8ecb265d847350b70d49153941b0`.
- `windows-wind-frame-delivery-paused-wind-no-copy-7e09988-2026-10-10T15-15-34-029Z.json`: `d3b37fef0eed426275885ac4c4ed4d68a27f91064590ba724e87081032facd69`.

The exact `afe83bc` Windows installation-recovery [report](performance-evidence/profile-recovery-38062012141-windows.json) passes all five settings/workspace checkpoints with normal 312-437 ms shutdown and no forced termination. It is hosted SwiftShader evidence, not physical GPU evidence. SHA-256: `57db6f0b8ac384136650c5ba68d494d7728c46bf90892d2f060cf4e82a1c7f00`.

### Windows candidate capture correctness - 10 October 2026, 14:48 UTC

The clean frozen `47dbee47027e636e7d51e14c3a07f6e1134d7caf` checkout was served locally with matching build identity and exercised through the existing capture-matrix UI in the authorized Chrome profile. All 12 checks pass on Intel UHD 620 through ANGLE/D3D11, Chrome 154, with four MSAA samples. Both framebuffer-preservation settings pass idle, moving, portrait, resized, restored and destroy-pending cases. Fresh expected colour pixels, actual dimensions and listener cleanup are checked. [Downloaded report](performance-evidence/windows-capture-matrix-47dbee4.json), SHA-256 `84428d0e61ec5e7509e6a311fabf5393766d7525ad6f474ec8acbbdfadf48b0c`.

This updates the isolated S56 capture-correctness evidence to the civil tracking candidate. It does not exercise the full application, establish why earlier frame delivery stalled, compare performance or justify changing the preservation default. No rendering settings were changed for the deployed application.

The subsequent unchanged wind-reuse fixture on the same clean candidate **fails** at 14:50 UTC: a fresh capture returns no image before any comparison checks complete. That report does not identify the capture phase or whether the cause was missing frame delivery, cancellation or copying. The page reports uninterrupted visibility. [Report copied from the visible JSON output](performance-evidence/windows-wind-47dbee4-failure.json). This preserves the Windows wind acceptance failure despite the simpler capture-matrix pass; its cause remains unresolved.

### Windows frame-delivery control - 10 October 2026, 14:44 UTC

A fresh tab in the authorized Chrome profile completes the existing five-second WebGL control at older app/harness `a83dd7af30cb3b9a39095da0f081a1037725d2cd`. Chrome 154 on Windows reports Intel UHD 620 through ANGLE/D3D11. It delivers 301 native animation callbacks, with maximum frame gap 19.4 ms, and reports no context loss or visibility/focus changes. Renderer metadata is read after the observation window.

[Downloaded raw report](performance-evidence/windows-webgl-control-20261010-144414.json), SHA-256 `f0fe8c29d294d49396805c2127c8f30c5fc13e9b0c5fa6a4edcf7aaac897a3f9`. This is a current scheduling control only: the diagnostic build is older than the candidate, the canvas is about 90% inside the viewport, desktop occlusion is not verified, and there is no full application workload, framebuffer validation or retained-heap measurement. It does not erase earlier failed controls, establish their cause, or qualify the candidate for performance or soak acceptance.

### Civil candidate integration checks - 10 October 2026

The exact `47dbee4` [integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38060811748) fails ([job results](performance-evidence/ci-47dbee4.json)); five other jobs pass, including the complete browser journey gate. Node 24 and 26 reject an obsolete source-text assertion in `src/data/trackedReadout.test.mjs`, which expects the former single-argument trail fallback. The fix preserves the required model-anchor-first behavior and checks the new explicit timestamp argument. Focused civil/military/readout tests pass; the corrected full suite must pass before integration acceptance.

Its Windows installation recovery passes all five settings/workspace checkpoints, with normal browser shutdown and no forced termination. [Recovery report](performance-evidence/profile-recovery-38060811748-windows.json), SHA-256 `ef668982856bbfeaae73aaa3aabc925c77630cc2ea2d19dfe73ed57a3fc66817`. This uses hosted SwiftShader and does not validate the physical Windows GPU.

### S55 military tracked-time ownership - 10 October 2026

GPT-6 Luna's `afe83bc3584e0ef276fe10c7446c568a98ec4d22` extends the owned timestamp to military tracking, retaining its 15-second delay and model-owned trail endpoint. Both callback orders now agree at the history boundary. Invalid frame numbers remain fresh, cache-only observers preserve the already-rendered pose, untracked queries remain independent, and target resets clear ownership. The focused source-text assertion now accepts the explicit timestamp fallback while still requiring the model anchor first.

The root's [independent comparison](performance-evidence/military-tracked-time-comparison-afe83bc.json) uses exact production factories from baseline `df9c3ab` and candidate `afe83bc`. Five repetitions each have identical fixed-trajectory output hashes across 124 frames. Clock reads fall from 372 to 248 with a fresh untracked sample interleaved in every frame. Separate boundary diagnostics reproduce and fix callback-order disagreement; the synthetic ~94-m offset represents an intentionally injected one-second clock jump, not a measured live-aircraft jump. No frame-time or GPU improvement is claimed. Report SHA-256: `f0ae15a9f8d30f9bcb4d868e84353f3d0f8d500d6b5fd7014c3a37badf198aba`; [comparison harness](performance-evidence/military-tracked-time-comparison.mjs) SHA-256: `0d40fd6ef2d05fa06bcba5440f1e69be583f3b77764c0e01d759ec1510aa31ed`.

Thirty-four civil/military/readout tests, formatting and package boundaries pass. [Full integration](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38062012141) completes with six passing jobs and one failure ([job results](performance-evidence/ci-afe83bc.json)). Node 24 and 26 each pass 6,803 tests with one declared skip; the additional 14 Node 24 allocation checks and both production builds pass. All three OS installation-recovery jobs and Windows onboarding pass. The browser job fails its mixed-use smoke during the second workspace/import cycle with a 30-second wait timeout ([failure JSON from the job log](performance-evidence/mixed-use-smoke-38062012141-failure.json)); its other journeys pass. This remains an integration failure until diagnosed. [Hosted tracking](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38062025493) passes 109 checks with zero failures/skips and normal 792-ms browser shutdown ([raw output](performance-evidence/tracking-38062025493.log), [job results](performance-evidence/tracking-38062025493-run.json)). A separate local full-suite attempt was stopped because its parallel processes exhausted available Windows memory and disrupted Chrome; it is not a pass. Hardware controls run separately from that load.

### Windows wind frame attribution - 10 October 2026, 15:02 UTC

Fixture-only instrumentation `7b59d286b22b78ac694cd064b0c47889f89179f3` leaves production code and the 400-ms deadline unchanged. On Windows UHD 620, the constructed speed image captures successfully in 4.3 ms. The second (control) capture receives no preUpdate, preRender or postRender event during 403 ms. A separate one-second post-failure observation records 50 timer ticks but only three animation frames, the first after 564 ms. No render error, context-loss event or page lifecycle event is recorded; the page reports visible/focused and a fully visible canvas. [Visible JSON report](performance-evidence/windows-wind-diagnostic-7b59d28.json).

This attributes the failed attempt to absent frame delivery, not a thrown pixel-copy error. It does not establish why browser animation frames stall, or rule out effects of the previous copy/readback, compositor scheduling or desktop occlusion. Windows wind equivalence and the 60-minute hardware soak remain unaccepted.

### S55 civil tracked-time ownership - 10 October 2026

GPT-6 Luna's `47dbee47027e636e7d51e14c3a07f6e1134d7caf` gives the civil aircraft pose and trail warmup decision the same delayed render-time sample. The sample has dedicated storage, so an intervening fleet query cannot overwrite it. Cache-only trail, label and model readers retain the already-rendered pose across Cesium frame-number transitions. Missing frame numbers no longer create a permanent `-1` pose cache; a synchronous trail callback passes its sample explicitly. Target reset clears time ownership. Untracked queries continue sampling fresh time.

The synthetic boundary control feeds both revisions the same 29.5/30.5-second sequence. Previously the trail could declare warmup complete while still showing the earlier pose; the candidate evaluates that pose and trail consistently. The resulting synthetic distance difference is not an observed live-aircraft jump.

Root's independent comparison loads exact baseline `2bd3d12e37c6113510e1b8b4b4f4cf00496ff808` and candidate production modules. Five 124-frame fixed-input trajectories have identical position, course, trail and focus-output hashes. Including one intervening untracked query per frame, clock samples fall from 372 to 248 per repetition. These are deterministic output/count checks, not CPU latency or GPU measurements. Root's 49 focused flight/motion/ownership tests pass; Luna also passed formatting and package boundaries.

[Comparison report](performance-evidence/tracked-time-comparison-47dbee4.json), SHA-256 `cf07852998c07e48322a1daa8d22dd4478f813231ea2cabddd1b2291b3dfbdbf`. [Exact-source comparison harness](performance-evidence/tracked-time-comparison.mjs), SHA-256 `ff2d969c6bbc0a8fb316d0225b9cb72183e2ced0ac2a283ae60e1648d49eed91`; fixture script SHA-256 `1de2ce20670af80935c419c3d18f26a3af46877f7fe10fecb8630910c8a0a603`. Reproduce from this candidate with locked dependencies: `node docs/performance-evidence/tracked-time-comparison.mjs 47dbee47027e636e7d51e14c3a07f6e1134d7caf`. The harness validates candidate source, unchanged dependencies, output hashes and the removed sample count.

The existing hosted tracking runner needed its synchronous Puppeteer executable-path lookup corrected. Harness commit `2bd3d12` also uses bounded owned-browser cleanup and a 15-minute hosted job. Its [baseline run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38059786291) passes 109 checks, with zero failures/skips and normal 632-ms browser shutdown. [Raw output](performance-evidence/tracking-38059786291.log), SHA-256 `917c4533d20f82c3b5ca5f0bee50686fceae5328d77c5cd375e64659f78bdede`; [job results](performance-evidence/tracking-38059786291-run.json). The [candidate run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38060567798) also passes all 109 checks, zero failures/skips, with normal 695-ms shutdown. [Candidate raw output](performance-evidence/tracking-38060567798.log), SHA-256 `bbc0bf8300b5e21db1d75784cd2670352c1e1d7c983daed9bd9ec807a8adb9bf`; [candidate job results](performance-evidence/tracking-38060567798-run.json). This uses hosted software rendering and bundled imagery, not the physical Windows GPU. Military time ownership is delivered in the subsequent packet below; measured tracking p95 and the full S55 acceptance contract remain pending.

### S59 single-feature normalization - 10 October 2026

Windows installation/profile recovery also passes at the exact `42d4be6`
candidate: all five prior-install, interrupted-update, rollback, upgrade and
failed-verification checkpoints preserve the saved workspace. Chrome
152.0.7977.75 on hosted Windows 10.0.26100 uses SwiftShader WebGL-only; the source
is clean and unchanged. All five browser closes finish normally in 296-2,619 ms,
without forced process termination. This is recovery evidence, not hardware
rendering or a permanent explanation of the historical shutdown failures.
[Retained report](performance-evidence/profile-recovery-38056869115-windows.json)
SHA-256: `6bb310e68f15b219a31e8716462d8c4d348a1d51681bd892801d486938b79922`.

GPT-6 Luna's `42d4be66e26e2bb2223aec8506c1b34643367526` removes the importer's
per-feature stringify/UTF-8/decode round trip. Imports and the synchronous pack
decoder now share strict geometry validation. Large geometry yields at small
coordinate checkpoints through the existing four-ms consumer, and validated
bounds/time summaries avoid a second full traversal. The initial normalization
wake is owned by that consumer and cancels immediately on abort. Existing ID,
coordinate, altitude, ring, aggregate-limit, timestamp and rejection rules remain.

Root's import/pack review passes 39 tests and the production build; Luna's final
focused suite passes 29 tests after the additional scheduler failure-path check.
Formatting and package boundaries pass. The commit is on remote `dev`; its
[full integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38056869115)
passes all seven jobs. Optional diagnostic jobs remain skipped, not passed.

Root independently ran the retained comparison harness in a clean detached
worktree at that exact candidate, against
`c7785169cb1d05dec2b133ade87c624db84eabed`. Each workload has five alternating
baseline/candidate pairs with equal output hashes and the expected accepted
population. This is Node 24.16.0 on Windows 10, Intel i7-8665U; it measures local
import completion, without a browser, GPU or forced GC.

| Valid workload                           | Baseline median | Candidate median |
| ---------------------------------------- | --------------- | ---------------- |
| One 40,000-position line                 | 65.97 ms        | 43.79 ms         |
| One 30,000-position polygon with a hole  | 56.49 ms        | 31.03 ms         |
| 10,000 point features                    | 423.19 ms       | 99.29 ms         |
| Synchronous 40,000-position pack decoder | 12.59 ms        | 12.48 ms         |

All five candidate queued-cancellation trials reject with `AbortError`; every
baseline trial completes before its queued abort runs. Candidate settlement after
the abort task is observed is 0.11-0.50 ms. Total cancellation time is 11.86-68.00 ms,
including synchronous decoding/parsing and scheduling; those costs remain visible.
The four-ms setting is a batch target, not a measured maximum in this report.
This packet does not establish browser interaction percentiles, rendering gains,
or completion of all S59 work.

The [reproduced report](performance-evidence/s59-42d4be6-reproduced.json) and
[exact executed harness](performance-evidence/s59-42d4be6-reproduction.mjs) are
retained. Run the harness with the clean measured candidate as the working
directory; it extracts baseline importer, geometry decoder and scheduler copies
from Git and removes only its own temporary files. Report SHA-256:
`8078d6cf92611df04334e6451a930795eba2c218d408737eecfc2ac2b2e5db5f`;
harness SHA-256: `c8007f2540fd50f9918b3783fdd48e8900516b0eece74576e2d71f55630b6450`.

Luna's earlier [raw observation](performance-evidence/s59-42d4be6-original.json)
and [metadata correction](performance-evidence/s59-42d4be6.json) remain supporting
evidence. That original report mislabeled Git blob IDs as SHA-256; the correction
preserves every timing row and supplies checked source-byte digests. Its inline
measurement script was not retained, so the independently reproduced report above
is the reproducible acceptance evidence. Earlier exploratory polygon measurements
used a rejected fixture and are not accepted performance results.

### CCTV terrain-query cancellation - 10 October 2026

GPT-6 Luna's `a0e7b10c1d2128de1544b53154c5bdb9e59a54a5` connects both catalog
height-prior queries and active-camera footprint queries to the existing
per-initialization abort signal. Destroy or reinitialization now cancels that
consumer's pending terrain work. Normal cancellation does not emit a provider
failure warning. Existing pose/revision/record-identity guards still reject late
results from a provider that ignores abort; shared caches and workers are not
terminated.

The [recorded baseline reproduction summary](performance-evidence/cctv-terrain-abort-baseline-0467781.txt)
identifies missing signals at `0467781`; it is a condensed account, not a raw
browser trace. The production-factory tests exercise public camera activation,
one synchronous ray-pick attempt, terrain request/listener cleanup, successor
isolation and successful current geometry updates. They also verify an equal
cached pose starts no redundant terrain lookup. This does not measure real GPU
ray-picking latency or prove every terrain/picking ownership path is complete.

The 55 focused CCTV checks and 28 terrain service/proxy/ground checks pass;
the 16-test source suite was rerun after making its failure wait bounded.
Formatting and diff checks pass. Full integration [passes all seven jobs](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38059557392) at this exact terrain commit, separately from the earlier `db298d4` evidence.

Its [Windows recovery run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38059557392) passes all five saved-workspace checkpoints at the exact `a0e7b10` candidate. Chrome 152.0.7977.75 uses hosted SwiftShader WebGL-only; all five browser closes finish normally in 349-417 ms, without forced termination. [Raw recovery report](performance-evidence/profile-recovery-38059557392-windows.json), SHA-256 `78f2c8222d53792f13ab3da8781ac3ef7b334d14cf5e84df956d8442e6660607`. This is installation recovery evidence, not physical GPU or heap-plateau acceptance.

### CCTV equivalent-style reuse - 10 October 2026

GPT-6 Luna's `db298d42a52d9f0c491a51f78ca060dbaa8a0461` avoids assigning
semantically unchanged material, depth-fail material and width values. Cesium
otherwise wraps those raw assignments in new property objects and invalidates
static polyline geometry. Actual style changes, dynamic properties and custom
dash parameters still receive the original replacement behavior. Viewshed
lifetime, geometry, camera ownership and visual defaults are unchanged.

All 52 focused CCTV tests pass. Root's independent comparison loads exact
baseline/candidate production code into real Cesium entities and geometry
updaters. Eight style states have identical evaluated output hashes. Five
unchanged repetitions per state drop from 10 or 15 geometry-change events per
refresh to zero. This is an event-count/style-equivalence comparison, not a frame
time or GPU measurement. [Report](performance-evidence/cctv-style-comparison-db298d4.json)
SHA-256: `b2bc03fd4a10cbc0d32692d23eb77e12cf1e2b4f62a0e5f069d2799cbcb70ba0`.
[Reproduction script](performance-evidence/cctv-style-comparison.mjs) SHA-256:
`1b264212caec197ee2817f798b094b5348764cdc2acfc48233975f9ebf150634`.
Run from a clean checkout at that candidate with locked dependencies:
`node docs/performance-evidence/cctv-style-comparison.mjs db298d42a52d9f0c491a51f78ca060dbaa8a0461`.

The corrected [rendered baseline](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38057968927)
at `c19f3271cce3655b10ff1d1abaf3acf288a762ef` fails on its first unchanged
toggle: active `createGeometry` submissions rise from 10 to 14. Using the same
harness and synthetic fixture, the [candidate run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38058198587)
**passes** all five toggles with active geometry submissions fixed at 10 and all
worker submissions fixed at their warmed value of 89. All pending counts are
zero. Enabled/disabled resources return to 6/5 listeners, 2/0 timers, one owned
primitive, six owned scene entities and two cache entries. Direct module
teardown/reinitialization legitimately builds new geometry, then returns to the
same owned-resource counts. The owned browser closes normally in 94 ms.

Both runs use Linux SwiftShader, Chrome 152.0.7977.75, Cesium 1.138.0, a
1440-by-1000 drawing buffer and the same fixture digest. Cold terrain-worker
totals differ, so no cross-run activation-time comparison is claimed. This closes
the isolated unchanged-CCTV-toggle reproduction, not every historical retained
worker path or the Windows hardware/heap plateau gate. Full integration at the
runtime candidate [passes all seven jobs](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38058220331), including Node 24/26, Windows onboarding, all three platform recovery jobs and the browser journeys. Optional diagnostic jobs were skipped. [Exact job results](performance-evidence/ci-db298d4.json).

Its [Windows recovery report](performance-evidence/profile-recovery-38058220331-windows.json)
passes all five persisted-workspace checkpoints. Browser shutdown completes
normally in 296-472 ms without forced termination; this remains hosted
SwiftShader recovery evidence. Report SHA-256:
`c0ad5a4133cc9c8b12b41bd39b549c5150e0df7916443af0dbb8a8f33b5e8df5`.

Retained [baseline report](performance-evidence/cctv-lifecycle-38057968927.json)
SHA-256: `5e5d166c0ed64041e5b6d3dc8feca02a711b453d4a0e338d1f55965c44627de5`;
[candidate report](performance-evidence/cctv-lifecycle-38058198587.json) SHA-256:
`39c639ffb3b8629b112be517f379528e9afd7847142d3262deb3f4a5738da470`.
Their [baseline job results](performance-evidence/cctv-lifecycle-38057968927-run.json)
and [candidate job results](performance-evidence/cctv-lifecycle-38058198587-run.json)
preserve exact revisions and outcomes.

### Rendered CCTV drain correction - 10 October 2026

The follow-up harness at `2cc8eb8` correctly suppresses the startup flight,
checks the real camera pose, and moves reuse validation ahead of each cycle's
pass label. Its [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38057708256)
still **fails** the original ten-second warmup drain. The final observed pose
matches the fixture, the camera is in view, and application/worker pending counts
are zero. The harness's ten-render-sample requirement and 500-ms maximum sample
gap inadvertently impose a rendering-speed gate on the software renderer.
The report lacks a full drain history, so this run cannot establish how long
its final zero-pending state remained stable.

`c19f327` removes that throughput assumption: unchanged cumulative counters must
span at least one second and three distinct completed-frame samples within the
same ten-second deadline. Any new worker activity restarts that window. Bounded
sample history survives all failure paths, including protocol deadlines. All
15 focused harness tests pass, including slow native frames, delayed completed
work and preservation of failure observations. No viewport, visual settings,
source population or application timing is relaxed. Rendered acceptance remains
pending the corrected baseline and separate runtime comparison.

The [failed raw report](performance-evidence/cctv-lifecycle-38057708256.json) and
[job summary](performance-evidence/cctv-lifecycle-38057708256-run.json) remain
unchanged. Raw SHA-256:
`2a008e37424c702d345d1fe8a72e4356457abe37952125d667e855cad0c4b2e7`.

### Rendered CCTV isolation: first failed check - 10 October 2026

GPT-6 Luna's `dfec9b1` adds an isolated CCTV lifecycle runner, enabled by
`a4a5cd2ea2cd7d0db8166538b1092a2ffa8dd270`. The
[hosted run 38056072642](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38056072642)
**fails** at that exact application/harness revision. Its five toggle cycles and
disabled direct-module reinitialization execute, but execution alone does not
satisfy the final validator. The ten local harness tests pass; they did not
reproduce the two integration problems exposed by the rendered run.

The startup Austin flight changes the configured camera pose, leaving the fixture
camera outside the recorded view rectangle. The existing startup path only skips
that flight when a share state is present. The next harness correction must use
the supported share-state startup path and verify the actual pose. A single
zero-pending worker snapshot also precedes later geometry-combination work, so
warmup needs a bounded stable interval across native renders.

Active `createGeometry` submissions increase from 8 after warmup to 12, 16, 20,
24 and 28 after successive unchanged enables. Equivalent enabled/disabled
ownership counts remain at 6/5 listeners, 2/0 timers, zero pending application
jobs, one owned primitive, six owned scene entities and two cache entries.
Repeated style-property replacement is under investigation; these observations
do not yet establish the cause of every worker submission or the historical
retention failure. No geometry-reuse or stability acceptance is claimed.

The fixture serves two catalog, three health and four image responses, with
fixed synthetic bytes. Worker/network preflight passes and the owned browser
closes normally in 92.3 ms. Rendering is Linux SwiftShader, not Windows hardware.
The [raw failed report](performance-evidence/cctv-lifecycle-38056072642.json) and
[job results](performance-evidence/cctv-lifecycle-38056072642-run.json) are retained.
Raw SHA-256: `b5e5382c6c385d928c1282f43d802082e639f5d75db5302ec98258be68706c95`.

### Durable Windows shutdown observation - 10 October 2026

GPT-6 Luna's `ee3bb72b6fcec3d7e0f7eb620c3530bacc6e02e1` replaces the outgoing
document's exposed-function callback with an empty, same-origin `sendBeacon`
received by the owned fixture server. Only six registered tokens are retained;
request bodies, body-read time, observations and cleanup are bounded. Receipt
time is checked against the original one-second deadline. Late observations
remain supplemental evidence and cannot change a failed result to a pass.
The version-2 report calls the treatment **navigation-first**, and records the
pagehide event's `persisted` state without claiming resource destruction.

The [Windows diagnostic 38054242558](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38054242558)
passes all six controls at that exact source/harness commit. Normal and
navigation-first blank, WebGL 2 and minimal Cesium documents close without forced
termination; parent-process close times are 482-1,138 ms, within the unchanged
five-second limit. The three navigation beacons arrive in 11.4-79.9 ms. Blank and
WebGL report `persisted: true`; Cesium reports `persisted: false`. Chrome
152.0.7977.75 uses SwiftShader on Windows Server 2025, Node 24.14.0 and Cesium
1.138.0. This accepts the isolated observation packet; it neither reproduces nor
fixes the earlier full-application shutdown stall, and is not hardware evidence.

The [raw report](performance-evidence/browser-shutdown-38054242558.json) and
[job results](performance-evidence/browser-shutdown-38054242558-run.json) retain
the exact identity and cleanup evidence. Raw SHA-256:
`7cfe0c69dc40aff8ad6446af1a0df7f765ff63588fb4b132cde0d2291a7da2ff`.
Root's combined shutdown/recovery review passes 40 focused tests; Luna's final
shutdown suite passes 21 checks, with syntax, formatting and package boundaries
passing. The earlier version-1 failure remains unchanged below. The next packet
is rendered CCTV lifecycle isolation, with warmed ownership and geometry-reuse
checks; terrain, picking and the Windows 60-minute plateau remain outstanding.

### S49 CCTV lifecycle ownership - 10 October 2026

GPT-6 Luna's `f2e5ae9` fixes a reproduced direct-destroy focus-listener leak and
releases the retiring viewer's billboards, camera/click listeners, projection,
coverage, sprite registration and transient adjustment state during reinit.
Final destruction uses the stored resource owner even if a caller supplies a
different viewer. Ordinary display preferences and existing UI subscriptions
survive reinit. Late catalog/health completions cannot publish into the successor
viewer; aborted health requests no longer announce the successor's camera.
The existing eight-second ground-prior fallback keeps its deadline, but its
timer and abort listener are now released after completion, timeout or abort.

The production layer factory is exercised with repeated/idempotent destruction,
independent focus subscriptions, two viewer owners, held catalog and health
responses, preserved settings/subscribers, and wrong-viewer teardown. Root's
review runs 141 focused CCTV tests successfully, covering geometry reuse, health,
cards, gizmos, source behavior and lifecycle cleanup. Formatting, package
boundaries and diff checks pass. These are Node ownership regressions, not a
rendered soak or visual-equivalence result. The normal layer manager disables
before destroying an enabled layer, which already releases the focus listener;
this defect is not established as the historical Windows soak's root cause.
Rendered CCTV, terrain and picking isolation and the Windows plateau remain open.

The [full integration run 38053750181](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38053750181)
passes all seven required jobs at `f2e5ae9f2f5ec56404e6372e610370eb9be007de`:
Node 24/26, Windows onboarding, the full browser journeys and recovery on all
three operating systems. The [Windows recovery report](performance-evidence/profile-recovery-38053750181-windows.json),
extracted from the delimited CI log JSON, preserves settings, the workspace and
the asset in all five checkpoints. Its five Chrome parent-process closes take
287-519 ms without forced termination. The observed renderer is SwiftShader;
this is automatic recovery evidence, not physical GPU validation or a proven
fix for the older intermittent shutdown failure. Raw report SHA-256:
`c10402658b684d614dd8ecabfb617f24bd52048c8b589a2229e4d3b463648e44`.

### Integration and isolated Windows shutdown - 10 October 2026

The full [integration run 38051924445](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38051924445)
passes all seven required jobs at `7b92db45d56e3b171f3d65482166fe725a6791bd`:
Node 24/26 unit/build gates, Windows onboarding, the complete browser journeys,
and Windows/Linux/macOS recovery. No required job or failed step is counted as
a pass. The [Windows recovery report](performance-evidence/profile-recovery-38051924445-windows.json)
was extracted from the delimited JSON in CI logs. All five prior-install,
interrupted-update, rollback, upgrade and failed-verification checkpoints retain
the workspace, settings and asset. Chrome 152.0.7977.75 uses observed SwiftShader
on Windows Server 2025; its five browser closes take 324-496 ms without forced
termination. This is installation/recovery evidence, not physical GPU acceptance.
The report's SHA-256 is
`64b7c7c427d3937f3b45565cfe1d14131c857d3ea77a358ce94dbfecf5004299`.

GPT-6 Luna's bounded shutdown controls (`045abd7`, hardened at `c2f3625`) run
blank, WebGL 2 and minimal Cesium documents, each with normal close and an
unload-first treatment. Six fresh profiles share the pinned Chrome and installed
Cesium build; exact commits, asset hashes, actual renderer, protocol close and
parent-process exit are recorded. Descendant process observation is explicitly
unavailable. Eighteen diagnostic tests and twenty existing recovery tests pass;
the five-second close deadline remains unchanged.

The [hosted diagnostic 38052625232](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38052625232)
at `c2f3625e3fa4a62f0f29d3178dbcba68d456c13d` **fails** its unload-observation
requirement. All six parent processes close normally in 441-517 ms, with protocol
acknowledgement and no forced termination. The three normal-close controls pass.
The three unload-first controls complete navigation to `about:blank` but report
no observed outgoing-document `pagehide`; they remain failed. The exposed-function
notification may be lost across document replacement, but that hypothesis needs
a durable observation control before acceptance. No unchanged retry or timeout
increase is justified. [Raw report](performance-evidence/browser-shutdown-38052625232.json)
and [job results](performance-evidence/browser-shutdown-38052625232-run.json)
preserve the result. It neither reproduces nor fixes the historical parent-process
stall, and it does not exercise the full application or the Windows GPU soak.

### Local S51 integration diagnostics - 10 October 2026

The subsequent [integration run at `084a771`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38048418004)
fails Windows profile recovery at graceful browser shutdown. In the
`interrupted-update-retained-application` checkpoint, the asset digest, rendered
feature, settings and workspace bundle all match, and the owned page closes with
zero remaining pages. The browser process does not exit within the existing
five-second deadline and requires confirmed termination of its owned process
tree. The [retained raw Windows report](performance-evidence/profile-recovery-38048418004-windows.json)
preserves that failure. This checkpoint still runs prior application `6b896e2`,
before the candidate upgrade; it does not demonstrate a regression in the new
infrastructure rendering code. The earlier initial recovery checkpoint closes
normally in 641 ms. Shutdown remains unresolved; forced termination is cleanup,
not an acceptance pass.
The [completed job results](performance-evidence/ci-084a771.json) record six
passing jobs: both Node versions, the complete browser journeys, Windows
onboarding and Linux/macOS recovery. Windows recovery is the only failed job.

The bounded shutdown trace at `0940b57201b198734bf460f59ed81fe05f7d0c8d`
passes 20 combined ownership/fixture checks. Its [Windows-only diagnostic](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38049597539)
fails at the first prior-install checkpoint after successfully reopening the
workspace. Chrome acknowledges `Browser.close` in 18.0 ms and disconnects in
42.4 ms, with no protocol overflow or acknowledgement error. The OS browser
process remains alive beyond the unchanged five-second deadline and exits only
after confirmed forced cleanup (7.25 seconds after close began). This narrows the
stall to process shutdown after protocol acknowledgement; it does not establish
the underlying Chrome/GPU/profile cause or a fix. [Raw report](performance-evidence/profile-recovery-38049597539-windows.json)
and [job result](performance-evidence/profile-recovery-38049597539-run.json) retain
the failure. The trace stores only allowlisted milestones, no protocol payloads,
and activates only during close. The separate workflow mode uses the existing
free standard Windows recovery job; ordinary CI still runs all three OSes.

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

### Windows frame-delivery diagnostic - 10 October 2026

A fresh tab in the same authorized Chrome profile restored browser control after
the previously selected diagnostic tab could not be inspected. The existing
port-4176 fixture declares app/harness
`a83dd7af30cb3b9a39095da0f081a1037725d2cd`, not current `dev`. Its five-second
WebGL2 diagnostic at `2026-10-10T12:07:45.799Z` completed with 301 frames,
maximum frame gap 17.4 ms and maximum 20 ms-heartbeat gap 22 ms. The reported
renderer is Intel UHD 620 through ANGLE/D3D11, Chrome 154 on Windows. Focus and
visibility remain true/visible; no context-loss event is recorded.

The canvas is 640 by 360 with antialiasing and drawing-buffer preservation;
about 90% of its CSS rectangle intersects the viewport. Desktop occlusion is
unavailable. This narrow scheduling observation is not a matched comparison,
fresh capture test, current-candidate performance result, or 60-minute retention
soak. It does not explain or erase older failures or the separate hosted Windows
browser-process shutdown failure. The unmodified downloaded [raw report](performance-evidence/windows-webgl-frame-a83dd7a-20261010T120745.json)
has SHA-256 `639f7892e4ad84d9711599bdbb5e1bed07f62e174ccbb12c153fd5b23ab790e9`.

### S49 cold-scene readiness boundary - 10 October 2026

GPT-6 Luna implemented `ef65fe189f8c40e2b452bccf6ba70aaec5213a8c`.
Before worker probes and import baselines, the runner now allows a separate
30-second cold-scene warmup. It requires loaded terrain, valid conserved worker
counters with no pending work/errors, an unchanged finite camera pose, and a
completed render followed by one second of stable observations. New terrain work
or camera changes reset readiness. An explicit `requestRender()` verifies an idle
scene without calling `render()` or changing rendering settings.

The startup observer samples every 100 ms, caps history at 302 samples and 64
workers, uses summary-only host polling, freezes terminal timing and releases its
timer, render listener and page-owned history before lifecycle measurement. Invalid
metrics, stalled renders and readiness deadlines fail. The existing ten-second
post-operation drain remains an independent acceptance gate.

Root independently passed 59 focused tests (51 lifecycle plus eight import
runtime/cooperative cases); syntax, targeted formatting, boundaries and diff
checks pass; the repository format check also passes across 1,445 adopted files.
The exact-commit [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38051341534)
completes all three runtime cases: five native imports, five workspace
replacements, and five controlled cancellation/supersession cycles. Cold scenes
settle in 19.8, 17.0 and 14.5 seconds respectively. Every observer is disposed;
all owned cleanup counts are zero. Browser shutdown completes normally in
86.6 ms without forced termination.

The overall report remains **failed**: the controlled case's returned row omits
the top-level worker checkpoint required by the final report validator. Its
baseline, final and cleanup snapshots contain valid zero-pending counters, but
that does not repair the emitted contract. The [raw report](performance-evidence/lifecycle-38051341534.json)
and [job result](performance-evidence/lifecycle-38051341534-run.json) retain this
failure. Correct the report assembly and test the actual generated case result
before rerunning. This is Linux software-rendered lifecycle evidence, not a
hardware performance or historical Windows retention acceptance result.

The report assembly is corrected at
`7b92db45d56e3b171f3d65482166fe725a6791bd`: the controlled case now supplies its
observed cumulative worker checkpoint, and the test assembles the final report
from the generated case result. Root repeats 51 passing lifecycle tests.
The changed [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38051679663)
**passes**, including final validation, in 134.3 seconds. All three cases complete
five cycles with zero pending workers at the final checkpoints. Readiness takes
21.9, 20.1 and 21.2 seconds; every startup observer is disposed. Controlled owner
cleanup reports no timers, held callbacks, render waiters, overlay entries or
context records, with the application import owner unchanged. Browser shutdown
completes in 76.4 ms without forced termination. The [raw report](performance-evidence/lifecycle-38051679663.json)
and [job result](performance-evidence/lifecycle-38051679663-run.json) identify
Chrome 152.0.7977.75 on the Linux software-rendered runner. This accepts the
bounded isolated lifecycle packet at that revision; S49's other reproductions
and the current Windows long-run plateau remain outstanding. The earlier failed
report remains unchanged. The reviewed code was pushed to remote `dev` at
`7b92db4`; its standard integration suite is tracked separately.

### S49 deterministic cancellation coverage - 10 October 2026

GPT-6 Luna implemented `fe97950f45f8279f660b6901efc8beb5eb7edbc8`.
The version-2 lifecycle runner requires three independently owned cases: five
native full-application import load/clear cycles, five workspace replacements,
and five controlled cancellation/supersession cycles. The controlled case uses
the real import-layer constructor with an instance-local batch clock and
scheduler; it proves that a continuation was queued before cancelling or
superseding it. Evidence timestamps retain their normal clock. It does not
replace the application's import owner or claim native timing measurements.

Completed renders, exact replacement identities, empty checkpoints, unchanged
application ownership, and disposal of timers, render listeners, context records
and overlay entries are required. Version-1 reports retain their original
two-case validation contract; version-2 reports cannot pass without the separate
controlled case. The original feature population and ten-second operation drain
limit remain unchanged.

Root independently passed 44 lifecycle tests and eight import runtime/cooperative
tests on Node 24.16.0. Syntax, targeted formatting, package boundaries and diff
checks pass. Review added a regression for the browser-serialized synchronous
render-waiter factory and unconditional context cleanup on disposal failure.
The code packet is implemented and unit validated. Browser execution remains
pending the separate cold-scene readiness correction; this does not establish
retention acceptance, hardware performance or completion of S49.

### S49 bounded worker-quiescence history - 10 October 2026

The follow-up drain-predicate trace is implemented at `7ab0d42`, with its
serialized failure callback corrected at `ff35e91`. All 36 focused tests pass.
The existing ten-second drain deadline and ownership assertions remain in force;
the trace retains bounded worker, import, frame, camera and terrain observations
from the actual predicate. Successful drains retain compact summaries, and
failed drains retain up to 202 samples with at most 64 worker records each.

The [changed diagnostic](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38049166697)
at `ff35e919849ece701bdd52f5463fd7f55d83393d` fails a different check after
60.1 seconds: queued supersession in cycle five. All 15 completed drains pass,
the warmup drain observes zero workers at 624.1 ms with terrain loaded, and all
five workspace replacements pass. Five measured loads, five cancellations and
four supersessions complete before failure. The available assertion does not
retain which supersession condition failed; a fast synchronous completion is a
hypothesis, not an established cause. This run does not reproduce or resolve the
earlier drain timeout. [Raw report](performance-evidence/lifecycle-38049166697.json)
and [job result](performance-evidence/lifecycle-38049166697-run.json) preserve the
failure. The browser closes normally in 55.5 ms without forced termination.

`32d725d` adds bounded supersession outcomes before assertions and clears stale
outcomes between attempts; 36 focused tests pass. Its [changed diagnostic](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38049907954)
fails earlier, at the initial empty checkpoint before any import operation. The
worker preflight observes 57 submissions and 57 completions with no pending
tasks, but the later initial checkpoint has six pending terrain tasks, each
under 400 ms old. Submissions have increased to 68. This exposes a startup
measurement boundary problem: momentary worker idleness is not proof that scene
streaming has settled. It is not evidence of abandoned import jobs. Workspace
replacement again passes five cycles; browser close takes 70.1 ms. [Raw report](performance-evidence/lifecycle-38049907954.json)
and [job result](performance-evidence/lifecycle-38049907954-run.json) remain
failed. A scene-readiness boundary and deterministic, separately scoped queue
tests are required before another lifecycle acceptance attempt.

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

This dated section retains the detailed work packets. The current
[acceptance amendment](CESIUM_ACCEPTANCE.md) supersedes its completion, experiment
closure and environment rules where they conflict. The ledger reports delivered
evidence; updating criteria does not mark code implemented or checks passed.
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
  the runtime change, and record the reviewed no-change disposition. A rejection closes that experiment,
  not unrelated deliverables in its parent slice. A supported no-change decision
  closes the named experiment without requiring an unbounded search for alternatives;
  mandatory behavior and applicable qualification remain required.
- **All done:** every packet has an accepted implementation or an evidenced
  no-change disposition, all required available-environment checks pass on the
  frozen candidate, documentation and deployment agree, and remaining unavailable
  coverage is explicitly reported. If a required available-machine check fails,
  report the failure; do not label the plan fully accepted. The 20% objective is
  reported separately as achieved or not achieved.

| Environment                                      | Work to execute                                                                                                                                          | What it cannot establish                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| User's Windows / Intel UHD 620                   | Primary foreground visual comparisons, five paired runs per workload, interaction checks, capture matrix, tracking journeys and 60-minute retention soak | Other GPUs or operating systems                                                      |
| VM105 / Linux                                    | Node 24/26 where supported, install/upgrade/rollback, application/API health, worker assets, deployment and persistence                                  | Windows rendering or GPU performance without a verified physical renderer            |
| Free standard GitHub Linux/Windows/macOS runners | Existing CI/recovery suites, bounded fixture jobs, software or verified hosted Metal visual/retention supplements                                        | Physical Mac or discrete Windows GPU coverage; software results are not GPU evidence |
| Unavailable discrete Windows GPU / physical Mac  | Keep original matrix entries unavailable and support claims unverified                                                                                   | These missing machines do not block independent implementation or pretend to pass    |

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
S54.1 is implemented at `89fb2fd`; S54 remains partial until an accepted
rendering disposition and its comparison evidence exist. The installed Cesium
`PointVisualizer` already uses the `EntityCluster` shared point collection, and
`GeometryVisualizer` already batches compatible static geometry. A direct
collection experiment must therefore measure removal of Entity/property update
work and construction allocations; it must not assume one draw call per Entity.
Preserve the existing ground sampling and camera-height stem behavior when
comparing representations.

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

The isolated S57.1 fixture candidate extends the existing terrain/picking lifecycle
route with five counterbalanced, warmed flat/relief switch pairs. It records
`setStack` completion separately from the unchanged stable-scene readiness wait,
and adds a witness from the existing `DataSourceDisplay.update` call bound to an
unchanged public `EntityCollection` revision and completed frame. It captures
active stack, provider load/cache/failure counters, local heightmap request
counts, worker counters, pending ownership and cache checkpoints before, at
activation completion and after readiness. Total switch-to-settled wall time
also includes the post-activation snapshot calls; stage times are not summed.
Streamed 3D tile memory remains
`null`: this deterministic fixture uses local single-tile imagery and a custom
heightmap provider. Run the existing `terrain-picking-lifecycle` hosted workflow
mode for rendered validation; do not interpret this component fixture as true
network/3D-tile streaming or hardware memory evidence.

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
- **S47 infrastructure capture selection implemented by GPT-6 Luna; rendered validation pending:** the build-smoke CLI and manual workflow now accept four explicit candidate capture workloads: bundled datacenters, dams, submarine cables, or all three together. The capture uses registered source hashes and actual build-receipt asset routes, acknowledges same-origin served bytes, fixes both wall and Cesium clocks, and records selected populations/settings before and after observation. Dense remains the default; unsupported modes and infrastructure/prewarm combinations fail before browser launch. The additional capture remains `comparisonEligible: false`; the ordinary baseline/candidate smoke pages still run their dense integration checks. Thirty-nine focused tests, full formatting, package-boundary/import-direction checks, and a local production build passed. The built hashed asset paths were resolved against their actual bytes and hashes without launching a browser. No hosted rendered comparison or hardware result exists for this extension. Austin operating workload and map-streaming workload selection remain unimplemented and are still required for the broader S47 workload scope.
- **S47 short weather/effects capture fixture implemented; hosted producer validation passes at `1e6f6f98`:** the opt-in `austin-weather-effects-v1` path serves pinned, byte-distinct 11:50/11:55/12:00 UTC radar, regional-cloud and lightning tiles plus a fixed GFS grid through exact same-origin routes. It selects the three history frames through the application timeline controls, holds `Date.now` and the Cesium clock at the 12:00 fixture epoch, records source observation times separately, starts native history playback, and checks the wind model/overlay/pause/loading state, visual parameters, camera and layer counts. The short smoke is explicitly comparison- and performance-ineligible; its two-second browser playback timers are not a deterministic five-run history benchmark. Full five-run 30/60-second weather/effects comparison, broader effects-state coverage and hardware acceptance remain outstanding. Austin operating and deterministic map-streaming workload capture also remain required. The first hosted run at `60b6a9b9` fails before weather sampling because a dynamically imported constructor was called as an unbound identifier. The correction qualifies constructor/clock calls and preserves early fixture identity; 60 root focused checks pass, with the producer-binding regression failing against the broken source. The later run at `1e6f6f98` passes all four weather captures and all seven standard jobs after interception/readiness corrections. Independent replay then identifies and fixes missing cleanup validation; ten corrupted reports are rejected and 76 focused checks pass. [Original failures, successful raw capture and correction evidence](performance-evidence/s47-weather-effects-capture/README.md) remain separate from pending matched comparison and hardware acceptance.
- **S47 deterministic map fixture build profile in progress:** M1 provides a
  bounded, hash-bound local terrain, imagery and 3D Tiles corpus with native
  parser checks. M2 adds the explicit `austin-map-streaming-v1` build profile
  and receipt/served-asset binding; the application capture path and rendered
  map-streaming acceptance remain pending. The named profile rejects Vite
  dotenv inputs because Vite reads them even when ignored by Git. This check
  applies only to receipts created and verified with the named profile; default
  and historical receipts do not retroactively attest that dotenv inputs were
  absent. No hosted capture or comparison acceptance is claimed.
- **S47 weather interception correction:** the first full weather packet at `60b6a9b9` passes all seven standard CI jobs, but its separate weather capture fails. Namespace repair `580cac11` then reaches source setup and exposes a real adapter mismatch: the shared interceptor provides `request.method()` while the fixture expects a string, and the observer incorrectly claims generic offline responses. The correction uses the actual accessor contract, excludes unrelated fulfillments, retains strict owned-route rejection, and owns abort/disposal across normal, failed and simultaneous readiness outcomes. Root passes 76 focused checks. Both failed browser reports are preserved; the replacement run and exact corrected-revision standard checks remain pending. No full slice or performance acceptance is claimed.
- **S47 infrastructure worker-audit coverage and outer-failure preservation implemented by GPT-6 Luna:** `5128691` and `d7f4840` originally encoded the dense fresh-document topology for infrastructure. This follow-up corrects that contract from the producer: infrastructure uses one measured app document for all four captures, while startup is separate; diagnostics are `startup-*` plus `main-setup`, worker audits are `startup-*` plus `main-measured`, and each sample carries the measured document role and ID. The canonical workload metadata now exports the selected fixture/workload identity to both the report and readiness check. The dense fresh `provider-sample-*` topology remains unchanged. The validator binds sample, diagnostic, worker-audit, and aggregate observation identities and rejects missing, split, or substituted documents; a startup document with no workers remains representable only when its observed worker counts are zero. If outer smoke validation rejects a completed `gev-performance-capture/v1` report, its redacted, depth/collection-bounded projection is retained only when it fits the existing 256 KiB artifact cap; oversized or unrecognized input remains unavailable with an explicit reason. Run `38190043475` remains failed; its retained diagnostic projection was depth-truncated and is not a complete raw report. The corrected producer/validator has not yet had a hosted rerun, so infrastructure rendered validation remains pending.
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
| ------------- | -------------: | ------------: | ------------------: | ----------------: |
| `4d90058`     |         50,000 |         4.106 |               0.169 |             5,000 |
| `4d90058`     |        250,000 |        19.130 |               0.135 |             5,000 |
| `5328e25`     |         50,000 |         4.306 |               0.176 |             5,000 |
| `5328e25`     |        250,000 |        15.546 |               0.084 |             5,000 |

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
tests exactly `3664f4f24eafe1e640aca01ecae281a38784b9c8` on Intel UHD 620 / Chrome 154. A settled isolated viewer renders zero frames in 10,002.6 ms; three scheduled
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

The 11 October follow-up census tests whether moving finite-distance rejection
ahead of screen/horizon checks has an opportunity in the existing fixtures.
Across 6,000 measured frames per profile, generic has 250 unbounded entries,
infrastructure has 320 finite-range entries, and all-live/radio has 515 finite
plus 349 unbounded entries per frame. None are rejected by distance or visibility.
Detection uses its custom path, so this projection metric is unavailable there.
These fixtures cannot establish a benefit for the proposed reorder; production
projection remains unchanged. S52 revision-based reuse is still outstanding.

The [raw census](performance-evidence/overlay-range-census-438245c.json)
records actual commit `438245c` and a non-clean worktree (the untracked diagnostic).
Root verified that both measured module blobs match `167ba62` and their recorded
byte hashes. The later [synthetic counter control](performance-evidence/overlay-range-control-438245c.json)
exercises the instrumented production projection path, verifies nonzero range,
viewport and safe-top rejection counters, and excludes unbounded offscreen entries
from the added finite-distance work count. It records the diagnostic harness hash.
These are Node/mock-Canvas counts, not timing or visual-equivalence evidence.
The utility is `scripts/performance/overlayRangeDiagnostic.mjs`; use a new output
path and append `--control-only` for the instrumentation check. Report SHA-256s
are `3fd87c0ee20a757049701047aee154e5b985c8ffb14901bd6857fa3c2d7d9465`
and `65d4b9e0f92b310cfcea18c140ef5e99fc4aa37c73882ccfbc5222391a95dc88`.

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

## S51 traffic render-demand comparison - 11 October 2026

The narrow traffic scheduler experiment now has five matching hosted A/B pairs at c73bbebb1f9be6579c42869ee0820bd8e5fa89d8 against e6ab561ad0e77a49219627e97573199f1db0af62. Enabled-empty traffic renders zero frames in each ten-second candidate observation, versus 254-302 in the baseline. Root independently checked 60 PNGs and recomputed every phase comparison and heatline control. Code and focused automatic validation are complete for this experiment; current-dev integration is still pending. Hosted Apple paravirtual Metal is supplemental evidence, not physical Windows coverage or full S51/S60 completion. See [raw evidence and limitations](performance-evidence/s51-traffic-render-demand/README.md).

### Current-dev traffic acceptance - 11 October 2026

The initial isolated result above is now supplemented by exact integration
candidate `bda6146d2c7f978e682421bd29a7c7f087b5a491` versus `4dfea32`.
Both sides include the same accepted camera-transform patch. All five traffic
pairs, all seven ordinary integration jobs and all 111 tracking checks pass.
The runtime traffic change is accepted; fleet scheduling remains excluded.
[Complete evidence and limits](performance-evidence/s51-traffic-current-dev/README.md)
retain separate code, automated and hosted/physical hardware status.

## S58 regional weather bitmap cleanup - 11 October 2026

The regional infrared provider now releases its displaced decoded bitmap after
copying it to the canvas returned to Cesium, including processing failures.
Raw imagery and late pass-through results retain their existing ownership.
Code is implemented at `f90e24f`; focused automatic validation and all seven
standard CI jobs pass at `e0a13cc6f7a6be11fa45e19bd911dc5b3022d7fa`.
The tests include 30 equivalent transfers, processed pixels, failure cleanup,
raw pass-through and orientation. All 15 hosted recovery records retain settings
and workspace contents and exit naturally within the existing shutdown deadline.

[Evidence and review scope](performance-evidence/s58-weather-image-ownership/README.md)
separate this accepted resource-release correction from unmeasured benefits.
Hardware validation, full weather/effect comparisons and the current-candidate
60-minute retained-memory plateau remain pending. This success does not establish
the cause of previous intermittent Windows browser shutdown failures.

## Historical main/weather integration gate - 11 October 2026

Candidate `260037cbe51cb187ec7ac1eca12fe9d10767269b` merges upstream main
`591f299` with the independently validated regional bitmap cleanup. Published
layer-token compatibility passes locally against both current fork/main and
fork/dev (29 existing assignments, no new tokens). The candidate is not on dev.

[CI run 38151528050](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38151528050)
failed two checks. Windows preserved the settings and workspace but its Chrome
parent exceeded the unchanged five-second shutdown deadline after acknowledging
close in 7.36 ms and disconnecting in 30.79 ms. Forced cleanup followed. The
browser journey failed its accessible-name snapshot for the SAVE QUERY button;
its portable-panel step passed. Five other standard jobs passed.
[Original failed evidence](performance-evidence/main-weather-38151528050/review.json)
remains failed. The browser shutdown cause is unresolved.

The accessibility fixture previously forced two panels open by changing CSS
classes, bypassing the disclosure owner's preferred-panel state. Source review
shows that automatic rail layout can collapse those surfaces. This is a plausible
cause of the missing AX node, but the old log did not retain ignored reasons.
The fixture now opens one surface at a time through its actual disclosure,
checks that it remains exposed, and requires Chrome's computed accessible name
instead of accepting a raw aria-labelledby ID. Failures retain AX and panel
state. Code is implemented; hosted validation remains pending. No production
panel behavior or browser-close deadline changed.

The subsequent corrected integration at `7ef32a74` and evidence-only dev push
at `26f383ed` both pass all seven standard jobs. They are now integrated on dev;
the candidate/pending statements above describe the earlier failed gate only.
[Current integration evidence](performance-evidence/main-weather-38152867100/README.md)
preserves both successful runs and the earlier failures separately.

## HUD ownership fix and S54 current-dev checks - 12 October 2026

The revision-owned HUD summary coalescing fix at
`bbca229f0077b8443db04395c106677684d2ef61` passes all seven standard jobs in
[run 38185865148](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38185865148).
Root fast-forwarded local and remote `dev` to that exact tested commit. The
focused HUD/voice suite passes 120 checks; five targeted baseline negative
controls fail for the expected ownership and duplicate-context assertions.
These tests establish cleanup and context-call behavior, not individual GPU
readback counts or a resolution of the Windows frame stall. The separate
automatic [push-triggered CI run 38187169259](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38187169259)
now also passes all seven standard jobs at the same revision.
The [saved CI response](performance-evidence/s54-current-dev-20261012/hud-ci-bbca229f.json)
preserves job and step outcomes; optional hardware/soak and PR-only published
layer-token checks were skipped.

S54 candidate `bc892f7cb491c823bb8d7503cd036e5320f5c690`, based on `acc471e4`,
remains isolated from dev and retains Entity defaults. Fresh dam and datacenter
correctness runs pass: root decoded 40 images and verified all 20 exact renderer
pairs, bundled payload hashes, native picks and warmed-baseline teardown.
The cable run fails in the existing Entity lifetime during the map-switch
readiness witness, before any collection sample. No page/interception errors
or external requests were observed. Its early readiness observations were not
retained, so the cause remains unresolved; the failed result is not retried
unchanged or converted to a pass.

[Raw results and scoped review](performance-evidence/s54-current-dev-20261012/README.md)
separate the successful component checks from the cable failure. A subsequent
diagnostic at `d05e5415` retains the failed readiness predicate: one hidden
GroundPolylinePrimitive stays unready while frames continue and data-source/globe
readiness remain true. The build/worker cause remains unresolved; no readiness
condition or deadline was relaxed.

The fresh [datacenter benefit run 38187703722](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38187703722)
passes at `d05e5415`. Five alternating latency pairs show a 28.63% reduction in
median time from source-ready to first usable frame, with all five pairs improving.
Five separate forced-GC pairs show 16.06% lower enabled JavaScript heap increase.
Root independently verified the report, 27 recorded Git source hashes and 40
decoded PNG/RGBA hashes (20 identical renderer pairs). Full raw evidence is linked
above. These hosted Apple paravirtual Metal measurements cover one component;
they do not establish motion p95, physical Windows performance or a retained-heap
plateau. Dam/cable benefit acceptance, full-application coverage and the final
soak remain pending. Entity defaults remain unchanged. The user-supplied Windows
GPU export establishes hardware acceleration only.

The [dam comparison 38188217630](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38188217630)
at `d05e5415` completes successfully as a measurement but fails benefit acceptance.
Median source-ready time increases 15.02% (four of five pairs slower), above the
10% regression limit; first usable time after source-ready increases 2.93%, with
one pair at +19.42%. Enabled post-GC JS heap increase falls 11.05%. Root verifies
all 27 recorded source hashes and 40 decoded images (20 exact renderer pairs).
The full artifact and failed acceptance are preserved alongside the datacenter
result. Dam adoption remains blocked on source-ready attribution and resolution
of the measured regression; lower heap does not convert it to a pass.

S47 infrastructure capture selection at `87fad3fd` passes 39 focused tests,
formatting and package boundaries after merging current dev. The first
[hosted smoke 38188605428](performance-evidence/s47-infrastructure-smoke-38188605428/README.md)
fails the additional candidate capture before any timing sample. The datacenter
population is correct, but the static fixture uses an existing advancing wall
clock adapter while requiring a frozen epoch. The failed report and source
attribution are preserved. The adapter requires correction; no timestamp check
is relaxed and no performance claim is made from this setup run.
