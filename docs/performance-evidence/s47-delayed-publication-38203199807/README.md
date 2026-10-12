# S47 delayed publication repair and rendered timeout

[Run 38203199807](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38203199807)
tests application and harness `788b2bd8b5eef862499086610c073fa3767deda1`.
The worker-audit repair accepts a delayed target only when its exact URL belongs
to a wrapper validated from the frozen snapshot. Delayed blob requests likewise
require validated frozen bytes. Unknown and post-freeze URLs remain failures.

Root independently passes 58 focused tests, including a serialized page-audit
regression that publishes a target during awaited `Blob.text()` after native
URL restoration and a negative control that creates new code after the freeze.
Package boundaries, syntax, formatting and whitespace checks pass. Counts at
the freeze and later observations are recorded separately; no URLs are retained
in the new publication summary. The prior count-only failure remains unchanged
and does not retrospectively identify its late URL.

The rendered run gets beyond that earlier audit failure and completes three
samples. It then reaches the existing **180-second capture-child deadline**
while preparing scripted-motion run 2. The baseline build/inspection passes.
The overall smoke remains failed, with cleanup confirmed by the child runner.
The final `Runtime.callFunctionOn: Target closed` result occurs during timeout
cleanup and is not evidence of a separate spontaneous browser crash.

| Completed sample | Actual duration | Completed renders | Render intervals |
| --- | ---: | ---: | ---: |
| Idle 1 | 6,390.1 ms | 2 | 1 |
| Idle 2 | 4,991.3 ms | 2 | 1 |
| Scripted motion 1 | 8,914.1 ms | 3 | 2 |

All three retain 2,500 aircraft, 4,362 datacenters and 716 dams, Manual density
75%, and foreground status. The requested one-second measurement is not its
actual duration. The first motion observer now runs and cleans up successfully:
ten update/render spans over 28,192.9 ms, including warmup and final boundary
settlement. Its maximum update span is 3,028.5 ms, maximum render span 3,777.3 ms
and maximum observed long task 4,034 ms. The timer portion of the measurement
window spans 5,818.8 ms; the sample duration includes later frame settlement.
All completed samples release their render-boundary progress bindings.

These are event-span observations on hosted SwiftShader, including stalls,
not GPU timings or function-level CPU attribution. The embedded bounded failure
report is explicitly **truncated**: long-animation-frame script records are
null, so they cannot identify a responsible function. It also lacks the
completed documents' detailed worker-publication counts; getting beyond audit
does not establish that this run exercised the same delayed target as the prior
failure. No page or fixture-interception errors are recorded.

The raw artifact is [report.json](report.json), 127,210 bytes, SHA-256
`22aa594f5708cf478d8d97c6dd2744c15b74cde021d1fe19b7ccf5ad798e6a4b`.
[Independent review](review.json) and [job metadata](ci-run.json) preserve the
failure and bounded timing summaries. No unchanged retry, deadline increase,
population reduction or production renderer change follows from this result.
Full S47 integration, physical Windows frame delivery and the final soak remain
unaccepted. Further software-cost attribution must preserve usable function
evidence in a separate diagnostic run before another runtime change is chosen.
