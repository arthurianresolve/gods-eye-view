# Imported point rendering: current-dev comparison

The same-source comparison at `eb2d6d95ab35bdbbf964eea305226cae763b8a48`
passes five fresh, alternating Entity/primitive-collection pairs in
[run 38159001839](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38159001839).
This base includes the accepted exact-Entity ownership fix `82e2b0b1` and the
current production timer scheduler and whole-feature coordinate preparation.
It does not import the rejected scheduler/chunking experiment.

The application integration in this change selects the collection renderer for
its existing asynchronous workspace-import path. The layer's default remains
Entity-compatible for other callers. Standard integration and collection-specific
lifecycle checks pass as recorded below; current-candidate soak review remains
pending before promotion to dev. The comparison alone does not complete S59/S60.

## Measured benefit

Each browser run contains five synchronous and five cooperative loads of the
same 5,000 points. Inner samples are summarized within each run before comparing
the five outer pairs; they are not treated as 50 independent trials.

| Pair | Order | Cooperative Entity median (ms) | Collection median (ms) | Change |
| --- | --- | ---: | ---: | ---: |
| 0 | Entity, collection | 217.8 | 55.9 | -74.3% |
| 1 | Collection, Entity | 138.4 | 71.8 | -48.1% |
| 2 | Entity, collection | 136.5 | 58.8 | -56.9% |
| 3 | Collection, Entity | 169.3 | 65.1 | -61.5% |
| 4 | Entity, collection | 156.8 | 68.9 | -56.1% |

Median paired changes are -56.9% for cooperative load time, -20.8% for synchronous
load time, and -96.4%/-95.9% for their respective synchronous clear-call costs.
Cold activation improves in all five pairs. After clear, the Entity visualizer
retains 5,000 reusable point slots with zero active entity owners; the owned
collection releases all its points. Equivalent checkpoints do not grow. These
are live resource counts, not retained-heap measurements or a leak diagnosis.

Capture waits are a limitation: synchronous median paired capture time increases
172.4%, with four of five outer pairs slower. Cooperative capture waits are
variable (two pairs slower, median change -4.3%). The capture operation includes
waiting for a completed frame; this experiment does not establish the reason
for those differences. It supports faster asynchronous import and clear work,
not faster captures or a full-scene frame-time claim. The application already
uses `loadAsync`; its scheduling, capture implementation and visual settings
are unchanged.

## Independent correctness review

Root decoded all 110 PNGs and recomputed their RGBA hashes: all 55 image pairs
are byte-identical. This covers ten dense captures and one mixed point/line/
polygon capture per outer pair. Each dense sample has nine natural imported
point hits with identical results between renderers. The grid overlaps, so a
pick can resolve to a nearer overlapping point rather than the targeted center.
The three separated mixed-geometry picks match their exact expected IDs.
Mixed geometry and native-pick JSON hashes were independently recomputed.
The complete 5,000-row state hashes match, but the bounded reports do not contain
all rows, so that full state cannot be independently reconstructed offline.

Every renderer run passes twelve capture-matrix checks and twelve cancelled
imports, ending with zero pending jobs, imported features and owned point
primitives. Metadata Entities retain IDs, styles, evidence and inspector
identity while only point rendering moves out of Cesium's general Entity
visualizer. Lines and polygons continue using the original Entity path.

## Environment and evidence

The runner reports Chrome 152 and verified Apple paravirtual Metal rendering.
The matched drawing buffer is 640 x 360, antialiasing is enabled, requested MSAA
is four, framebuffer preservation remains enabled and the camera is identical.
This is supplemental hosted evidence, not physical Windows GPU coverage.
No forced GC or GPU execution timing was used. Production cooperative batch
durations/wake timing are explicitly unavailable; no 4 ms batch result is inferred.

- [Full nested comparison](report.json) and `pair-*-*.json` retain raw results.
- [Independent review](independent-review.json) records hashes, image inventory
  and independently calculated paired metrics.
- [Review script](independent-review.mjs) decodes the images and checks raw hashes.
  Run it against a fresh copy of the evidence directory from a checkout with
  `sharp` installed; it refuses to overwrite an existing review JSON.
- `decoded-review/` retains the 110 original PNG witnesses.
- [Workflow record](ci-run.json) binds the completed job to the tested SHA.

Large-feature preparation, raw document decoding, full application motion
benchmarks, the primary physical Windows soak and full S47-S60 acceptance remain
outstanding. No available hosted report substitutes for those requirements.

## Initial integration observer failure

[Lifecycle run 38159771524](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38159771524)
fails at application integration `b67cca57b22743f03dacad36f9826279e93308ea`.
The initial 512-feature load completes with no pending jobs, but the completed-
render observer counts only `viewer.entities`, which contains none of the new
point metadata Entities. Its population predicate therefore never succeeds.
[Raw failure](lifecycle-38159771524-failed.json) and
[workflow record](lifecycle-38159771524-ci.json) preserve this failure.

A focused regression fails against that observer and passes after adding a
shared, bounded inventory of Entity-rendered features and native point owners.
The reader verifies point count, native ID/position agreement and uniqueness;
metadata alone, missing primitives, mismatched positions and duplicate owners
cannot satisfy the census. All 53 lifecycle tests pass, including browser-style
function serialization and the existing timeout/cleanup controls. The same
inventory supplies load, supersession and workspace checkpoints. Render and
drain deadlines are unchanged. A new hosted lifecycle run is still required;
these unit results do not relabel the failed run.

