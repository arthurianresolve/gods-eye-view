# S47 fixture disposal succeeds; host boundary includes queued evaluation

[Original run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173706259), clean application/harness `c9447d408e47711397f6fd158900fd2074af42db`. Original artifact bytes are preserved in performance-build-smoke.json. This run remains failed and completed no measured samples.

The fixture teardown race no longer occurs. Both early probe documents dispose successfully and the warmup clock boundary is reached. The retained host/page progress events then show:

| Event | Host milliseconds after boundary call |
| --- | ---: |
| Browser callback entered | 4249.35 |
| Render observer armed | 4249.43 |
| Render requested | 4249.49 |
| preUpdate | 5402.82 |
| postUpdate | 5405.26 |
| preRender | 5407.38 |
| Host operation rejected | 6003.47 |

The existing host deadline starts before the evaluate call is serviced; the page's five-second render timer starts after entry. The host therefore rejects with most of the page timer unused. This does not prove a five-second draw stall. The next correction must separately bound callback entry and completed-render observation, retain both elapsed times, enforce the render deadline against monotonic elapsed time even when timers are delayed, and retain failures for either phase. No performance acceptance, density reduction or timeout-based pass is inferred from this failed run.
