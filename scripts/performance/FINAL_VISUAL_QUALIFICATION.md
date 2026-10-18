# Final visual qualification

`finalVisualQualification.mjs` validates a completed baseline/candidate report
for the narrow S65/S66 control. The caller owns browser setup and must use the
existing CCTV fixture, completed-render observer, foreground proof and teardown
contracts. It records four fixed states: `still-settled`, `hud-visible`,
`hud-hidden`, and `hud-restored`.

After each caller-observed completed render, use the owned debugger session in
`captureWithDebuggerPause` to observe and copy the settled frame. Its screenshot
callback calls `captureQualificationPng(page, outputPath)` to write a lossless,
bounded PNG. The report must include the exact
application and harness SHAs, build receipt hashes, native-sharpness-v1
environment/profile, Intel UHD 620 renderer identity, fixed camera/populations,
foreground and completed-render evidence, and both PNG records for every state.
Masks are forbidden. Validation requires decoded RGBA pixel equality (with the
explicit, bounded repeated-control rule below), matching
dimensions, containment under the report evidence root, and confirmed browser
teardown for both revisions:

```powershell
node scripts/performance/finalVisualQualification.mjs path\to\report.json
```

Missing or contradictory evidence fails validation; it is not converted to a
pass or an inconclusive visual claim.

The default validator remains bit-exact. The producer explicitly records
`matched-visible-control-variance-v1` for one narrowly observed browser effect:
seven rounded source-badge corner pixels varied by at most 9/255 in RGB, both
between and within the unchanged revisions. All other pixels matched. Under
this policy, the visible and restored controls must each match exactly across
builds. Each initial still must equal one **entire** control image from its own
build, and those controls must retain identical settings, populations, camera,
timestamp and HUD summary. Their within-build variation is bounded to ten pixels,
at most 10/255 per RGB channel, with no alpha changes. Hidden HUD still requires
exact equality. A new pixel change, even inside the small varying area, fails
unless the whole image independently occurred in that build's control. No
coordinates are masked, no pixels are modified, and the accepted variance is
reported with all pixel values. Earlier bit-exact failures stay in the ledger;
offline consumer revalidation records its own revision separately from capture.

`runFinalVisualQualification.mjs` owns the two sequential headed Chrome runs.
It executes from its declared clean checkout, records its own producer commit
separately from the frozen application/build harness commits, and verifies
served build receipts before and after the runs. Run it only after latency
measurements finish, using separate output storage and the hardware Chrome
executable through `PUPPETEER_EXECUTABLE_PATH`.

The narrow `qa-cctv-still-hud-v1` fixture reuses the CCTV lifecycle source and
frame bytes, with a declared 2,000 m top-down view so the projection is visible.
It freezes the wall clock at 2026-10-08 12:00 UTC and seeds fixture-only random
values before application boot. Browser animation timers and rendering remain
active while the scene settles and between snapshots. The viewport is 1440 by
900 CSS pixels at the actual device pixel ratio;
Manual/DENSE/75%, native scale, SSE 1 and MSAA 4 remain unchanged.

Before activating CCTV, the producer waits for `globe.tilesLoaded`, observes
a completed render, and rechecks readiness in the activation task. This is
essential because the production camera performs one obstruction probe at
activation. A probe against unfinished surface geometry latched different
projection distances on repeated runs of the unchanged baseline. Waiting only
before the screenshot was too late. The report retains the pre-activation
render and readiness proof; the real obstruction query and resulting geometry
remain unchanged. A missing surface or failed activation fails qualification.

A read-only observer waits for the real summary typewriter to finish and the
REC indicator's visible phase. An owned CDP session dispatches a separate
`debugger;` evaluation task, then pauses JavaScript delivery and samples the
detection canvas's existing scanline phase at both
edges. It captures only phase zero, with settled HUD content, and checks both
observations again before resuming. It does not edit canvas pixels, styles,
animation parameters or application timers. The validator independently derives
the phase from eight raw alpha rows, checks their CSS-to-native-pixel mapping,
and rejects missing, contradictory or changed evidence.

This bounded pause addresses a measured fixture limitation: ordinary PNG
capture on this machine took 1.7–1.9 seconds, longer than the HUD's 800 ms REC
blink. The first unpaused attempts remain failed evidence. Wall-clock freezing
alone does not synchronize the canvas scanline, which uses `performance.now()`.
The paused control verifies settled appearance only. Existing timer/lifecycle
tests, unpaused workload runs and the soak verify behavior and cadence; paused
capture timings are never performance evidence.

The pause begins at the new evaluation task boundary. Interrupting arbitrary
JavaScript with `Debugger.pause` can stop Cesium during rendering and block
the compositor needed for a screenshot. The unchanged baseline hit that
15-second capture deadline; a separate baseline diagnostic captured the full
2880-by-1800 image at the task boundary in 1.84 seconds. That diagnostic proves
capture feasibility, not paired visual acceptance. Failed earlier captures
remain failures and the capture deadline remains unchanged.

At most 12 eligibility attempts and three PNGs per state are permitted. Every
attempt is retained, including its observed phase and cleanup result. Enable,
pause and pause-event delivery share a five-second deadline; before-read, PNG
capture and after-read share a 15-second deadline. Resume, disable and detach
have bounded cleanup attempts. Cleanup failure fails qualification even if a
PNG was produced, and late operations cannot start another paused read. Only an
observed ineligible phase is retryable; protocol, read and cleanup errors remain
failures. The image response digest and active camera decode health must match
the fixture. Masks and phase editing remain forbidden.

Failure reports preserve the original stage and error, completed observations,
and cleanup evidence. Page, context, interceptor, observer, foreground helper and
owned browser cleanup are bounded. Forced termination cleans up only the owned
browser and fails qualification. Existing evidence files are never overwritten.
