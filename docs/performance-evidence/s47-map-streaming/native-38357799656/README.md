# Native Esri metadata route mismatch

[Run 38357799656](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38357799656)
fails at exact candidate/harness `4385f69b501cd647a9c8dd50aba5713848625502`.
Baseline is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. The renderer is
hosted SwiftShader; this report cannot establish hardware performance.

The [raw report](performance-build-smoke.json) is 7,026 bytes, SHA-256
`94f3af8c5be71ad24b4f8a70dd95f891f63c169fc5a7e7a9ba01cecf1b3c22dd`.
Artifact `11794255841` (`performance-build-smoke-38357799656`) has archive
digest `6db022598c7a739e8f9b502baec3de30bd626dbdab2f0fd1ee4754d079276990`.

## Result

The asynchronous journey passes initial photoreal readiness and reaches the
first Esri transition, then fails with `arcgis-route-invalid` from the fixture
adapter. Host journey elapsed time is 24,665 ms. The saved failure envelope
retains the transition phase, initial-readiness completion, expected terminal
state and confirmed operation disposal. No complete route or candidate
capture is present.

The phase checkpoint's route elapsed time is sampled when the transition is
scheduled, not at failure. It must not be interpreted as the actual switch
time or compared directly with the host journey duration.

Renderer probe cleanup completes within its one-second limit (7.522 ms),
including hook/listener cleanup, render-loop retirement and future-document
registration removal. The owned context closes and interception release
confirms zero pending commands, preparations, subscriptions, late requests
and drain errors. Delivery validation remains failed because the adapter
rejects a native request; successful lifecycle cleanup does not erase this.

## Independently reproduced cause

Installed Cesium 1.138 calls `Resource.appendForwardSlash()` inside
`ArcGisMapServerImageryProvider.fromUrl`, then derives a metadata request with
`f=json`. Root invoked that actual provider method with a scoped metadata
transport seam feeding the real `fixtureRequestCommand` and delivery adapter.
It produced:

```text
https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/?f=json
```

The current adapter accepts metadata only at the exact path without the final
slash. The actual provider invocation fails with the same `arcgis-route-invalid`
error as the hosted browser. No network request is needed for this reproduction.
This is an introduced fixture-adapter defect, not evidence of an upstream
application outage. The next correction admits the exact native metadata
path while retaining strict query, host, method and byte-acknowledgement checks.

The previous command-timeout result remains failed. This newer run demonstrates
progress beyond that limitation and functioning failure retention, but M3,
paired map performance and physical Windows acceptance remain incomplete.

## Reviewed correction

`88e5266c`, integrated at `8c7f1204`, accepts the exact trailing-slash metadata
path as well as the existing no-slash alias. It changes no other routing rule
or application behavior. The regression calls the actual pinned Cesium
provider, sends its generated metadata URL through the real interception
command and delivery callbacks, and verifies acknowledged fixture bytes.
Doubled/escaped paths and duplicate/extra query parameters remain rejected.

Root reproduces the original failure above, then passes 73 focused tests with
the correction, the 25-file capture no-undef gate, changed-file formatting and
diff checks. This validates the adapter repair as a component. The next hosted
native run must still complete both production journeys and cleanup.
