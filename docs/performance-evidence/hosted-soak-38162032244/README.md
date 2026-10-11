# Current integration soak: stable measurements, incomplete cleanup evidence

[Run 38162032244](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38162032244)
tested `fca2f991f493de80e73ea4c086609f9a084e4ea3` for 3,609,921 ms.
The [original envelope](report.json) was extracted unchanged from the job's
evidence markers; its SHA-256 is
`b55441b989b9f8e029ef8dd8eb18c485923273d2323f1aa82b3120c2b51fc383`.
[Workflow identity](ci-run.json) and [independent review](review.json) are retained.

All 252 cycles completed: 1,008 source toggles; 252 replay seeks, imports,
archive failures and camera recoveries; and 504 workspace openings. Independent
recalculation confirms that all 40 application resource gauges are identical at
all 13 post-GC checkpoints. Browser listeners remain at 629 throughout; worker
pending counts and oldest pending task ages are zero at every checkpoint.
Retained heap changes from 75,026,292 to 81,896,360 bytes. Maximum growth over the
final 30-minute window is 1.183%, below the unchanged 5% gate.

The original envelope has matching application/harness revisions and explicit
cleanliness flags, but no `browserClose` or `probeBrowserClose`. The harness
closed its initial browser directly, handed ownership to the soak driver, then
discarded the driver's close result. A successful workflow does not supply
those missing observations. Candidate ingestion correctly leaves this report
**pending**, although its recorded retention measurements pass.

Fix `7cea7aac9891d165a3c59bc09281bba735b71224` records both distinct browser
outcomes and rejects missing, failed or forced cleanup. The driver uses the
existing bounded five-second close helper; repeated disposal shares one attempt.
Primary measurement failures and partial reports survive secondary cleanup
failures. The manifest summary also keeps incomplete supplemental rows pending.
Eighty-four focused tests, scoped formatting and package boundaries pass locally.

A corrected frozen run is in progress in
[38167171204](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38167171204),
alongside [standard CI 38167173641](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38167173641).
Their outcomes must be reviewed before promotion. No historical report is edited
to fill the missing fields.

This is Chrome 152.0.7977.75 on free hosted macOS 26, Apple M1 Virtual with
Apple paravirtual Metal. It supplies supplemental accelerated retention
measurements, not physical Windows coverage, frame latency or GPU execution time.
Run `node docs/performance-evidence/hosted-soak-38162032244/review.mjs <fresh-directory>`
against a fresh directory containing the original report to reproduce the review.
