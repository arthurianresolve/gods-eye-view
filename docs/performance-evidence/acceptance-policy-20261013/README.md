# Performance objective reporting matches the amended contract

The [13 October acceptance policy](../../CESIUM_ACCEPTANCE.md) keeps the proposed
20% dense/tracking objective separate from integrity, no-regression and available
hardware qualification. The original candidate evaluator rejected valid evidence
solely for missing this target, and counted dense tracking as covered only when
the objective was achieved. Both behaviors contradicted the original target's
nonmandatory status.

Correction `6f635ecdfbaad7cda4fc651a3b7b5372f4e0ea6a`, implemented by GPT-6 Luna
as source `4e4127f547663ed7df7d1d43e8debef60b04d270` and reviewed by root, adds:

- Explicit policy ID `gev-cesium-acceptance/2026-10-13` in computed comparison
  evidence and candidate reports.
- Dense motion and selected tracking actual improvement percentages, each marked
  achieved, missed or unassessed; candidate summaries retain these outcomes.
- Tracking coverage from the complete validated tracking measurement, independent
  of whether the 20% objective is reached.
- Required missing measurements remain pending, and regressions above 10% remain
  failures. Renderer, artifact hashes, exact commit, malformed reports, missing
  workloads and retention validation retain their existing checks.

Root independently passes all 73 tests across `candidatePerformanceEvidence`,
`pairedReport`, `soakStability` and `qa-candidate`. The new cases exercise a
complete primary-Windows fixture with both targets missed that passes comparison
qualification while reporting those misses, target achievement, actual >10%
regression, missing tracking/dense measurements and software-only insufficiency.
These are controlled evaluator fixtures, not new hardware measurements.

Exact-commit standard integration is pending. No historical raw result was
rewritten, no target was marked achieved without measurement, and no current
candidate was certified or published by this change. Later recomputation uses
the explicit new policy and is a separate evaluation, not a replacement for an
older report.

A separate test-only follow-up `e33ae721` (Luna source `032f1653`) retires only
its own recorded temporary fixture directories after the test module finishes.
Luna's 52-test run passes with no additional retained matching directories;
pre-existing directories remain untouched. Root reviews this ownership change,
passes the 25-file capture lint, changed-file formatting and package boundaries.
An attempted cleanup of this session's already-retained temporary directories
was blocked by automatic approval policy; no such directories were removed.
This does not affect repository or application state.
