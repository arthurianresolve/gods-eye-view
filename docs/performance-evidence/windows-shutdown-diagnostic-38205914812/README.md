# Windows shutdown diagnostic: successful control

[Run 38205914812](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38205914812)
passes at exact revision `eac89bb80d7f7db8131d7ddd516b4112c146f278`
with the bounded shutdown diagnostic enabled. All five install/update/recovery
stages preserve settings, the workspace bundle and the reopened asset. All
browsers exit naturally with code 0, within the unchanged 5,000 ms gate.

| Stage | Natural shutdown |
| --- | --- |
| prior-install-saves-browser-workspace | 488.4 ms |
| interrupted-update-retained-application | 355.4 ms |
| prior-install-rollback-same-profile | 2194.3 ms |
| upgraded-application-same-profile | 324.9 ms |
| failed-verification-rolls-back-and-reopens-assets | 340.4 ms |

Before each close the target inventory contains only the browser target, with
zero page or worker targets. After disconnection it correctly reports
`unavailable`, rather than manufacturing zero counts. No timeout occurs, so
the process-tree snapshot before forced cleanup is not exercised by this run.
Executable PowerShell scope and timeout tests remain the automated coverage
for that path.

This verifies the successful-close integration of the optional diagnostic.
It neither reproduces nor explains the earlier
[shutdown failure](../windows-recovery-38203843444/README.md).
No unchanged rerun or longer shutdown deadline follows from this result; the
opt-in diagnostic remains available for the next observed timeout.

Environment: Windows Server build 26100, Node 24.14.0, Chrome 152.0.7977.75,
SwiftShader. This is hosted recovery evidence, not physical Windows GPU
evidence or final performance acceptance. The [raw report](report.json) is
18,140 bytes, SHA-256 `ca9debffd06a944c351e4f9e93060c9d2464c9ea29428681f6408c0da7c7a3f3`.
The [independent review](review.json) checks exact revision, all five stage
results, preservation, natural exits and the diagnostic availability states.
[CI metadata](ci-run.json) records the tested revision and job outcomes.
