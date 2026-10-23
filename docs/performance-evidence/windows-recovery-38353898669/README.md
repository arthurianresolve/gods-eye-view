# Standard integration and Windows recovery at 495f0a71

[Run 38353898669](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38353898669)
passes all seven selected standard jobs at exact commit
`495f0a71821de28a3a06f7cc257c20f2b89ac052`: Node 24/26, Windows onboarding,
the browser journey gate, and install/update recovery on Linux, macOS and
Windows. Optional jobs are skipped and are not counted as passes.

The [Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38353898669/job/115152253278)
uses Node 24.14.0 and Chrome 152.0.7977.75 on Windows 10.0.26100, with an
Intel Xeon 6973P-C host (four logical CPUs, 17,174,360,064 bytes of RAM).
Rendering is explicitly SwiftShader WebGL-only; hardware validation is false.

The [raw profile-recovery report](profile-recovery.json), extracted from the
job's evidence log, is 14,754 bytes with SHA-256
`95fae5e0f3b0950c264f09eee9829eab4c9eab39ea5f638412ef019ed536cb22`.
Its source tree is clean before and after the run. The prior application is
`6b896e2a8277fba12bc9577ad7772005a71e13c7`.

All five stages pass: prior install, interrupted update, prior-install
rollback, upgrade, and failed-verification rollback/reopening. Each preserves
settings, the workspace bundle, one rendered feature and asset SHA-256
`0de37a471d02bb57a555ac30082025624f55ddc576d312db772d9deb62f66fcc`.
Browser close takes respectively 493.767, 389.090, 336.657, 461.780 and
365.871 ms. Every exit is natural with code zero; no forced termination is
used, and the five-second shutdown gate is unchanged.

This is standard integration/recovery evidence for the named commit. It does
not explain the earlier intermittent Windows shutdown failure, prove physical
GPU performance, or validate later visual-observer/async map-journey changes.
The separate native map workload remains failed in its own reports.
