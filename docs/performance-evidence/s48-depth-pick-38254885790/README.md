# S48 depth-pick diagnostic: failed cleanup and lost inline evidence

[Run 38254885790](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38254885790)
fails at exact application/harness `d1da56e4b1b9195bd7cf3f21189fd7dae6248fc8`.
The [original report](report.json) is preserved byte-for-byte (SHA-256
`0631ef5c77164603bf5a1791fc3f974dee5975d673a709d11ca4f8ef509791fb`),
with the [terminal workflow state](run.json).

All six short diagnostic samples complete and the report summary records
matching build identity and before/after served-asset verification. The child
then throws `ReferenceError: page is not defined` in its new `finally` block.
`page`, `activeDocumentRole` and `activeDocumentId` were declared inside the
`try` block, outside the cleanup block's lexical scope. This is our harness
defect. The parent reports child cleanup confirmed; the child's own final
cleanup did not finish normally. The overall run remains failed.

The completed capture report also exceeds the unchanged 256 KiB inline failure
budget. Its depth-pick rows are unavailable in the retained report. Six
completed samples therefore do not establish validated caller/frame/cache
attribution. The next correction must preserve a bounded, hash-identified raw
capture artifact separately from the inline summary and exercise the actual
success and failure cleanup paths. Neither the budget nor render deadlines
should be raised to conceal these defects.

Three complete CPU profiles survive as separate artifacts. Root independently
verified their hashes and replayed all sample totals with [replay.mjs](replay.mjs);
[derived results](profile-review.json) match every producer top-location total.

| Window | Profile duration ms | readPixels sampled self ms | getProgramParameter sampled self ms | bufferData sampled self ms |
| --- | ---: | ---: | ---: | ---: |
| Idle 1 | 13,828.301 | 4,125.170 | 4,261.652 | 216.868 |
| Idle 2 | 11,420.564 | 3,565.184 | 4,097.569 | 1,185.640 |
| Motion 1 | 13,075.667 | 4,634.353 | 3,992.158 | 1,056.882 |

These are statistical main-thread API samples from a hosted software renderer,
not measured GPU duration or a matched performance comparison. The run cannot
establish a physical Windows fix or speedup.

The separate [local focused run](local-focused-failure.txt) passes 171 of 172
tests. Its invalid-input CLI child times out at the unchanged five-second
deadline. A [controlled import witness](cli-import-witness.json) confirms that
the old invalid-input path resolves Puppeteer and browser fixtures, while the
isolated `8d43ac22` lazy-import correction resolves neither and preserves the
same failure artifact. Both controlled calls complete within five seconds;
this proves removed startup work, not a universal timing guarantee. The
original failed local run is retained.

S48 remains partial. The diagnostic branch is not integrated into `dev`.
