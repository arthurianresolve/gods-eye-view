# Windows recovery prerequisite failure: 38395686888

[Standard CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38395686888)
tests exact `d93f95b6285646169b241edfbf6af09b74f3d165`. The
[Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38395686888/job/115290194205)
fails before browser installation and the real profile recovery journey.

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

Next: separate subprocess readiness from mocked-script execution in the test
evidence, retaining bounded subprocess cleanup and functional assertions.
Do not change production browser close or process-inventory deadlines, skip the
Windows tests, or claim a root cause from the empty hosted output.
