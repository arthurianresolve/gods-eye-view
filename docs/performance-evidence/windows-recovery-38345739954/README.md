# Expanded-inventory CI and Windows recovery

[Standard CI run 38345739954](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38345739954)
passes all seven selected jobs at QA commit
`ae4de36512da7222b6da60f8e5fb03a4eddc3ac6`: Node 24/26, Windows onboarding,
Linux/macOS/Windows installation recovery and browser journeys. The
[completed job record](ci-final.json) preserves the exact revision and steps.
This includes the newly discovered server test suites and the integrated native
map delivery adapter; it does not include the unmerged M3 production driver.

The [test-inventory audit](server-inventory-review.json) matches all 19 server
test pass markers to source at the tested commit in both Node job logs. Each
Linux parallel suite reports 7,565 passes, zero failures and three Windows-only
skips. The native Windows permission test passes in the onboarding job. The
two PowerShell ownership/filter tests pass locally under Node 24.16.0 using
unchanged source and test-provided CIM responses; they do not observe live
browser shutdown. The calibrated allocation probes run separately under
Node 24 (14 passes) and are explicitly skipped under Node 26.

All five Windows profile stages preserve settings, the workspace bundle and
the saved asset. All five browser processes exit naturally with code 0 in
304-599 ms, within the unchanged 5,000-ms close gate. No forced cleanup is
needed. The run uses Chrome 152.0.7977.75 with WebGL-only SwiftShader on hosted
Windows; it is not physical GPU evidence.

This passing run does not establish the cause or correction of the intermittent
shutdown failures. The [earlier failure](../windows-recovery-38341548120/README.md)
remains failed and relevant. No map-streaming performance claim or deployment
follows from this result.

The [raw report](report.json) preserves the exact QA_EVIDENCE payload plus its
final newline: 14,723 bytes, SHA-256
`2843aeb90e326f5add2310e5ad8274b878a74f9191686d4732e4861835a7b764`.
The [independent review](review.json) records each persistence and shutdown
observation separately.
