# Early renderer evidence: cleanup failure before measurement

[Run 38219550027](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38219550027)
tests harness and candidate commit
`2de9501cb2dcc7a841b512068b86190c67728667`. It **fails** during cleanup of
the `eb8c682` baseline document, before candidate capture or CPU profiling.
The whole run takes 51,837 ms. No page or fixture-interception errors are reported.

The isolated harness change moves renderer/vendor identity reads to the existing
one-shot hook on Cesium's actual context creation. Later observations verify the
same canvas and original context, reject lost/restored contexts, and read current
settings, populations, dimensions and camera pose without repeating those GL
identity queries. Query duration stays in reports but is excluded from matched
workload equality; renderer identity, context attributes and effective settings
remain checked. Cleanup keeps the registered script and exact listener owners.
Root independently passes 83 focused tests, including failure reports, cleanup
timeout, repeated-document comparisons and paired-report negative controls.
Formatting, package boundaries, syntax and whitespace checks pass. Application
rendering code, quality and all capture/cleanup deadlines are unchanged.

The failure is `Smoke cleanup failed`, with the single detail
`Early renderer probe cleanup was not confirmed.` The helper currently collapses
both exceptions and timeouts to `false`; this artifact cannot distinguish which
occurred, or whether document cleanup or script-registration removal failed.
Calling this a GPU stall or increasing a timeout is not supported. The next
repair preserves bounded phase-specific cleanup evidence and keeps incomplete
cleanup a failure. This run provides no latency, hardware or completed-capture
acceptance, and the earlier CPU evidence remains diagnostic only.

A separate source review of the earlier depth-pick stacks finds existing HUD
context coalescing and a per-viewer 2.5-second view-target cache. Those stacks
identify expensive operations but do not prove duplicate same-input queries.
Changing cache lifetime without terrain/map invalidation evidence could return
stale targets; no such runtime optimization is included.

The [raw report](report.json) is 1,834 bytes, SHA-256
`4f9d9b178299ccc7ea568835ffbd95f52f72945f8fdf9c89b393a56bc3521c39`.
[Terminal diagnostic metadata](ci-run.json) preserves the failed run.

Separately, standard `dev` CI
[38218701144](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38218701144)
passes all seven jobs at `111382fb0ff8d3f64bb4cff2a87177beb4eecb7b`: Node 24/26,
Windows onboarding, Windows/macOS/Linux installation recovery and the browser
gate. [Its metadata](standard-ci-dev-38218701144.json) is retained here. This
validates that integration commit; it does not validate the isolated renderer
harness change or explain historical intermittent Windows shutdown failures.
