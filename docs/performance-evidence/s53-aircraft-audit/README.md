# S53 retained behavior and aircraft audit boundary

## Disposition

S53 engineering is closed by the [14 October root review](../closure-audit-20261013/s53-review.json); final physical qualification remains pending. Keep the current mixed point collection and satellite
scratch/write suppression. Reject the tested natural-bounds collection split;
do not override Cesium command bounds or claim GPU upload savings. The available
evidence does not justify an opaque-only or frequency-based replacement. The
aircraft snapshot path has stable billboard ownership and bounded absence
retention. The current-path snapshot and fleet-tick audits now measure bounded
producer behavior and attempted writes without claiming a before/after
optimization comparison; no prior aircraft optimization has been identified.

## Retained satellite behavior

The current satellite propagation path uses one scratch Cartesian and avoids
assigning an unchanged position. Core satellites propagate at the one-second
idle cadence (`POSITION_UPDATE_MS`) or 200 ms while tracking; dense satellites
advance by a bounded round-robin chunk with a 300-frame full-pass target
(`DENSE_REFRESH_FRAMES`). See `src/layers/satellites/rendering.js`,
`_propagateAll` and `_preRenderTick`, and `src/layers/satellites/catalog.js`,
`_propagateDenseChunk`.

A later S51 producer audit found that the one-second scheduler can starve this
per-frame dense budget when no continuous owner remains. That separate cadence regression is corrected in the S51 closure packet;
the mutation counts below do not themselves validate its wall-clock refresh rate. See the
[S51 owner audit](../s51-render-demand/owner-audit.md).

The retained mutation audit compares actual Cesium 1.138 point primitives at
840 core / 10 passes and 10,000 dense / 300 passes. For unchanged positions,
returned Cartesian objects fell from 8,400 to 1 (core) and 10,200 to 1 (dense),
with setter calls falling to zero. For moving positions, setter calls and
Cesium dirty notifications were unchanged. Final coordinate hashes matched in
all four cases. The report used no WebGL context; upload counts, uploaded bytes
and latency remain unavailable. See
[`s53-collection-audit`](../s53-collection-audit/README.md), report SHA-256
`62805e4cad664a180d34c3700376f2ecc362b10035784716020521cbaaff3017`, and the
source revisions recorded there (`510ed8d4` versus `75cf32fe`).

## Rejected collection split and opacity specialization

The mixed-versus-split image comparison is failed, not a candidate for relaxing
the visual gate. The split with natural bounds changes 24 pixels (maximum
channel difference 36); applying the original mixed collection's measured
bounds to the split restores exact pixels, and restoring natural split bounds
restores the difference. Positions, projected neighborhoods, OIT state,
resolution, MSAA and settings are held constant. This attributes the difference
to the command-bounds/fitted-frustum interaction in Cesium 1.138 for this
fixture, without claiming a GPU arithmetic defect. Retain the existing one
collection; private command-bound overrides are diagnostic controls only. See
[`s53-bounds-attribution`](../s53-bounds-attribution/README.md), diagnostic
commits `4d39fed` and `c5889ef`, runs `38107644255` and `38108076172`.

An opaque-only specialization is not supported by the current visual inputs:
satellite dense points use alpha 0.9, outlines use alpha 0.3, and focus updates
point alpha. See `src/layers/satellites/policy.js` (`POINT_STYLES`,
`POINT_OUTLINE`) and `src/layers/satellites/rendering.js`,
`_updatePointFocus`. Aircraft presentation is also not a static opaque class:
`src/data/aircraftRecession.js`, `applyAircraftBillboardTreatment`, composes
freshness/base alpha, focus and limb-relative alpha; both
`src/layers/flights/rendering.js` and `src/layers/military/rendering.js` call it
from `_fleetTick`. Model colors retain their existing `colorBlendAmount`
semantics (`applyAircraftModelTreatment`). An opaque-only split would therefore
need a separately specified and visually verified representation. No such
implementation or evidence exists, so do not add a specialization merely to
complete a conversion quota.

## Aircraft membership and write paths

`src/layers/flights/snapshotRenderer.js`, `createFlightSnapshotRenderer`, and
`src/layers/military/snapshotRenderer.js`, `createMilitarySnapshotRenderer`,
look up existing contacts in `_billboards`; they add a billboard only when that
identity is absent, then update the associated record. On absence they consult
`FlightRecords.absence` or `MilitaryFlightRecords.absence` before removal. The
records retain contacts across incomplete snapshots, mark stale contacts, and
admit removal after the configured complete-miss policy. Snapshot teardown also
releases models, histories, ground samples and related maps. Existing
`src/layers/flights/records.test.mjs` and
`src/layers/military/records.test.mjs` cover retention/removal semantics;
`src/layers/flights/snapshotRenderer.test.mjs` covers repeated-fix history, not
billboard identity/mutation counts. There is no
`src/layers/military/snapshotRenderer.test.mjs` today.

