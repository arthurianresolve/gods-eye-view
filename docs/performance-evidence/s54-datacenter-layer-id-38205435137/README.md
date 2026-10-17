# Datacenter layer-identity correction: remaining stem-pick failure

[Run 38205435137](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38205435137)
tests application and harness `f09aa36a9e54be7a53c78ce36b16d9e9b6b5567c`.
The fixture now validates the production layer's public `id` against its
descriptor and passes that identity to native picking. Eighteen focused tests
pass independently, including the factory-to-pick boundary and mismatch
rejection.

The rendered result remains failed in the first Entity `default-style`
sample. This time the point owner checks pass: point misses are zero. Both
attempted stem picks return no object. The fixture records 21 completed
captures, ready source/geometry, two visible surfaces out of 4,362, and one
native-pick search. No sample or paired comparison completes; the collection
lifetime is not reached. Layer, viewer and browser cleanup pass.

The last completed frame has the same pixel hash as the previous failed run,
`a62c412b818c2375bdfae66dfefe6ab17398f0aec94f33a4b0fa4314e617db70`,
and visibly contains a point and stem. That does not prove native picking
correctness. The remaining pick failure needs separate attribution; it must
not be bypassed or converted into a rendering pass. Frame delivery continues,
so this result does not reproduce the physical Windows no-frame symptom.

The separate required benefit fixture is being checked on the same revision
in [run 38205683313](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38205683313).
It captures both native picks before assigning selection, whereas this runtime
fixture assigns the point selection before the stem pick. This is a concrete
source difference to investigate, not an established cause. Its result cannot
override this failed correctness report.

The [raw report](report.json) is 58,470 bytes, SHA-256
`feefaf5dd80a88fd41de4d516ebf2ba280197ac8a51740404f5cdc1ce7f3e9f5`.
[Review](review.json), [CI metadata](ci-run.json), and
[last frame](last-frame.png) retain the failed result. Hosted Apple paravirtual
Metal is supplemental evidence; no physical hardware or performance acceptance
is claimed, and production Entity defaults remain in place.
