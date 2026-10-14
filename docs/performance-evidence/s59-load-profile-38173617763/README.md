# S59 CPU mode with explicit-start trace marks

[Original run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173617763) passes at clean application/harness `552d1144c2dc24780449dabe56f9ee50f9d8c3e2`. Original report.json SHA-256: `729270bc978fce1e4a2ffa147a276a9b6b03034c30a62a170abc78b6d2be89a3`.

The retained CPU/trace report passes independent exact-revision validation, including input digests, recomputed CPU weights, trace overlap, fixture geometry, native picking and cleanup. It contains 45 samples and 266.992 ms sampled weight in a 270.07 ms profiler window. The instrumented geometry load takes 53.9 ms. The explicit-start marker call takes 0.6 ms and is outside sampled profiling.

The timing difference from earlier profiled runs is not a performance comparison. CPU/heap profiling remains separate from uninstrumented latency and retention acceptance. No geometry prototype is promoted.