The bounded absolute mutation audit is available as
[`aircraftBillboardMutationAudit.mjs`](../../../scripts/performance/aircraftBillboardMutationAudit.mjs),
with a registered producer-path regression in
[`aircraftBillboardMutationAudit.test.mjs`](../../../scripts/performance/aircraftBillboardMutationAudit.test.mjs).
The [root review at `14d24ca3`](root-14d24ca3/README.md) retains the clean-source
report and eleven passing focused checks; it makes no fleet-tick or GPU claim.
Run it with
`node scripts/performance/aircraftBillboardMutationAudit.mjs`. The report
binds Cesium 1.138.0, the installed Cesium package and lockfile digests, the
Git commit plus clean/dirty status digest, and SHA-256 digests for the audit
implementation plus both snapshot renderers, record stores, and record
policies. Its fixture digest covers the complete contact fields, exact
snapshot records and sequence, completeness flags, fixed receipt clock,
collaborator assumptions and churn-control steps. The real record stores use
that fixed `Date.now`; the audit restores the original clock in a `finally`
path and tests both success and failure restoration. It feeds both real
snapshot renderers and record classes, backed by real Cesium
`BillboardCollection`/`Billboard` objects, with deterministic collaborators
and no WebGL context.

On this source, both producers add three billboards initially, preserve all
three object identities through an equivalent repeat and a changed-position
snapshot, retain them through a partial absence and two complete misses, and
remove them on the third complete miss. Reappearance creates a new identity.
Flights attempts three billboard color assignments on the equivalent repeat
and changed-position snapshots; military attempts none in those same stages.
Neither snapshot producer writes billboard positions in these scenarios;
rendering-tick position updates are outside this audit. A deliberate remove,
map-clear, and same-snapshot re-add control records three removals, three adds,
and a changed identity digest, proving the measurement detects ownership
churn. The actual collections are emptied and destroyed after each run;
instrumentation is confined to proxies around the audit's returned billboard
objects and does not patch Cesium prototypes.

`src/layers/flights/rendering.js` and `src/layers/military/rendering.js`,
`_fleetTick`, own the moving billboard position, horizon visibility, focus,
freshness, limb scale/alpha and model handoff. Position writes are gated by
actual movement thresholds; presentation is dynamically composed. The current
tests in `src/data/aircraftRecession.test.mjs` check near/far writes, alpha
composition and model blend semantics, but they are not a population-scale
membership or allocation measurement. Existing tracking ownership tests cover
layer ownership and selected transitions, not a paired aircraft collection
cost comparison.

## Fleet-tick producer audit

The separate bounded current-path audit (`gev-aircraft-fleet-tick-audit/v2`) at
[`aircraftFleetTickAudit.mjs`](../../../scripts/performance/aircraftFleetTickAudit.mjs)
calls the real `createRendering(...)._fleetTick()` for both flights and military.
Its fixture contains stationary and moving contacts, a tracked contact skipped by
the ambient pass, a records-only contact without a billboard, an opposite-side
horizon contact, a controlled focus-factor contact and a ready in-memory model
handoff. The records-only observation does not assert suppression policy.
The run uses real `FlightRecords`/`MilitaryFlightRecords`, a real Cesium 1.138
`Camera` and `BillboardCollection`, and proxy counters around the returned
billboards. Its hashed clock/input sequence calls a cold due tick, a call 40 ms
later that must skip the 80 ms cadence, the next due tick, an equivalent warmed
repeat, and a due tick after changing only the moving contact input. Each stage
records setter deltas and collection identity. The report also records the
number of distinct objects passed to the deterministic `_deadReckon`
collaborator; it does not attribute that count to production allocations. The
full fixture descriptor is hashed, and the report binds source/harness revision
and dirty status, input source hashes, package lock and installed Cesium
package. A same-cardinality remove/re-add control proves the identity/churn
counter detects a replacement.

This establishes only deterministic producer behavior for that bounded contact
set. It explicitly leaves general JS/Cesium allocation totals, WebGL uploads,
uploaded bytes, rendered-pixel equivalence and frame time unavailable. Focus is
provided as a fixed deterministic collaborator factor, so this is not an
end-to-end focus-transition or visual comparison. It does not replace selected-
object/horizon/focus/fading rendered qualification or a fleet-scale measurement.

## Remaining qualification evidence

The [root fleet packet](root-51033433/README.md) passes 15 focused tests.
Snapshot and fleet-tick producer paths now have
separate bounded identity/write audits. The aircraft fixture is not fleet-scale,
and the two audits do not form a paired before/after optimization comparison.
No further runtime change is justified by these absolute current-path counts.

This current-path snapshot/record audit is not a population-scale timing run
or before/after aircraft optimization comparison. It cannot establish WebGL
upload counts, GPU work, uploaded bytes, frame time, or visual output. A
runtime change is not justified by this audit alone.

The collection split is a finite rejected experiment. Reopen it only for a
concrete supported representation that preserves mixed command bounds,
selected-object identity, horizon behavior, focus/fading and exact visual
output, with measured allocation or upload benefit. Until then, retaining the
single collection is the reviewed disposition, not an open-ended request to
try arbitrary alternatives.
