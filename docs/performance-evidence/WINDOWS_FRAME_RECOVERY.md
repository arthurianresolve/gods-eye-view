# Windows frame delivery recovery — 10 October 2026

The failed Windows UHD 620 capture check now passes under the later foreground
conditions. The exact cause of the earlier callback stalls is still unresolved;
no application, driver, browser setting or capture deadline was changed to obtain
these passes. Keep every earlier failure as historical evidence.

## Revision and environment

- Application and harness: `0edfb8e905430d362a2f105d47da08bf04a757ac`.
  The server remained frozen at this identity. Branch `6046012` adds only the
  preceding evidence/documentation; the tested runtime and fixture files agree.
- Windows 10, Chrome 154.0.0.0, ANGLE Intel UHD Graphics 620 / D3D11, physical GPU.
- Import drawing buffer: 640 by 360; five counterbalanced synchronous/cooperative
  pairs, 5,000 points per sample. Render demand and buffer preservation enabled,
  optional command-fence observation disabled, fresh-frame deadline 400 ms.
- Manual WebGL viewport: 887 by 585. Subsequent automated runs: 887 by 529.
  The automated WebGL canvas was 90.8% within the viewport; the diagnostic import
  canvas was 78.6% within it. Passing results with clipping show that clipping
  alone does not explain the previous failures.
- No forced GC, allocation profiler, driver change or GPU timing query.
  Import timing is fixture correctness evidence, not a motion-p95 comparison.

## Observations

| Run | Result | Raw artifact |
| --- | --- | --- |
| User-started WebGL after manual foreground request, 00:28:26 UTC | 302 callbacks / 5 s; maximum gap 17.5 ms | [Manual report](webgl-frame-delivery-0edfb8e-manual-foreground.json) |
| Same WebGL control started through CUA, 00:30:50 UTC | 301 callbacks / 5 s; maximum gap 20.7 ms | [Automated repeat](webgl-frame-delivery-0edfb8e-foreground-repeat.json) |
| Paired import with opt-in diagnostics, 00:31:07 UTC | 10/10 captures, 6.8–22.0 ms; 12 cancelled imports cleaned up | [Diagnostic import](import-batches-0edfb8e-foreground-diagnostic.json) |
| Normal paired import, 00:31:32 UTC | 10/10 captures, 6.0–22.2 ms; 12 cancelled imports cleaned up | [Normal import](import-batches-0edfb8e-foreground.json) |
| Normal paired import repeat, 00:31:53 UTC | 10/10 captures, 6.4–19.7 ms; 12 cancelled imports cleaned up | [Normal repeat](import-batches-0edfb8e-foreground-repeat.json) |
| Capture matrix, 00:32:14 UTC | 12/12 checks, preservation true and false | [Capture matrix](capture-matrix-0edfb8e-foreground.json) |
| Normal import after report-only correction at `c2d80e2`, 00:34:42 UTC | 10/10 captures, 5.0–17.7 ms; 12 cancelled imports cleaned up | [Corrected report](import-batches-c2d80e2-foreground.json) |

Every import sample preserves 5,000 features and the same pixel SHA-256:
`5e4039bcb2c26169235ad7a0f7a7c20daa8faa51463d7d7784631f65255e5bb1`.
The matrix checks idle, moved camera, portrait, resized and restored captures,
plus cancellation during destruction. MSAA remains four samples. These reports
are copied byte-for-byte from browser downloads and checked with SHA-256.

## Interpretation and remaining work

The user reported completion of the requested manual foreground run. The exact
desktop condition changed before it was not reported or instrumented. Do not
label the earlier failures as confirmed Windows occlusion, automation, Cesium,
ANGLE or driver defects. CUA-started tests also pass now, so a synthetic click
alone is not a sufficient trigger.

`document.visibilityState`, `document.hasFocus()` and canvas/viewport intersection
describe page-observable conditions. They cannot establish whether another desktop
window covers Chrome, Windows is locked, or a remote-session transition affected
presentation. The legacy import field `foregroundUninterrupted` checks document
visibility only; it must not be interpreted as OS-level foreground verification.

Commit `c2d80e2161cdaaec8800fcd9ca990f61e8b1035c` corrects the fixture reporting,
not the render loop: it retains that legacy field with an explicit visibility-only
scope, adds document visibility/focus observations and records desktop foreground
verification as `unavailable`. Both diagnostic pages explain this limit. The
normal hardware rerun at that exact revision passes all ten captures and reports
the new fields correctly. Twelve focused diagnostic/capture tests, JavaScript
syntax checks and the repository formatting check pass. Outcomes, populations,
render settings and deadlines are unchanged; no retries were added.

For future hardware measurements, keep Chrome visibly foregrounded and uncovered,
avoid lock/minimize/session transitions, and first save the five-second WebGL
control result. Record operator-observed desktop conditions separately. If callback
delivery stalls, retain the failed report, preserve the 400 ms deadline, and
compare a subsequent control under documented conditions. Do not retry away
failures or force rendering with timers to manufacture acceptance.

Capture correctness has recovered for this exact fixture and revision. The
earlier stall's root cause, full application capture coverage, matched latency
workloads and the 60-minute Windows retained-resource soak remain open. The
[seven standard CI jobs at `6046012`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38005697017)
all pass, including Node 24/26, Windows onboarding, three-OS recovery and browser
journeys. Those automated results do not replace physical GPU soak evidence.
