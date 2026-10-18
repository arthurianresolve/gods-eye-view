# Final visual qualification

`finalVisualQualification.mjs` validates a completed baseline/candidate report
for the narrow S65/S66 control. The caller owns browser setup and must use the
existing CCTV fixture, completed-render observer, foreground proof and teardown
contracts. It records four fixed states: `still-settled`, `hud-visible`,
`hud-hidden`, and `hud-restored`.

After each caller-observed completed render, use `captureQualificationPng(page,
outputPath)` to write a bounded PNG. The report must include the exact
application and harness SHAs, build receipt hashes, native-sharpness-v1
environment/profile, Intel UHD 620 renderer identity, fixed camera/populations,
foreground and completed-render evidence, and both PNG records for every state.
Masks are forbidden. Validation requires decoded RGBA pixel equality, matching
dimensions, containment under the report evidence root, and confirmed browser
teardown for both revisions:

```powershell
node scripts/performance/finalVisualQualification.mjs path\to\report.json
```

Missing or contradictory evidence fails validation; it is not converted to a
pass or an inconclusive visual claim.

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
active. The viewport is 1440 by 900 CSS pixels at the actual device pixel ratio;
Manual/DENSE/75%, native scale, SSE 1 and MSAA 4 remain unchanged.

A read-only observer waits for the real summary typewriter to finish and the
REC indicator's visible phase. It rejects a screenshot if HUD content or phase
changes during capture, including a complete blink cycle. At most three attempts
per state are permitted; all attempted PNGs and observations are retained. The
image response digest and active camera decode health must match the fixture.
This control checks settled appearance; existing timer/lifecycle tests remain
responsible for animation cadence. It is not a latency benchmark.

Failure reports preserve the original stage and error, completed observations,
and cleanup evidence. Page, context, interceptor, observer, foreground helper and
owned browser cleanup are bounded. Forced termination cleans up only the owned
browser and fails qualification. Existing evidence files are never overwritten.
