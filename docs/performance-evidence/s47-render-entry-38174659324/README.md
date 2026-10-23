# S47 dispatch failure and render deadline correction

[Run 38174659324](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38174659324)
stopped during setup because the dispatch omitted `candidate_sha`. The optional
workflow input was passed as an empty required CLI value. The original report
is retained in [performance-build-smoke.json](performance-build-smoke.json).
This run exercised no browser or rendering behavior and remains failed.

QA commit `ac22669edbf07ad44a6927b979757f0fa9266685` separates callback entry
(five-second host bound) from rendering (unchanged five-second page bound),
with a separate one-second result delivery allowance. The page checks actual
monotonic elapsed time on `postRender`, rejecting an overdue frame even when
its timer callback has not run. Per-call IDs reject old boundary events;
listeners and timers are released on success and every failure. Non-verbose
capture emits only the entry signal at the held, unmeasured boundary.

Thirty-seven focused checks pass, including delayed host/page timers, late
protocol rejection, duplicate/obsolete events, missing timing evidence, and
bounded diagnostic storage. Adopted formatting passes for 1,544 files.

[Replacement run 38174825435](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38174825435)
explicitly names application/harness `ac22669e`. It completes three samples,
then rejects a genuinely late page frame; [the separate result](../s47-separate-deadlines-38174825435/README.md)
remains failed. Follow-up workflow-only
commit `bddde802` makes an omitted candidate resolve to the dispatched immutable
`github.sha`; it does not change the page or capture implementation being tested.
