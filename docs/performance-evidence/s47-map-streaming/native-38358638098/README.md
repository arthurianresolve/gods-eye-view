# Native Esri transition readiness failure

[Run 38358638098](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38358638098)
fails at exact candidate/harness `0cae3037715bed96aa5f13085cb98f9a6397fbd5`.
Baseline is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. Hosted SwiftShader
is diagnostic only and cannot establish physical-hardware performance.

The [raw report](performance-build-smoke.json) is 7,347 bytes, SHA-256
`bf7c44c9f211b28fec0c02d69135da52860bd0f9bbb34fdd98527778dc96bcd6`.
Artifact `11793622363` (`performance-build-smoke-38358638098`) has archive
digest `104957dfe732d2c155cf20826294f1b0d4260404b793587a12b5688ed1cebac3`.

## Result

Initial photoreal readiness completes. The first Esri transition then reaches
an active `ArcGisMapServerImageryProvider`, native `CesiumTerrainProvider` and
ready map controller, without page or interception errors. This confirms
progress beyond the earlier trailing-slash metadata rejection. The journey
still fails its unchanged readiness deadline: `globeTilesLoaded` remains
false, so the required completed ready renders never arrive.

The failure checkpoint reports `transition-readiness`, zero completed
transitions and route elapsed time 45,276.9 ms. Host journey time is 51,629 ms.
No complete baseline journey or candidate journey is present; comparison and
performance acceptance remain false.

Operation disposal is confirmed. Renderer-probe cleanup completes within its
one-second limit (3.827 ms), including hook/listener cleanup, render-loop
retirement and future-document registration removal. The owned context closes;
interception release confirms zero pending commands, preparations,
subscriptions, late requests and drain errors. No cleanup error is reported.

## Remaining diagnostic gap

The pinned Cesium 1.138 `Globe.tilesLoaded` getter checks that all three
quadtree load queues are empty. A false value alone does not identify which
terrain or imagery stage is pending, or whether queued tiles are visible.
The current failure report also omits the finalized fixture delivery summary,
although the success report retains it. Successful response delivery, decoded
imagery, prepared terrain and rendered readiness must remain separate claims.

The next bounded diagnostic retains the existing delivery summary after
context retirement and samples read-only queue lengths, tile/terrain states
and imagery loading states. This is necessary before attributing the stall
to fixture coverage, workers, the renderer or upstream application behavior.
No readiness relaxation, deadline increase, forced rendering or detail change
is justified by this report. Earlier failures remain preserved independently.

## Reviewed diagnostic correction

`8001cb34`, integrated at `bfe6d5fe`, retains a bounded read-only globe queue
snapshot and the finalized delivery summary on failure. Queue evidence allows
eight tile samples and 32 imagery entries per tile, reports unsupported fields
as unavailable, and survives both CLI and outer failure serialization. Delivery
projection preserves partial, cancelled and errored outcomes independently of
the unchanged success validator. It runs after context-close/interception-release
finalization. No application behavior, readiness gate or deadline changes.

Root passes 80 focused map-capture, delivery, failure-report and outer-smoke
checks, the 25-file capture no-undef gate and four-file formatting. These checks
include controlled page/transport seams; they are not native rendered acceptance.

## Independent terrain CPU probe

The [reproduction](terrain-cpu-probe.mjs) invokes pinned Cesium 1.138 provider
parsing, mesh creation and child upsampling against the same fixture bytes.
It substitutes only resource delivery and TaskProcessor transport in its own
Node process, invoking the actual installed CPU worker functions directly.
Run from the repository root with:

```text
node docs/performance-evidence/s47-map-streaming/native-38358638098/terrain-cpu-probe.mjs
```

The [raw CPU result](terrain-cpu-probe.json) is 2,435 bytes, SHA-256
`8ef5e5fc71ee35de21d04061ba065e9ab70a44585f7d2e5e2ae57cc3d61a9c43`.
Both tested parents (levels zero and one) produce 289-vertex meshes. Their
available children upsample successfully; all six unavailable siblings fail
construction because the result lacks a horizon-occlusion point. The clipped
parent mesh has no geometry in these child quadrants.

This demonstrates a fixture/CPU upsampling problem, not yet the cause of the
hosted readiness failure. The probe uses source assertions; optimized browser
builds may omit those assertions. It does not exercise worker transport, GPU
rendering or actual quadtree traversal. The next hosted queue observation must
establish which stage and tiles remain pending before a runtime cause is claimed.
