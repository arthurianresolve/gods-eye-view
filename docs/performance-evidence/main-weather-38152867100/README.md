# Main integration and accessibility validation

Candidate `7ef32a74afc7574d5fcad0dc19d2b4b33c49e815` passes all seven standard
jobs in [CI run 38152867100](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38152867100).
The [complete job record](run.json) binds the result to that revision. This
candidate integrates main `591f299d11f38a612629a274463196d57ae3862e` with the
accepted weather bitmap cleanup on dev `a14ebe8` and corrects the accessibility
journey's panel-opening procedure.

Main brings explicit optional catalog/source composition, Street Level provider
switch persistence in shared state, separated route/recent-imagery acquisition,
and authoritative empty vessel coverage handling. The merge preserves the
published development history.

## Reviewed automatic evidence

- Node 24 and 26 unit suites, production builds, formatting and package boundaries
  pass, as do Windows onboarding and every standard browser journey.
- All 15 installation/recovery checkpoints preserve settings and complete
  workspace bundles. Each leaves zero owned pages before a normal browser exit;
  none requires forced termination. [Windows](windows-recovery.json) close times
  range from 341.4 to 3,109.0 ms, [macOS](macos-recovery.json) from 562.5 to
  1,698.7 ms, and [Linux](linux-recovery.json) from 174.1 to 666.8 ms, all within
  the existing five-second deadline. These runners use Chrome 152/SwiftShader.
- The corrected [accessibility journey](accessibility.json) checks 61 computed
  accessible names: seven inspector, 35 workspace-library and 19 timeline
  controls, including SAVE QUERY. Nine scoped status elements are present.
  Keyboard discovery and focus restoration pass. The command palette fits the
  720-CSS-pixel viewport without horizontal content overflow.
- [Published layer tokens](layer-tokens.json) pass locally against both frozen
  main and dev refs: 29 published tokens and zero additions. The workflow's
  pull-request-only token step is skipped, so this is not a representative PR run.

Recovery JSON files are exact downloaded artifact bytes. The accessibility JSON
is the exact pretty-printed report from the completed job log after removing
the runner's per-line step/timestamp prefix. Successful browser artifacts were
not uploaded by this workflow, so no independent screenshot review is claimed.
Hashes and review scope are recorded in [review.json](review.json).

## Limits and previous failures

The earlier [integration failure](../main-weather-38151528050/review.json) remains
failed evidence. The new panel-controlled procedure passes, but the older log
did not preserve enough AX state to prove that automatic panel collapse caused
its missing-name result. The previous Windows browser shutdown timeout is also
unresolved; a later successful close does not identify its cause or establish a
permanent fix.

The integration is accepted for dev on its automatic gates. Physical Windows
frame delivery, current-candidate GPU comparisons, the 60-minute retained-memory
plateau and human accessibility/usability reviews remain pending. No complete
performance slice, performance target or release-readiness claim follows from
this integration run.
