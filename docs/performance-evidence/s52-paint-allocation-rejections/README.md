# Rejected conditional-paint allocation trials

These three trials are preserved for diagnosis. None is accepted for production.
`review.json` independently checks every materialized source file against commit
`698752adcd27b59040affc0d0a1a9bd643025833`, verifies the permitted runtime/test
differences, parses all twelve terminal test summaries and extracts every failed
allocation ceiling. Raw logs keep their original UTF-8 bytes; their historical
`.tap.txt` names contain Node's spec reporter output.

| Trial | Focused checks | Allocation checks |
| --- | --- | --- |
| Original snapshot | 86 pass, 1 fail | 5 pass, 8 fail |
| Typed placement snapshot | 87 pass | 5 pass, 8 fail |
| Direct placement capture | 87 pass | 7 pass, 6 fail |

Each trial's pinned baseline passes all 87 focused and 13 allocation checks.
No tests were skipped. No budgets, source populations or painting limits changed.
The latest failures include both frame-allocation and per-candidate ceilings.

To reproduce, use a disposable checkout at the baseline commit with locked
dependencies and Node 24.16.0. Replace `src/overlays/worldOverlay.js` with the
chosen trial's `worldOverlay.js.txt` bytes. For the two later trials, copy
`apply-semantic-hold-test.mjs.txt` to a temporary `.mjs` path and run it with
`src/overlays/worldOverlay.test.mjs` as its argument. Apply the same test transform
to the baseline checkout when comparing it. The transform checks exact anchors
and replaces a redraw-count assumption with retained-output, hit and accessibility
assertions. It changes no allocation test or worker.

Run the focused and allocation suites separately:

```text
node --test --test-concurrency=1 src/overlays/worldOverlay.test.mjs src/overlays/worldOverlayDraw.test.mjs src/overlays/worldOverlayFontWake.test.mjs src/overlays/worldOverlayTokens.test.mjs
node --expose-gc --test --test-concurrency=1 src/overlays/worldOverlayAllocation.test.mjs
```

Use a fresh output location and preserve exit codes and raw logs. Reproduction
does not replace the archived observations. These tests do not measure native
Canvas2D painting, Cesium GPU cost, full-scene latency or hardware stability.
