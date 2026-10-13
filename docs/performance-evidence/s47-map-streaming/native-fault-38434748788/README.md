# Native fault controls: stale preparation frame

[Run 38434748788](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38434748788)
at `e701e0ff792a19f2f2c6fc1d25efce56c815c3b0` remains **failed**. The free hosted
macOS diagnostic completed healthy baseline/candidate map journeys and candidate
CLI capture. This is not physical Windows qualification or a performance result.

The missing-metadata control now **passes its complete outer validation**:
automatic OSM fallback, explicit Esri retry, fixed visual/camera settings,
receipt-derived worker code and native-renderer checks, and owned cleanup. Its
initial/fallback/retry completed-frame sequences are 7/34/58. This confirms the
terrain-stage correction for that scenario without changing the earlier result.

The corrupt-metadata control reaches OSM fallback and Esri retry, but its initial
snapshot is from the startup camera: longitude -97.7431, latitude 30.2672,
height 24094.83 m. Later snapshots use the required route longitude -97.72,
latitude 30.27, height 6000 m. The strict fixed-camera validator rejects this
control. Worker validation and context/interception cleanup still complete.
The superseded-response scenario is not reached.

The page owner registers its render observer before waiting through the 500 ms
startup-flight interval. It then sets the route camera but leaves the last
startup snapshot cached. The host's initial readiness predicate checks provider
readiness without a post-positioning render boundary, so it can accept that old
snapshot before the requested frame arrives. This is an ownership/freshness bug
in the new harness, not evidence that corrupt metadata moved the app camera.

Reviewed corrections `c2f028ca` and `fe28df76c28ac97b248921165b6862b7bded801a`
(Luna sources `ad56f72344785e4d7bdb41a0da52af42617a5b61` and
`1f78f46c9254db21afad9a1dd6a7d8e654cf5cd4`) invalidate the cached preparation
snapshot and require an initial completed render strictly newer than camera
positioning. The page also refuses to start the first Esri switch before that
frame. Camera, visual, timeout and delivery checks remain strict.

Root passes all **100/100** affected page, delivery and outer tests, plus changed
formatting and capture lint. The deterministic regression emits a startup frame
during preparation, delays the requested render, observes no eligible snapshot,
and confirms switching is blocked until a separately delivered new frame.
The validator also rejects a frame at the pose boundary. A fresh all-scenario
run is [38436364036](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38436364036)
at `fe28df76`. Its result is separate; this report is never relabeled as passed.

Original artifact `11833895036` is preserved without conversion:

| File                                                                                   |  Bytes | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Outer report](performance-build-smoke.json)                                           | 603358 | `bf9dbafc1badf6bab2111d593854981e3979dcfba0b8c5df8c4cabce30062806` |
| [Candidate CLI report](performance-build-smoke.json.capture-cli-report-candidate.json) | 378534 | `913fd679bca93344bbb1db5b78d3d8eea4947dad080f9d0b824402d59e15703f` |
| [Correction test log](fix-focused-tests.log)                                           |   9798 | `ac5eba922498933d0550fd11df61101f6b7ad9c196a243586ada493508e1997d` |
