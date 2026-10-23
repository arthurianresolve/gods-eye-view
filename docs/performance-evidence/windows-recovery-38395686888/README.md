# Windows recovery prerequisite failure: 38395686888

[Standard CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38395686888)
tests exact `d93f95b6285646169b241edfbf6af09b74f3d165`. The
[Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38395686888/job/115290194205)
fails before browser installation and the real profile recovery journey.

The run is terminal: six of seven selected jobs pass. Node 24.14.0, Node 26.x,
Windows onboarding, Linux recovery, macOS recovery and Street Level browser
validation pass; Windows recovery fails. The [run summary](run-summary.json)
records each job URL and result. Optional native and soak jobs were not run.
These results apply to the tested commit, not subsequent QA changes.

The prerequisite test group passes 68 of 69 checks. The failed test is
`PowerShell skips command-line queries when the owned root is absent` in
`scripts/performance/profileRecoveryPageOwnership.test.mjs:332`.
Its mocked `Get-CimInstance` script is launched with `powershell.exe` through
`execFileSync`, using a five-second subprocess timeout. It terminates with
`ETIMEDOUT` after 5,020 ms, with empty stdout/stderr. This output does not locate
the delay within process startup, script parsing or script execution.

The [unmodified job log](job-115290194205.log) contains 58,546 bytes, SHA-256
`5458afadd8cb08aa957bb5e3108f932187004b9b4bce4e6794d9445bc28bfc32`.
No profile recovery report was produced. This is separate from the historical
five-second Chrome shutdown failure; Chrome was not installed or launched by
the failed job's browser steps.

Root independently runs the same 41-check ownership test file on the available
Windows machine with Node 24.16.0: all pass, including the two actual PowerShell
script cases at 352 and 479 ms. That local pass does not explain the hosted
timeout or turn this run into a pass.

Correction `7542775e` (reviewed source `12a06902`) separates subprocess readiness
from mocked-script execution. PowerShell emits and flushes a readiness marker
before the test sends its script over stdin. Startup is bounded at five seconds;
the script retains its separate five-second execution limit. Failed termination
has a one-second close bound and remains unconfirmed if no close is observed.
Failures report the stage and elapsed startup, execution and cleanup separately,
without retaining script contents or command lines. Production process-inventory
and browser-close deadlines are unchanged.

Root independently passes all 74 recovery/shutdown prerequisite checks on
Windows Node 24.16.0, including the two actual PowerShell scripts. Deterministic
controls cover distinct startup/execution budgets, late readiness during cleanup,
hung execution, early/nonzero exits, spawn failure, output overflow, immediate
close and unconfirmed cleanup. This repairs the test's conflation of startup and
execution; it does not establish which stage caused the historical empty-output
timeout. The subsequent [hosted run at `feb067d3`](../windows-recovery-38401057945/README.md)
passes all prerequisites and all five actual profile recovery checks; its evidence
is kept separately from this failed run.
