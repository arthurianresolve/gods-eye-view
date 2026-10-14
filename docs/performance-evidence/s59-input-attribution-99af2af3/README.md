# S59 input parsing attribution

The clean-source diagnostic at `99af2af31e783670940a00b99d9ee8c964567fac`
measures the production CSV and GeoJSON preview entry points on Windows
10.0.19045, Node 24.16.0 and Intel Core i7-8665U. The
[raw report](report.json) retains all five measured trials after one warmup,
fixed fixture digests and complete first/last record checks.

| Input                    | UTF-8 bytes | Decode median | Parse median | Synchronous preview prefix | Total preview median |
| ------------------------ | ----------: | ------------: | -----------: | -------------------------: | -------------------: |
| CSV, 50,000 records      |   2,477,807 |       0.81 ms |     58.80 ms |                   98.46 ms |            252.07 ms |
| GeoJSON, 25,000 features |   3,527,821 |       1.05 ms |     27.59 ms |                   30.87 ms |            140.85 ms |

The synchronous prefix is measured from the preview call until it returns its
promise. Both entry points decode and parse before their first cooperative
yield. Parse and prefix trials are separate calls; their medians must not be
subtracted to infer another stage's cost. Total preview includes cooperative
timer waits. No forced GC, browser, rendering, GPU, interaction percentile or
paired optimization acceptance is claimed.

This confirms a remaining S59 input-stage bottleneck. The next change should
make substantial CSV scanning interruptible and evaluate off-thread JSON
parsing with bounded cancellation and failure ownership. The SDR worker is
unrelated to imports and should not receive import jobs merely to reuse a
worker. Any accepted change still needs complete-record parity, malformed
input and cancellation checks, plus matched total-time and responsiveness
measurements. The existing single-feature geometry experiment remains a
separate rejected optimization; this evidence does not change its outcome.

Reproduce from a clean checkout:

```sh
node scripts/performance/importInputAttribution.mjs qa-artifacts/import-input-attribution.json
```
