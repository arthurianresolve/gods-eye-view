# Datacenter component comparison on the isolated integration

[Run 38205683313](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38205683313)
completes the benefit-report contract at application and harness
`f09aa36a9e54be7a53c78ce36b16d9e9b6b5567c`. It compares five alternating
fresh-viewer latency pairs and five separate forced-GC memory pairs on hosted
Apple paravirtual Metal. All twenty runs verify native point and stem owners,
complete source population, and cleanup.

Root independently validates the complete report, all 27 committed source
hashes and all 40 encoded PNG hashes. The twenty corresponding PNG pairs are
byte-identical at 960 by 640 pixels. These component images and native picks
do not replace the separate runtime fixture's failed correctness result.

| Median metric | Entity renderer | Collections | Change |
| --- | ---: | ---: | ---: |
| Source ready | 627.5 ms | 859.6 ms | +36.99% |
| First usable frame after source ready | 5,447.8 ms | 3,846.3 ms | -29.40% |
| First usable frame from activation start | 6,178.4 ms | 4,812.0 ms | -22.12% |
| Enabled JS heap above fresh-viewer baseline | 163,880,096 bytes | 137,418,776 bytes | -16.15% |

Each whole-activation value is calculated per run before taking the median;
the sums agree with the report's recorded `elapsedFromStartMs`. Summing phase
medians would give a different, incorrect whole-activation median.

The source-ready phase is slower in four of five latency pairs, exceeding the
10% investigation threshold. The whole activation improves, so the phase
increase must be interpreted alongside work moved before source readiness;
it is not evidence of a whole-activation regression. Its cause is not yet
established. Heap results describe JavaScript allocations after forced GC,
not native/GPU memory or a sixty-minute retention plateau.

The [runtime check on this same commit](../s54-datacenter-layer-id-38205435137/README.md)
still fails to pick stems during its one native-pick search, despite a final
image matching this fixture. Different pick ordering and retry policies need
attribution. Therefore **performance acceptance and rollout remain pending**.
Entity defaults remain in production; no physical Windows or full-scene
performance acceptance is claimed.

The [raw report](report.json) is 411,015 bytes, SHA-256
`f57fdfebe81cbec473f587ba7c5fc0d29159c9f64b99da620470cf45ce9c63ca`.
[Independent review](root-review.json), [CI metadata](ci-run.json), and the
forty PNGs under `images/` preserve the complete comparison.
