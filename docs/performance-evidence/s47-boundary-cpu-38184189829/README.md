# Provider-boundary CPU diagnostic

[Run 38184189829](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38184189829)
tests immutable application and harness `94ab2536c93a964da34e0d63e771b0d357703e8c`
with opt-in CPU profiling and the prewarm worker audit. The
[full report](report.json) remains failed. No performance acceptance is claimed.

The first idle sample enters its measurement-boundary callback promptly
(3.83 ms), but `preUpdate` arrives about 4,835 ms after the host start and
`preRender` about 4,842 ms after it. No completed-render result arrives within
the unchanged 5,000 ms deadline plus 1,000 ms protocol grace. The host reports
failure at 6,004.68 ms. The warmup render completed, but its CPU profile is
unavailable because `Profiler.enable` exceeded its separate two-second bound.

The [measurement profile](render-boundary-02-measurement-boundary.json) remains
available despite the render failure: 204 nodes and 5,516 samples over a
7,040.492 ms profile window. [Independent review](independent-review.json)
verifies the raw bytes, SHA-256, sample/node references and exact recomputation
using the committed normalizer.

| Leading sampled location | Statistical sample weight |
| --- | --- |
| `readPixels` | 3,073.6 ms |
| `(idle)` | 1,712.3 ms |
| `getProgramParameter` | 1,354.0 ms |
| `(program)` | 789.0 ms |

The retained parent chain leads from HUD `_updateSummary` and `_summaryContext`
through basemap view-target resolution to Cesium `pickPosition` and `readPixels`.
This identifies an application-owned synchronous depth-read path for inspection.
It does not establish exact CPU execution time, GPU time, or causal alignment
with the boundary events: the two clock domains were not explicitly aligned.
Shader-program queries also have substantial sampled weight and multiple caller
paths, so this profile does not identify one shader or task as their cause.

The outer smoke observes hosted SwiftShader; its failed child does not reach a
final environment snapshot. This software-rendering diagnostic cannot explain
the separate Windows minimal-WebGL scheduling stall, which occurs without
Cesium or the HUD. Next work should preserve the displayed location/interaction
semantics while investigating redundant HUD depth reads, then compare the
specific change on the same fixture. Missing warmup data and the failed frame
deadline must remain explicit.
