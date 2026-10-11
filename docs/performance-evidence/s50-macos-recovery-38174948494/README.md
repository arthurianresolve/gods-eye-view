# macOS recovery teardown investigation

[Standard integration run 38174948494](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38174948494)
tested exact commit `0c7d678b8d9b9d8c3f65059bc46b888b7436e194`.
Node 24/26 tests/builds, Windows onboarding, Windows and Ubuntu recovery, and
the browser journey job pass. macOS recovery fails. See
[run metadata](run-38174948494.json) and the original JSON extracted from its
completed job's evidence markers: [profile-recovery.json](profile-recovery.json).

The final upgraded-application check retains matching settings, workspace
bundle, asset checksum and one rendered feature. The owned page closes and
zero pages remain. Browser.close is acknowledged after 31.69 ms, but the
five-second close deadline expires at 5003.47 ms. Disconnect is observed at
5113.32 ms and process exit at 5378.14 ms, after forced cleanup was attempted.
This is a failed natural-shutdown gate, not a successful recovery gate.
The available renderer is SwiftShader; this is not physical GPU evidence.

Two follow-up diagnostic dispatches did not run browser controls:

- [38175664689](run-38175664689.json), commit `022945de22e00274d0baa0f837403f07d67dd3a7`, used the newly selectable macOS runner but hit the script's Windows-only guard. Its renderer environment also did not match recovery.
- [38175738096](run-38175738096.json), commit `23426a4a71068a14771d8ee118897e249cf4ec5f`, corrected the environment but hit the same guard.

QA correction `ee45f9e1` replaces the Windows-only restriction with explicit
Windows/macOS/Linux platform validation and exact validation of the selected
full SwiftShader or WebGL-only SwiftShader launch flags. The CLI and report
validator share this contract. The five-second deadline, page ownership,
protocol acknowledgements, observed process exit and forced-cleanup rejection
are unchanged. Forty-nine focused tests pass, including all six platform/mode
combinations, mismatched flags, and POSIX cleanup success/failure/timeout.

[Matched macOS controls 38176078163](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38176078163)
are pending at this correction. Blank, WebGL and Cesium controls can distinguish
fixture teardown from whole-application behavior; they cannot by themselves
validate application recovery or establish a root cause.

Implementation status: diagnostic platform mismatch fixed. Automated status:
focused tests pass, whole-application macOS recovery remains failed. Hardware
status: no new physical GPU validation. Production dev remains `ba7c8738`.
