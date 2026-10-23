# S47 observer-read diagnostic: failed

Frozen application/harness a37a4eecfd38684d094335d30972bacecbc0bc0f. The original hosted report is preserved byte-for-byte in report.json.

The baseline build/short route smoke passes, but the candidate completes no capture samples: the first idle sample misses the unchanged 5-second completed-render deadline. The enclosing stage observes 6001.6 ms. The failing stage is warmup render settling, before that document's prewarm worker audit. This is not evidence of a worker stall.

Startup observer host wall time is 2937.4 ms. Its in-page read timings were overwritten when startup progress was replaced by sample progress; therefore this report cannot attribute that time to WebGL queries. Follow-up 6721940d preserves startup observer timing independently; nine focused checks pass and run 38169235037 is pending. Population, settings and deadlines remain unchanged.

This failed SwiftShader diagnostic provides neither paired timing nor hardware acceptance.

[Hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38168778561).

Original report SHA-256: deefe8e15ab5bdd7a78b64a883ec451e4d21797598e0ceecebc377a87d93d81d
