# S47 first-motion CPU attribution

[Run 38210121293](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38210121293)
tests the isolated application and harness revision
`73e6c72cc7e7acc6cbb957dd94a6a902e7e489f3`, based on `788b2bd8`.
The code adds opt-in CPU profiling to the first scripted-motion sample, from
before warmup through measurement-boundary completion or failure. Production
rendering, fixture populations, visual settings, worker-audit mode and the
180-second capture-child deadline remain unchanged.

Root independently passes all 40 focused tests across the bounded profiler,
first-motion window, capture CLI and smoke validator. Formatting checks 1,562
files; package/import boundaries, syntax and whitespace checks pass. Review
also exercises the real window/profiler integration with a fake protocol
session, including artifact naming and producer-shaped report validation.

The profile stops after at most 60 seconds without ending the capture operation.
Capped coverage stays incomplete. Cleanup errors cannot validate as a clean
capped profile. Session operations have two-second limits, late session creation
is cleaned up, and capture errors remain primary. Disabled profiling creates no
session or artifacts. Normalized profiles are limited to 8 MiB, 20,000 nodes and
100,000 samples; non-fixture source URLs are redacted.

A separate profile and hash-bound index survive subsequent capture failure and
the bounded nested failure-report projection. The success path requires matching
report/index references, fixed filenames, exact byte lengths and SHA-256 hashes.
Sample weights are statistical main-thread stack attribution, including idle
and garbage collection. They are neither precise CPU execution time nor GPU
duration, and these instrumented samples cannot establish performance acceptance.

The hosted run **fails before the profiler target is reached**. The first idle
sample completes, but idle run 2 reaches its unchanged six-second host observation
deadline at the measurement boundary. The host records 6,298.3 ms elapsed and no
page-entry receipt. No CPU session or sidecar is created; the first-motion profile
stays pending. This result cannot attribute the stall to a function or to the
new profiler, which has not started.

Idle run 1 delivers two completed renders over 5,069.4 ms, one 4,986 ms frame
interval, and one recorded long task of 84 ms. Idle run 2's partial measurement
delivers two renders over 5,359.7 ms and two long tasks, with a 2,272 ms maximum.
Its warmup completed after a 4,409.4 ms render-boundary wait. Both retain the
recorded foreground state; the report confirms 2,500 aircraft, 4,362 datacenters,
716 dams and Manual density 75%. These short intervals include boundary waits
and are not accepted frame-rate comparisons.

The failed sample's progress-binding cleanup also times out after 250 ms.
The wrapper reports child cleanup confirmed; that does not turn the failed
binding removal into a pass. A late `TargetCloseError` is recorded during timeout
cleanup and is not evidence of an independent browser crash. Page and fixture
interception error lists remain empty. Rendering is hosted Linux SwiftShader,
Chrome 152, with a 1440x900 drawing buffer; no physical Windows claim follows.

The [raw report](report.json) is 92,567 bytes, SHA-256
`2f0e62d2305b02d342aa34ec858da291079e7352f8315dd56bd9b87b367f1a53`.
The [independent review](review.json) verifies exact revisions, failure phase,
fixture populations, missing profile coverage and cleanup limitations;
[CI metadata](ci-run.json) preserves the failed result. The nested failure
projection remains explicitly truncated.

Earlier-document CPU coverage is needed before another run: restricting
instrumentation to the first motion sample misses this reproduced idle-stage
failure. No unchanged retry, deadline increase or runtime optimization follows
from this result. The earlier failed run and its missing function-level evidence
remain preserved in the
[delayed-publication report](../s47-delayed-publication-38203199807/README.md).

Separately, all seven [standard dev checks](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38209437236)
pass at `2f7de280e41f23fa2036b07c74d9bf21cfb01c32`, including both Node suites,
Windows onboarding, three recovery jobs and browser journeys. Their
[metadata](standard-ci-dev-38209437236.json) is preserved. That documentation
integration does not include this isolated profiling packet; its successful
checks do not override the failed diagnostic or validate the performance target.
