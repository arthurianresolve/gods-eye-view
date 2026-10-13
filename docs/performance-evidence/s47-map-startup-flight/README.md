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

Next correction must handle both pending and active startup ownership. A single
`cancelFlight` call cannot handle the pending case. A minimal share URL is also
insufficient: share restoration has its own delayed flight and applies visual
defaults. Preserve current visual settings and layer populations, and verify
baseline-compatible preparation independently before another native attempt.
