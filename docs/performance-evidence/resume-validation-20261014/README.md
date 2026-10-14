# Integration and diagnostic follow-up, 14 October 2026

Engineering closure remains 9/14; physical qualification remains 0/14. These reports do not satisfy hardware acceptance. Raw report bytes and their SHA-256 digests are retained beside this review.

## Weather and CI

Both representative runs at `90b8d289` completed: [run 38510546346](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38510546346) and [run 38510549026](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38510549026). Windows onboarding, three-platform recovery, and Street Level passed. Both Node versions failed three candidate-evidence tests: their generic synthetic fixture delivery was mislabeled as the stricter weather v2 contract. Release verification also failed at source tests. `011f6e5a` replaces those fixtures with the shared producer-shaped weather fixture and validates latest/history boundary modes separately. It does not relax production evidence requirements.

The separate [weather diagnostic 38510550018](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38510550018) failed before measurement: preflight tried Previous while the real timeline was in Latest mode. `df26d2c7` uses the actual slider at all three manifest indices, checks each source timestamp and the clock, then returns to Latest. `ee88d32f` corrects its final source-time list. Root passes 302 focused weather, candidate, capture, and voice tests. A new hosted result is still required. Downloaded artifact 11868794969 matched GitHub's ZIP digest `3416f78ff0dcdc709d30723693d6fb0ad43a6e3a5acce605e5aabcaa4df93d42`.

## S48 matched CPU diagnostic

Clean source `b29fd471` completed five alternating pairs for each of four workloads, using independent Node processes, identical virtual clock/route settings, and matching before/after populations. The mock canvas excludes actual browser painting and GPU execution. Root passes three contract tests, including mismatched population/identity controls. The full CI runner now includes these tests and six datacenter fixture suites.

Median paired instrumentation ratios were +2.89% generic, +7.08% infrastructure, +1.28% mixed radio, and -2.77% detection. Individual pairs ranged from -21.30% to +43.94%; negative values and wide dispersion show this desktop run does not resolve a reliable overhead percentage. No speedup or negligible-overhead claim follows. Nested frame/projection/paint timings must not be added together. Projection dominated measured subphases in the first three workloads; detection mostly recorded the mock paint path. Actual browser attribution remains separate.

Resource diagnostics now distinguish entities from data sources. CCTV v3 declares its semantics; historical v1/v2 are explicitly legacy. The soak includes entity counts and only accepts import point counts with exact owner coverage and instance units. Root passes 63 frame/resource/snapshot checks.

## S59 cooperative CSV experiment

The same 50,000-record, 2,477,807-byte CSV was measured at baseline `b29fd471` and experimental candidate `3e141aa5`, five measured trials after one warmup on Windows Node 24.16.0. Median synchronous preview prefix fell from 91.01 to 2.11 ms, but total preview rose from 254.92 to 697.46 ms. The unchanged GeoJSON control also varied (118.57 to 134.22 ms). These sequential Node diagnostics identify a scheduling/throughput tradeoff; they are not a counterbalanced browser acceptance comparison. The experiment must remain opt-in pending attribution and browser/total-completion validation. Do not enable it by default or call S59 complete from the prefix reduction.

## Frame delivery and reconciliation

The [Windows d0f463a8 failure](../s54-local-d0f463a8/README.md) occurred in the default Entity lifetime, before the collection candidate. A follow-up diagnostic observes scene events and browser scheduling without retrying capture or changing its 400 ms deadline. Its result remains outstanding.

Fresh fetches found fork main `9beadbda` and upstream main `132b9e96` already contained in QA. Fork dev remains `e8ccc268`. No new main reconciliation is required. This packet does not promote QA to dev/main or update VM105.
