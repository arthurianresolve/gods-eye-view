# Standard integration at c7c47245

[Run 38430700214](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38430700214)
passes all **seven selected jobs** at
`c7c47245f96e4839312983e8bcbba1da57948b4e`: Node 24.14.0 and 26.x suites/builds,
Windows onboarding, Street Level/browser journeys, and installation/update
recovery on Windows, Linux and macOS. Unselected diagnostic jobs remain skipped.
[Original job metadata](run.json) and [artifact verification](verification.json)
record the exact revision and hashes.

Each original [Windows](windows/profile-recovery.json),
[Linux](linux/profile-recovery.json) and [macOS](macos/profile-recovery.json)
report passes all five checks: saved prior-install workspace, interrupted update,
rollback using the same profile, upgraded app using that profile, and failed
verification followed by rollback/reopened assets. Settings and workspace bundles
match in all fifteen cases. All owned browsers close normally without forced
termination. These are hosted recovery checks, not hardware-rendering evidence.

The Windows prerequisite and full browser recovery pass at this exact candidate.
The earlier PowerShell startup timeout at `4b60f453` remains failed, and its
historical cause remains unresolved; this pass does not establish a root-cause
fix. No timeout was increased to obtain it.

This revision contains the reviewed main merge and the initial outer map fault
runner. The [separate native run fails at a new harness navigation bug](../s47-map-streaming/native-fault-38430980703/README.md).
The URL correction and later S50 runtime change are **not** covered by these
seven passes. Their containing candidate is `dddef9eb66357394f596fad028fb671b9263abf3`,
with new [standard CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38432856926)
and [native map validation](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38432631061).
Those results must be evaluated independently before promotion. Dev and VM105
were not changed in this checkpoint.
