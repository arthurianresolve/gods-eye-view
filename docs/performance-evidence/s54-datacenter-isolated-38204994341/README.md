# Isolated datacenter integration: fixture identity failure

The [correctness run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38204994341)
tests application and harness `9a0b6a0805594945aa8975783a515aa5a23bce57`.
The isolated candidate retains Entity defaults and scopes its opt-in renderer
to datacenters. Root independently passes 92 focused tests, formatting and
package boundaries before this run.

The rendered result fails in the first Entity lifetime's `default-style`
sample, before the collection renderer or any paired comparison. It records
55 completed captures, 35 stable frames, ready source/geometry, and 4,362
surface records. The selected camera has two visible surfaces. Native point
picks return source Entities, including the requested Entity, but the fixture
rejects both before completing owner validation. Layer, viewer and browser
cleanup complete.

Source review identifies a deterministic fixture defect: line 783 in
`scripts/fixtures/infrastructure-runtime-collections.mjs` passes
`targetLayer.layerId` into the native-pick validator. The production factory's
layer API exposes `id`, not `layerId`. The resulting undefined value fails the
validator's layer allowlist. The helper tests supply a valid layer identity
and therefore do not cover this incorrect call site.

The correction must use the actual layer identity and verify its agreement
with the fixture descriptor before capture. The native-pick validator, source
population, geometry, camera and deadlines must retain their requirements.
The failure does not establish a production rendering defect or a physical
Windows GPU cause. No collection benefit is accepted from this run.

The runner reports Apple paravirtual Metal acceleration, which is supplemental
hosted evidence. The [raw report](report.json) is 58,552 bytes with SHA-256
`c7e3abfbd89bf6679918d96c84452e5650536bae448fa8c3d2c4e530568cef9d`.
The [review](review.json), [CI metadata](ci-run.json) and
[last completed frame](last-frame.png) preserve the failure. A corrected
exact-commit rendered check and separate benefit comparison remain required.

The caller correction is implemented at
[`f09aa36a`](https://github.com/arthurianresolve/gods-eye-view/commit/f09aa36a9e54be7a53c78ce36b16d9e9b6b5567c).
It validates the real factory layer's public `id` against the fixture descriptor
before using it for native picking. Eighteen focused tests pass independently,
including the factory-to-pick identity contract and mismatch rejection.
The [rendered correction check](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38205435137)
is a separate result; the failed artifact above remains unchanged.
