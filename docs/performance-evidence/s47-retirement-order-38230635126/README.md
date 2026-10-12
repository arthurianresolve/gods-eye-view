# S47 retirement order: motion diagnostic cleanup failure

The [exact-commit run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38230635126)
at `29dc9f515d194029f39cb0cc926586e9e0d1adf1` **fails**. Baseline smoke passes.
The candidate completes two idle samples, then fails during first-motion
diagnostic teardown. This is instrumented SwiftShader evidence, not hardware
performance acceptance.

The new ordering retires each provider document before worker auditing and
interception removal. Main-setup retirement takes 3.845 ms inside the host
document stage; the page callback takes 0.100 ms. All four reached startup,
setup and completed-sample document cleanup gates pass. This narrow observation
does not establish that intermittent retirement delays are fixed.

First motion delivers both boundary frames. The measurement boundary settles
in 510.900 ms in the page. Subsequent cleanup fails: `Profiler.disable` exceeds
its existing 2,000 ms deadline, the scene-frame diagnostic stop times out, and
removing the progress binding exceeds 250 ms. The latter is the reported
terminal error. Boundary render-listener/timer cleanup is confirmed separately;
it must not be confused with the unconfirmed host binding/diagnostic cleanup.
Outer child cleanup is confirmed, without converting the failed sample to a pass.

The two idle CPU profiles are complete. The first-motion profile contains bytes
but remains **incomplete** because profiler teardown failed. All six raw profile
and reference files are preserved under [cpu-profiles](cpu-profiles), with
independently checked lengths and hashes in [review.json](review.json).

- [Original report](report.json): 171,974 bytes, SHA-256
  `c8f881a00da56227a1dab2025c86b0022b727657eae70a436e628316056a1454`.
- [Terminal workflow metadata](ci-run.json).
- The user's explicit retry ran the same revision once; its
  [separate failure](../s47-retirement-order-retry-38231901628/README.md)
  occurred during baseline cleanup, before candidate execution.

Source review must now place retirement at the end of the owned observation
lifetime, before diagnostic teardown, without stopping rendering during the
measurement or weakening cleanup deadlines. No production rendering change or
performance claim follows from these failures. S47 remains partial.
