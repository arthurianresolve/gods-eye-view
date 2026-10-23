# S58 post-process stage census

Run `node scripts/performance/s58PostProcessStageCensus.mjs` to emit a source-
bound JSON census. The harness invokes the production `VisualSettings.setStyle`
selection method against a test-owned UI boundary, the production `VisualEffects`
owner, and real Cesium 1.138 `PostProcessStageCollection` / `PostProcessStage`
objects. It samples initialization, normal-to-noir, the noir-to-thermal
crossfade, settled effects, and stage retirement. It records the SHA-256 of the
fixture descriptor, relevant UI source files, lockfile, harness source, commit,
and worktree state.

The deterministic observation has six owned style stages and one owned
sharpen stage. The noir-to-thermal crossfade intentionally enables both style
stages; after it settles, thermal is the only enabled style stage. Sharpen and
Cesium's borrowed bloom stage are separately reported in the final state.
Thermal's animated time uniform keeps the existing `style-anim` render hold
and one scheduled animation callback alive until `destroy()`. Destruction
removes the seven owned stages, cancels that callback, releases the hold, and
restores bloom's prior settings. An injected extra enabled style is rejected
by the same validator as a duplicate-contribution negative control.

The check does not call `PostProcessStageCollection.update()`, create a WebGL
context, render pixels, compile shaders, or count GPU passes. Enabled stages
and setter activity are not GPU measurements. It therefore supports a narrow
no-change decision for stage removal: the controlled selection has the
expected crossfade overlap and a single settled style contribution, while
there is no rendered evidence that another stage is redundant or safe to
remove. No stage, effect strength, shader, or weather setting was changed.

The existing wind-image reuse remains a separate accepted result: three
five-pair comparisons preserved exact raster bytes, and the hosted Metal
capture preserved 1,200 paths and 152,736 vertices. See
[`docs/PERFORMANCE.md`](../../PERFORMANCE.md) and
[`s58-weather-image-ownership`](../s58-weather-image-ownership/README.md).
Weather/wind provider transitions, pause/resume, reduced-motion behavior, map
host changes, rendered colors/opacity, and physical GPU pass counts are outside
this stage-owner census; they remain explicit S58 validation requirements.

Focused validation:

```powershell
node --test scripts/performance/s58PostProcessStageCensus.test.mjs
```

[Root validation at `8d9d79bd`](root-8d9d79bd/README.md) retains the clean-source
census and passing effect/config/discovery checks.
