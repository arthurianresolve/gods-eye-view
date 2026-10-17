# S47 requested retry: baseline cleanup failure

The [user-requested retry](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38231901628)
uses the same immutable candidate and harness
`29dc9f515d194029f39cb0cc926586e9e0d1adf1` as the
[preceding run](../s47-retirement-order-38230635126/README.md).
It **fails during baseline smoke cleanup**. Candidate measurements are not reached.

The baseline application is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`.
Future-document registration removal passes in 894.256 ms. Final probe and
render-loop retirement exceeds the separate unchanged one-second gate at
1,000.145 ms. A late acknowledgement arrives at 1,208.135 ms; actual page-side
execution takes 0.200 ms and confirms restoration, removal of both probe
listeners, state deletion and render-loop retirement. The timeout stays failed.

This confirms delayed retirement delivery also occurs with the baseline
application under the newer QA harness. It does not attribute that delay to
upstream application code, establish the physical Windows stall's cause, or
validate the candidate. Further unchanged retries are not an implementation fix.

- [Original report](report.json): 5,884 bytes, SHA-256
  `7a6fedffdaddca97ef1dc12158dd8d35175e74d31b7124fa146b612366bacfe7`.
- [Independent byte identity review](review.json).
- [Terminal workflow metadata](ci-run.json).

No CPU-profile sidecars were produced. The original and retry remain separate
failed evidence; neither is performance acceptance.
