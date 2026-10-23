# Corrected point-integration soak: passed supplemental retention gate

[Run 38167171204](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38167171204) tested application and harness `7cea7aac9891d165a3c59bc09281bba735b71224`, both clean and unchanged, for 3,608,613 ms. The [original report](report.json) is preserved byte-for-byte with SHA-256 `592f840d6dfeb8c649b692363a4df3b97018b260b1b9c0ccb30172780f51489d`. [Workflow identity](ci-run.json) and [independent review](review.json) are retained.

All 252 cycles completed: 1,008 source toggles; 252 replay seeks, imports, archive failures and camera recoveries; and 504 workspace openings. All 40 application resource gauges remain identical across 13 post-GC checkpoints. Browser listeners remain 629. Every worker has zero pending tasks and zero pending age at each checkpoint. Retained heap grows from 74,438,820 to 82,340,884 bytes overall; maximum growth over the conservative final 30-minute window is **1.937%**, below the unchanged 5% gate.

Both browser owners exit naturally: the initial probe in 915.7 ms and the application soak browser in 784.5 ms, within the existing five-second limit and without forced termination. The intact-envelope manifest reader accepts this row as passed supplemental evidence. Its overall physical-hardware outcome remains pending. Earlier reports lacking cleanup observations remain incomplete; they are not retroactively relabeled.

This is Chrome 152.0.7977.75 on free hosted macOS 26, Apple M1 Virtual / Apple paravirtual Metal. It proves this fixture's retained-resource and cleanup result, not physical Windows coverage or full-scene motion improvement. Runtime sources are unchanged from this tested commit through the documentation/test-registration integration; [all seven standard jobs at 806d4d3c](../import-point-current-dev/validation-38168624015-ci.json) pass, including Node 24/26, three-OS recovery, onboarding and the browser journey.

The point collection application integration is accepted within those limits. Full S47-S60, Windows GPU evidence, large single-feature preparation, paired scene performance and final candidate validation remain unfinished.

Reproduce with `node docs/performance-evidence/hosted-soak-38167171204/review.mjs <fresh-directory>` containing the original report. The independent script checks exact provenance, cleanup, every gauge, GC checkpoints, worker ownership and the final-window calculation.
