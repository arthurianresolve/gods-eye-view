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

The [Windows d0f463a8 failure](../s54-local-d0f463a8/README.md) occurred in the default Entity lifetime, before the collection candidate. At clean `e4b22d2b`, the bounded follow-up again failed in the default Entity lifetime after two initial frames. The 400.5 ms capture window contained zero preUpdate, postUpdate, preRender, postRender, or renderError events; the default render loop remained enabled, and no long task was observed in that window. During the subsequent 1001.4 ms scheduling observation, Chrome delivered one RAF callback (first delay 524.8 ms) while 37 timers fired. The report is retained as `windows-frame-scheduling-e4b22d2b.json`. This narrows attribution to frame scheduling/delivery, but does not establish whether desktop occlusion, browser/compositor scheduling, or driver behavior caused it. No capture retry or deadline change was used. The desktop's unobscured state remains unverified. Cleanup completed; no collection comparison or hardware acceptance resulted.

`e4b22d2b` makes cooperative CSV parsing explicit via `cooperativeParsing: true`; the workspace UI keeps synchronous parsing. The synchronous scanner is refactored and behavior-parity-tested, not byte-identical to the original implementation. Its standalone timing difference remains a diagnostic observation rather than a proven regression.

Fresh fetches found fork main `9beadbda` and upstream main `132b9e96` already contained in QA. Fork dev remains `e8ccc268`. No new main reconciliation is required. This packet does not promote QA to dev/main or update VM105.


## Reviewed follow-up at 9e0109f1 and edac418b

The clean Windows Node 24.16.0 full run at `2d210d27` failed: 7,928 passed,
two failed, ten skipped, in 535.5 seconds. The allocation phase was not reached.
The retained failure summary records both assertions and the local raw log digest.
One failure was introduced by the new optional frame diagnostic fields;
`516e9b54` restores the strict default report shape and enables event counts only
for the isolated failure fixture. All 61 affected report/frame checks pass.
The second was an inherited MCP shared-key repair race: one child reported EPERM
and fell back to a process-local key. The old log does not identify which filesystem
operation failed. `fc9db154`, `38abd71b`, and `edac418b` handle Windows link/rename
failure and transient publication gaps without replacing a valid first winner.
All fourteen panel-key checks pass, including natural concurrency and controlled
EPERM/gap cases. The repair deadline remains five seconds. This is scoped evidence;
a new full both-base matrix is required.

At clean `9e0109f1`, Chrome 154 on this Windows machine completed one warmup per
mode and five alternating pairs for each import parser experiment. Every pair had
identical input/output hashes, populations, and IDs; every arm reported continuous
DOM visibility/focus. Desktop occlusion was not checked. The fixed CSV has 50,000
records (2,477,807 bytes), and GeoJSON has 25,000 (3,527,821 bytes).

| Experiment | Median synchronous prefix, control / experiment | Median total completion, control / experiment | Decision |
| --- | --- | --- | --- |
| Cooperative CSV scanner | 117.4 / 14.5 ms | 406.4 / 498.3 ms | Reject default activation: all five pairs are slower overall (+18.4% to +70.2%) |
| One-shot JSON parser worker | 36.6 / 14.2 ms | 93.6 / 156.3 ms | Reject default activation: all five pairs are slower overall (+45.2% to +280.2%) |

These are bounded parser diagnostics, not full import/UI interaction acceptance.
The explicit experimental options remain off in the workspace UI. The worker owns
and retires its listeners, timeout, and process on completion, failure, and abort;
38 parser/cancellation/fixture/lint-config tests pass. Package boundaries and capture
lint pass, and the production build completes in 14.8 seconds. No speedup/default
rollout follows merely from the shorter synchronous prefix.

The same clean source also ran five-second scheduling controls without Cesium.
Plain RAF delivered 285 callbacks, while static WebGL delivered 14 and animated
WebGL delivered 11. Both WebGL paths fell to one callback per second in later
buckets, with maximum gaps near 1,017 ms; timers delivered 249-250 ticks. The actual
renderer was Intel UHD 620 through ANGLE D3D11. DOM visibility/focus remained true,
no lifecycle/context-loss events were recorded, and desktop foreground verification
remains unavailable. Changing pixels did not restore frame delivery. This reproduces
the symptom outside the application, but does not prove driver, compositor,
occlusion, upstream, or candidate causation. It does not qualify performance,
fresh capture, or the sixty-minute soak. The owned tabs and local server were closed.