## Application integration and controlled renderer follow-up

[Standard CI 38159767176](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38159767176)
passes all seven executed jobs at application integration commit
`b67cca57b22743f03dacad36f9826279e93308ea`: Node 24/26 suites, builds,
formatting, package boundaries, Windows onboarding, three-platform recovery,
and all browser journeys. The three raw recovery reports and independent
`recovery-b67cca57-review.json` verify all fifteen saved-settings/workspace
checks, persisted asset hashes, zero unexpected pages and natural browser
shutdown. These are functional recovery results; they do not diagnose the
older Windows hardware/shutdown failures or establish hardware performance.

[Lifecycle 38160466990](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38160466990)
passes at observer fix `c3df3acc6ea3d61425329ce8d959ac7c908776d2`.
The application performs five collection-rendered import/clear cycles and
five workspace replacements. Its separate controlled cancellation/supersession
case still constructs an Entity renderer. The raw report is preserved and is
not evidence for collection cancellation/supersession in the full application.

The follow-up matches that controlled owner to the app's effective renderer,
records the representation in checkpoints, inventories both owners' native
points, and rejects renderer mismatch. Missing native ownership now rejects
and cleans up its completed-render waiter immediately. All 54 lifecycle tests
pass. Collection-specific hosted cancellation/supersession remains pending
until the corrected source is tested; deadlines and resource gates are unchanged.

## Collection renderer lifecycle observed

[Run 38161336726](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38161336726)
passes at `1a8d4928424f84349e4b9c6b411ce3f1b328459b`. Each native and
controlled checkpoint explicitly records `primitive-collection`. Five native
load/clear cycles, five workspace replacements, five observed queued
cancellations and five observed supersessions complete. The controlled owner
returns to zero imported features/pending jobs and the same scene census after
destruction: zero Entities, three data sources, one primitive and one ground
primitive. Root checked that cleanup census independently against the warmed
baseline. The browser exits normally in 67.75 ms, without forced termination.

Review identified that the validator did not yet enforce that final scene-census
comparison, although this raw run satisfies it. A focused negative control will
make an empty retained primitive fail the gate. This adds a missing assertion;
it does not erase earlier raw results or assert a production leak occurred.

The teardown comparison is enforced by `1595db4f`, with 54 focused checks and
all 1,538 scoped formatting checks passing. Root also revalidated the original
`1a8d4928` raw report with that validator, then injected one extra empty
primitive into a copy and confirmed rejection. This offline regression check
is distinct from a new browser run. The live driver retains its first warmed
empty census for teardown instead of replacing the baseline after each cycle.

## Frozen integration candidate

[Standard run 38161339152](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38161339152)
passes all seven executed jobs at `1a8d4928424f84349e4b9c6b411ce3f1b328459b`.
The retained `recovery-1a8d4928-{windows,macos,ubuntu}.json` reports and
[independent recovery review](recovery-1a8d4928-review.json) confirm all fifteen
stages: matching settings, workspace bundles and the saved asset hash, one
rendered feature, zero unexpected targets, no remaining pages before close,
and natural browser exit code zero. Close times range from 272.24 to 2354.18 ms.
These software-rendered recovery checks do not establish physical GPU coverage
or explain historical hardware failures.

[Lifecycle run 38162029677](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38162029677)
passes at frozen candidate `fca2f991f493de80e73ea4c086609f9a084e4ea3`.
Its [original artifact](lifecycle-38162029677.json) has SHA-256
`df36b5e120fb9312faf5b597ee397adc0baed3e32ee416ccbeabf1e6f92c3858`.
Root revalidated exact application/harness identity, fixture hashes, all three
collection-rendered cases, zero page errors and the controlled owner's teardown
against the first warmed baseline. The five import/clear cycles, five workspace
replacements, five queued cancellations and five supersessions pass; browser
shutdown takes 60.71 ms without forced termination. An offline copy containing
one extra cleanup primitive is rejected. This directly exercises the final
teardown assertion and does not relabel the older observer failure.

The 60-minute hosted soak of this frozen candidate completes 252 cycles in
[run 38162032244](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38162032244).
Its 40 application resource gauges remain unchanged and maximum retained-heap
growth over the final window is 1.183%. Its raw envelope omits browser cleanup,
so candidate ingestion correctly remains pending. The reporting handoff is fixed
at `7cea7aac`; a corrected run is in progress. [Original evidence and review](../hosted-soak-38162032244/README.md)
keep measurement results separate from acceptance and physical Windows coverage.


## Corrected retention gate

[Run 38167171204](../hosted-soak-38167171204/README.md) at `7cea7aac`
passes 252 cycles with 40 constant resource gauges, 13 post-GC checkpoints,
629 listeners and no pending worker tasks. Maximum final-window heap growth
is 1.937%. Both browser owners close naturally within one second. All seven
standard CI jobs pass at `806d4d3c`; later integration changes are documentation
and test registration only. The earlier incomplete report above remains
historical. This accepts the point collection integration, without asserting
physical Windows or full-scene performance acceptance.
