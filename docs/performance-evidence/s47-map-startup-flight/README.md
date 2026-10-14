# Startup flight can overwrite the map route camera

Root reproduces the conflict at exact
`d93f95b6285646169b241edfbf6af09b74f3d165` with Node 24.16.0 and pinned
Cesium 1.138.0. This is a CPU-only ownership reproduction, not a browser,
rendering or performance acceptance run. [Recorded observations](replay.json)
include source identity and both camera poses for every control.

The reproduction constructs the actual Cesium `Camera` and `TweenCollection`
with the same ellipsoid, projection and 1440 x 900 viewport as the route. It
calls production `flyToAustin`, controls only its `setTimeout` with Node mock
timers, and samples the actual tween collection at zero and one second. Between
those samples it calls `setView` with the declared map route's 6,000 m pose.

| Startup state                  | Cancel active flight before setting route | Observed result after the next tween                                                      |
| ------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Flight already active          | No                                        | Route pose overwritten: approximately 23,475 m at the startup location                    |
| Flight already active          | Yes                                       | Declared route pose retained at 6,000 m                                                   |
| Startup callback still pending | Yes                                       | Delayed callback starts another flight; route pose overwritten to approximately 5,662.5 m |

Source inspection explains this behavior: the smoke navigates the bare app URL,
which schedules the default startup flight after 500 ms. The map driver then
calls `setView`; pinned Cesium's `setView` does not cancel an active flight.
The production startup disposer is registered for application teardown and does
not revoke its pending callback when another caller sets the camera.

`src/camera.js` is byte-identical in the tested QA source, current `dev`
(`e8ccc268`) and the frozen baseline (`eb8c682`). Its SHA-256 is
`44a93bc244a0f438b874a1606c4fbd2de5df82b03e88e5d3793cf253f0884649`.
This establishes an existing startup ownership defect and a harness exposure.
It does **not** prove that this conflict caused the prior hosted Metal failure:
that failed report lost the actual journey endpoints.

Reviewed correction `2d7c59ad` (source `0e6b2de0`) handles pending and active
startup ownership in the capture harness. It waits an owned 500 ms preparation
timer after the application tools expose the ready viewer/controller; controls
have already scheduled the production startup timer at that point. It then
cancels any active flight immediately before assigning the declared route pose.
Preparation time is recorded separately from the measured route. No application
rendering defaults, visual settings, populations, route tolerances or host,
readiness and cancellation deadlines change.

Cancellation during preparation waits for that pending interval before cancelling
the flight and draining the operation. The owned timer and abort listener retire
on completion. The success validator requires preparation and cancellation
evidence; historical v1 failure envelopes remain readable with absent additive
fields normalized to null. Supplied malformed values are rejected.

Root independently passes all 90 combined map, fixture-delivery, failure-report
and smoke checks, plus 25-file capture lint, formatting and diff checks. Actual
pinned Cesium Camera/TweenCollection controls reproduce the insufficient early
cancel and verify pending/active-flight cancellation. A serialized-driver control
verifies cancellation while preparation is pending, no late route write, no
remaining timer/listener and complete operation disposal.

The subsequent [native run 38404611321](../s47-map-streaming/native-38404611321/README.md)
passes strict camera and journey validation on the frozen baseline: the declared
6,000 m starting pose is retained, all four map states reach readiness, and the
full 60-second route completes with unchanged settings. The overall run still
fails because 83 imagery requests do not exist in the fixture manifest. The
candidate journey is not reached. This separates the corrected camera ownership
component from remaining imagery coverage and does not establish performance
improvement or retrospectively identify the historical failure's exact endpoint.
