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
pass all six controls at exact `ee45f9e1f55359cce14315b577f034d8fb77323f`.
[The retained report](shutdown-38176078163.json) passes independent validation:
blank closes in 1586/1597 ms, WebGL in 377/368 ms, and Cesium in 2356/132 ms
(normal/navigation-first). Every process exits naturally before the unchanged
five-second deadline. The small fixtures do not reproduce the application failure.

[WebGL-only controls 38176248222](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38176248222)
also pass at `496f75f4b444a2996e7da7e70965085ce6ce8eca`; the intervening commit
changes documentation only. [Their retained report](shutdown-38176248222.json)
passes independent validation with identical fixture and Cesium bundle digests.
Normal/navigation-first closes take 390/149 ms for blank, 292/190 ms for WebGL,
and 214/248 ms for Cesium. These are single diagnostic controls on separate
hosted jobs, not a repeatable application performance comparison or root-cause proof.

QA workflow `af704b60` makes the existing isolated recovery mode select the
same OS and software backend as the controls while retaining ordinary matrix
defaults. [Whole-application recovery 38176373283](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38176373283)
tests WebGL-only SwiftShader on macOS at that exact revision and passes all five
stages. [The complete report](recovery-38176373283.json) retains matching
settings, workspace bundle, imported asset digest and rendered feature count
through prior install, interrupted update, rollback, upgrade, and failed
verification. Natural closes take 290, 187, 121, 151 and 123 ms; every process
exits with code zero and no forced cleanup.
Blank, WebGL and Cesium controls cannot substitute for application recovery.

Follow-up `46ed790b` extends the existing ordered renderer comparison to the
three supported operating systems, rejects mixed/unsupported platform evidence,
and retains the platform in its result. Forty-one focused tests pass. The
[AB/BA macOS comparison 38176631829](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38176631829)
passes on this frozen revision in both driver/WebGL and WebGL/driver orders.
The independently recomputed [AB packet](renderer-38176631829/AB-packet.json)
and [BA packet](renderer-38176631829/BA-packet.json) show 57.93% and 49.28%
lower median boot-plus-query time, respectively. All five recovery stages
improve in both orders. Raw driver and WebGL reports are retained alongside
each packet. Every process closes naturally within the unchanged five-second
deadline; WebGL-only closes take 83.5-430.4 ms. Protocol acknowledgements,
disconnects, process exits, settings, workspaces and asset digests all pass.

The QA workflow now selects WebGL-only SwiftShader for ordinary macOS recovery
and matching shutdown controls. Windows keeps this backend and Linux keeps its
existing full-driver backend. The ordered experiment still supports both modes.
This remedies the measured configuration cost; it does not prove a specific
Chrome/ANGLE defect.

[Standard CI 38177697638](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38177697638)
passes all seven jobs at exact `501aa8d8e52d1b7f92d02fbcbf9de6cb1feadb46`.
[Run metadata](standard-38177697638/ci-run.json) and raw recovery reports for
[Windows](standard-38177697638/win32.json),
[macOS](standard-38177697638/darwin.json), and
[Linux](standard-38177697638/linux.json) are retained.
[Independent review](standard-38177697638/independent-review.json) verifies all
15 persisted-workspace stages and natural browser exits. macOS closes take
209-249 ms; Windows 304-557 ms; Linux 317-709 ms. All retain the unchanged
five-second deadline. This supplies the required integration CI evidence.

Implementation status: diagnostic platform mismatch fixed. Automated status:
focused tests and the alternative-backend macOS recovery pass; the original
full-driver failure remains recorded; both counterbalanced sequences pass. Hardware
status: no new physical GPU validation. Integration is eligible for promotion
from the previous dev checkpoint `ba7c8738`; full S47-S60 acceptance is pending.
