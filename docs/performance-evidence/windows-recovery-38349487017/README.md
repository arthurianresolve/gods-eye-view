# Windows recovery at the map-wiring candidate

[Windows job 115138368132](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38349487017/job/115138368132)
passes on exact candidate `14472b5b58174c7755f900278962c067d3d60e61`, using
Chrome `152.0.7977.75` with the existing WebGL-only SwiftShader flags.

The [terminal standard CI result](ci-final.json) passes all seven selected
jobs at this exact revision: Node 24/26, Windows onboarding, Linux/macOS/Windows
recovery and browser journeys. Twelve unrelated optional jobs are skipped by
the selected mode. This result includes the corrected M3 wiring, but not the
later optional Chrome-version selector or scratch-path test correction.

All five stages preserve settings, workspace contents and the saved asset.
Each browser exits naturally with code zero in 270-429 ms, inside the unchanged
five-second gate. No forced process cleanup is used. The [review](review.json)
records every stage and the exact SHA-256 of the [report](report.json), which
is retained as its original compact job-log payload plus newline.

This passing observation does not explain or resolve the earlier intermittent
shutdown failures. It predates the optional Chrome-version selector and is
not hardware performance evidence. The native map workload fails separately
on the baseline in [run 38349484331](../s47-map-streaming/native-38349484331/README.md).
