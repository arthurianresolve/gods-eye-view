# Windows dependency and frame-delivery diagnosis

Application and harness: `19b0cb60c47f8161a4c07855d0343d43cccc30c8`.
Chrome 154 on the available Windows Intel UHD 620/D3D11 machine. These are
diagnostics, not performance or soak acceptance. Neither run completes the
Entity/collection comparison.

The original [failure](failed-report.json) reports a stopped render loop after
`renderState.lineWidth is out of range`. Browser console output also reports a
maximum texture size of zero. The preserved [dependency graph](dependency-graph.json)
shows Cesium/engine and widgets in different canonical installation directories,
and two `ContextLimits` modules in the optimized Vite bundle. Separate engine
module instances own separate capability tables; equal package versions do not
make them share initialized limits.

A new detached worktree at the identical commit received its own real
`node_modules` via `PUPPETEER_SKIP_DOWNLOAD=1 npm ci --no-audit --no-fund`.
The existing hash-pinned Cesium patches applied successfully. No shared
dependency junction was modified. The [isolated graph](isolated-dependency-graph.json)
has one engine and one optimized `ContextLimits` module. Reloading the same
Chrome tab at the same URL removes the observed rendering exceptions.

The [isolated run](isolated-report.json) still fails a 400 ms capture: zero
updates and zero completed renders, although the default loop remains enabled,
the page remains visible/focused, and there are no scene errors. The capture
limit and visual settings were unchanged. This establishes a second failure
that the dependency correction does not resolve.

The independent [WebGL control](webgl-frame-control.json), with no Cesium,
delivers 40 callbacks in five seconds and a 1,016 ms maximum gap. Its timer
heartbeat continues normally (250 ticks, maximum 26 ms gap). The [plain rAF
control](plain-frame-control.json), with no WebGL context, delivers 296 callbacks
and a 74 ms maximum gap. Both report visible/focused pages and no context loss;
desktop occlusion is unverified and the canvas is partly outside the viewport.
These single diagnostic observations narrow the remaining issue to graphics
frame delivery, but do not establish a driver defect or justify extending the
capture deadline. Further matched controls and actual Windows acceptance remain
required. No Cesium rendering limits were overridden.

Later filesystem inspection found the shared main dependency directories were
real directories again; the process responsible for that external change is not
established. The preserved before/after observations and isolated installation
remain the evidence, rather than a claim about the current shared tree.
