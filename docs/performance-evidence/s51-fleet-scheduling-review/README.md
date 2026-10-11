# S51 fleet scheduling review — 11 October 2026

The untracked civil/military fleet scheduling experiment is **not accepted for
promotion to `dev`**. Its latest five-pair comparison fails two cadence limits.
Production continues using its existing fleet rendering ownership. This outcome
does not complete S51; the separate traffic empty-idle change, full application
static/cadence checks, visibility recovery and physical Windows evidence remain.

## Immutable comparisons

Baseline application: `e6ab561ad0e77a49219627e97573199f1db0af62`.
Candidate: `1d673a28efbe382cb2b7442ab2c17a0491a60a3d`.
[Comparison run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38117383197).
Both applications use the candidate's installed Cesium dependency corrections;
the report records the five installed engine hashes and both source trees. This
compares fleet application changes, not patched versus unpatched Cesium.

Independent decoding verifies 360 PNG/framebuffer images across twelve
correctness documents. All fifteen phases have exact camera values, aircraft
output and pixels. This closes the observed camera-pose mismatch in this
fixture, but cannot override a cadence failure:

| Pair | Failed civil visual-update gate | Baseline | Candidate | Regression |
| --- | --- | --- | --- | --- |
| 1 | p95 interval | 156.6 ms | 178.3 ms | 13.86% |
| 5 | Median interval | 129.8 ms | 150.1 ms | 15.64% |

The unchanged per-pair tolerance is 10%. These component samples use 500 ms
warmup and 3 seconds of observation; they are not the S47 full workload protocol
of five runs with 30 seconds warmup and 60 seconds measurement. Their failures
remain failures. No thresholds, populations or visual settings were relaxed.

The full raw failed report, including images, is retained as
[`cadence-failure-1d673a2.json.gz`](cadence-failure-1d673a2.json.gz), with
[independent review](cadence-failure-1d673a2-review.json). The
[manifest](manifest.json) gives hashes of both compressed and decompressed bytes.

## Separate attribution run

Diagnostic harness: `cb0cf99396241b3033a5b5d0c08d768995e97b00`.
[Timing run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38118661383).
The application runtime is unchanged from `1d673a2`. Two alternating pairs use
10-second instrumented samples after 500 ms warmup, Chrome 152.0.7977.75 and
Apple paravirtual Metal. They are supplemental hosted evidence, not physical
desktop validation or an acceptance benchmark.

The diagnostic owns bounded method/timer wrappers and scene listeners. It
restores them on completion and failure without cancelling application timers.
Raw traces are complete and untruncated. An independent pass recomputes their
summaries; all five installed dependency hashes match the collision correction
manifest. Instrumented reports are explicitly rejected by the performance
acceptance validator.

Candidate synchronous `scene.render` p95 was 2.5/2.3 ms; timer callback CPU p95
was 0.3/0.3 ms. Governor timer lateness p95 was 18.8/20.2 ms, while candidate
visible-update p95 was 129.6/134.4 ms. Baseline visible-update p95 was
146.7/145.6 ms. These observations separate small synchronous CPU spans from
much longer wall-clock delivery intervals. They do not isolate GPU execution,
compositor scheduling or host contention, and do not prove a further runtime
fix. The longer instrumented samples cannot turn the earlier failed acceptance
pairs into passes.

[Full timing trace](timing-diagnostic-cb0cf99.json.gz) and
[independently recomputed summary](timing-diagnostic-cb0cf99-review.json).
Do not add overlapping CPU spans. Unsupported GPU timing is `null`.

## Integration and next work

All seven ordinary integration jobs pass at both the
[collision-correction commit `26b5bf7`](ci-38116780725.json) and
[deadline-guard commit `1d673a2`](ci-38117723180.json): Node 24/26,
Windows onboarding, three-OS install/recovery, and existing browser journeys.
The separate [tracking run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38117365369)
passes 111 checks at `1d673a2`. PR-only layer-token checks and optional soak jobs
were skipped in ordinary integration runs, not passed.

The reproducible no-op camera-transform correction is being reviewed separately
from fleet scheduling. Only its scoped commit may be promoted after integration
on the production base. The QA branch also contains unrelated experiments and
must not be merged wholesale. Traffic empty-idle ownership and the remaining
S47–S60 requirements continue independently.
