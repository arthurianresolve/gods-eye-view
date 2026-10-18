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
Masks are forbidden. Validation requires lossless byte equality, matching
dimensions, containment under the report evidence root, and confirmed browser
teardown for both revisions:

```powershell
node scripts/performance/finalVisualQualification.mjs path\to\report.json
```

Missing or contradictory evidence fails validation; it is not converted to a
pass or an inconclusive visual claim.
