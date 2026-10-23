# Native map journey command timeout

[Run 38354738080](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38354738080)
fails at exact candidate/harness `975318f6e35b1655e7cff6e1bd1a08427d3edf2b`.
Baseline is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. This is hosted
SwiftShader integration evidence, not hardware or paired performance evidence.

The [unchanged raw report](performance-build-smoke.json) is 6,954 bytes,
SHA-256 `436bc7195efba0a91a5bf9b7e1c42ba243a963c0bf1d814e873354e7fa33c495`.
GitHub artifact `11792760913` (`performance-build-smoke-38354738080`) has
archive digest `7da33188cac98c235599285feaa8bf79d7ca01ea781173ad0cee3515d10f3773`.

## Observed failure and source diagnosis

The baseline fails during `native-map-streaming-journey` with a
`Runtime.callFunctionOn` timeout. No completed journey or candidate capture is
present. Page and interception error lists are empty.

At this revision, `qa-performance-build-smoke.mjs` launches Puppeteer with a
15,000 ms protocol timeout. `runNativeMapStreamingJourney` awaits one
`page.evaluate` containing the entire route. The route alone is 60,000 ms,
before readiness work. These contracts cannot admit a successful journey.
This is an introduced harness defect. The report does not retain enough phase
detail to determine whether this attempt was still waiting for initial
readiness or had started moving; it does not establish a Cesium or provider
runtime defect.

The correction must start an owned page operation and observe it with bounded
short commands, preserving the route, readiness bounds and outer deadlines.
Failure, cancellation and late completion need explicit cleanup and bounded
phase evidence. A global protocol-timeout increase is not the proposed fix.

## Cleanup and limits

Probe cleanup misses its unchanged one-second deadline. Confirmation arrives
at 2,275.794 ms from the host stage start; hook restoration, two listener
removals, state deletion and render-loop retirement are then acknowledged.
This late acknowledgement does not turn the timeout into a pass. Future-page
script-registration removal was not attempted.

The owned context closes and fixture interception release is confirmed, with
zero remaining commands, preparations, abort subscriptions, late requests or
drain errors. Required ArcGIS metadata delivery is unproven because the
journey is incomplete. This failed run does not supersede earlier evidence or
complete M3, S47, S57 or S60.
