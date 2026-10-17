# Full-application render-demand diagnostic: first integration failure

[Run 38451571754](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38451571754)
tests clean immutable `7d4a52a832cf80d49b7f2225e3132c6fb0d156c4` on hosted Linux
with SwiftShader. Root first passes 136 affected fixture, provenance, rollback,
UI and layer-state tests plus the 32-file no-undef check. This is not hardware
qualification.

The mixed-use smoke and durable workspace browser journey both pass. The smoke
includes one import, two workspace reloads, four source toggles, replay, archive
failure and camera recovery. Worker cold/reuse/error/recovery preflight passes,
and browser close completes normally. Its 21.864-second measurement remains a
short operation check: the retained report explicitly leaves stability pending
because there is no 60-minute run or final 30-minute retention window. These
are current scoped browser checks for the S49 rollback fix, not a plateau claim.

The new S51 probe then fails at `scene-settle` before static-frame measurement:
it calls `window.Cesium.Cartographic`, but the production application uses module
imports and does not expose that global. Both empty provider fixtures were
delivered and the application started at the expected commit. The run cannot
establish idle frame counts, settings equivalence, or the proposed runtime fix.

The failure report also exposes unclassified bootstrap API requests and two
unexpected external request attempts. They require source tracing and explicit
fixture handling. `networkProbePassed: false` was computed from a field that
must be checked against the actual network-probe return contract; it is not
being silently changed into a pass. Request counts include blocked attempts,
not successful live provider delivery. No thresholds or deadlines are relaxed.

Artifact **11841800400** has ZIP SHA-256
`4abad79a8c2a3c6dec848318151b865ffb2d7bb59bb7e2e968d1a3e5fba490a2`.
Its six explicitly named entries were verified before extraction. Raw logs
are compressed without content changes. [files.json](files.json) binds all
eleven retained evidence files, including the original failure and passing
operation report. The overall workflow remains failed.
