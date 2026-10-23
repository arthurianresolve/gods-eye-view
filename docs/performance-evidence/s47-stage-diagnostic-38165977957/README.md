# S47 capture smoke: setup-stage attribution

[Run 38165977957](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38165977957)
fails at `068b24ddd8a4961e56a1a25bba89777032635f12` with the unchanged
180-second child deadline. [Original artifact](report.json), [workflow](ci-run.json)
and [bounded review](review.json) preserve the failure. The baseline build/route
smoke passes in 64.719 seconds; that different workload is not a timing comparison.

The candidate finishes three of six requested samples. Their setup stages show:

| Completed sample | Fresh document setup | Layer/camera setup (included) | Completed-render settle | Worker read and restoration |
| --- | ---: | ---: | ---: | ---: |
| Idle 1 | 19,287 ms | 10,886 ms | 5,183 ms | 902 ms |
| Idle 2 | 14,189 ms | 7,351 ms | 410 ms | 733 ms |
| Motion 1 | 9,373 ms | 4,788 ms | 5,504 ms | 4,564 ms |

All three worker audits complete and validate. The fourth sample reaches layer
and camera setup at 173.424 seconds; the browser is closed at the child deadline
roughly 6.619 seconds later. This run does not establish a stalled worker audit.
The final TargetClosed error follows deadline cleanup, so it is not evidence of
an independent browser crash.

The configured one-second measurement windows take 6.55-8.05 seconds of observed
wall time, with recorded long tasks exceeding three seconds. These are SwiftShader
software-rendered dense scenes at 1440 x 900 with 7,578 objects and Manual 75%
density. The report is explicitly failed/truncated and has no post-capture served
asset verification. It cannot establish candidate performance, physical GPU
behavior, or the cause of earlier Windows frame failures.

The journal distinguishes cumulative setup cost from audit waits. It does not
attribute CPU/GPU cost within those intervals. Next work must isolate the costly
setup/render path and validate a bounded smoke design without relaxing visual
settings, populations, acceptance thresholds or silently extending the deadline.
