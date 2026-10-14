# Expanded observer coverage: earlier geometry-readiness failures

[Run 38201597528](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38201597528)
tests application/harness `01521081988c04f122401be4054607bbbc26e6f5`.
The observer now supports both renderers and both re-enable cycles, but this
run **fails before reaching any of those cycles**. Its report correctly retains
zero observation records and all four missing identities. Focused tests cover
the new recording paths; rendered re-enable coverage remains unvalidated.

The complete [raw report](report.json) is 498,600 bytes, SHA-256
`eb27d37a3d8ea0cc220679cea56683300bcef01150d2d3b804d6718c29ed0f81`.
The [independent review](review.json) checks the downloaded bytes, revision,
failure stages, missing observations and readiness traces. [CI metadata](ci-run.json)
records the exact failed run.

| Renderer | Failure | Retained observations |
| --- | --- | --- |
| Entity baseline | Camera-change photoreal classification transition | Five default-view captures; frame numbers advance from 905 to 1,154. The 1,913-instance ground-line primitive becomes ready at 12,243 ms, beyond the 12-second deadline. |
| Collection candidate | Initial same-classification notification control | No captures; frame numbers advance from 21 to 297. The ground-line primitive becomes ready at 13,332.5 ms, beyond the same deadline. |

Both traces show `CREATING` followed by `COMBINING`, with completed frames
continuing before readiness. The final retained observation gaps are about
2,716 ms and 3,036 ms. These are observed frame/event gaps, not GPU timings or
proof of one particular worker cost. The traces are bounded and explicitly
truncated. The same-classification control also includes initial geometry
preparation; its duration cannot be attributed solely to the notification.

No matched image pairs are available. The five baseline-only images do not
validate visual equivalence or resolve the earlier coordinate/pixel differences.
Both owned viewers are confirmed destroyed; neither lifetime reaches its layer
teardown assertions. There are no reported page or interception errors and no
external requests. Browser shutdown completes without forced termination.

This hosted Apple paravirtual Metal result is distinct from the previous loss
of completed frames during re-enable and from the physical Windows stall.
It identifies late geometry readiness at the failed stages, not a successful
optimization. The candidate remains isolated with Entity defaults. Further
work must distinguish preparation cost from settled-frame behavior, retain
actual activation latency, and evaluate the experiment against the plan's
benefit and fidelity requirements. No deadline, population or acceptance rule
was relaxed for this run.
