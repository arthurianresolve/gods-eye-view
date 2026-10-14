# Primary Windows UHD 620 soak — 14 October 2026

This packet records the exact-candidate Windows hardware evidence for the
mixed-use stability gate. It is supplemental hardware validation; it does not
replace the five-pair matched performance matrix, unavailable discrete-GPU or
macOS coverage, or a production deployment check.

## Exact candidate

- Application and harness commit: `0431412adb46f45497079fdd9e08c04b6e6c8b76`
- Source and harness were clean at start and unchanged during the run.
- Browser: Chrome `152.0.7977.75`
- Host: Windows 10 `10.0.19045`, x64, Intel Core i7-8665U, 8 logical CPUs,
  approximately 16.9 GiB RAM.
- Renderer: `ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0)
  Direct3D11 vs_5_0 ps_5_0, D3D11)`; WebGL 2; GPU compositing enabled;
  driver `31.0.101.2145`.

## Results

The setup smoke completed on native GPU hardware and is retained in
`windows-uhd620-e1f82914-setup-smoke.json`.

The corrected full run completed 3,604,800 ms (60 minutes) with:

- `operationStatus: passed`
- `fullSoak: true`
- `hardwareRenderingValidated: true`
- `stability.status: passed`
- retained post-GC heap growth ratio: `0.0221001883` (2.21%)
- 252 mixed-use iterations, 1,008 source toggles, 252 replay seeks,
  252 imports, 504 workspace reloads, 252 archive failures/recoveries, and
  252 camera recoveries
- warmed listener count remained `644`; final worker pending count was `0`
  for every observed worker; application-owned pending jobs remained `0`.

The raw report is `windows-uhd620-full-soak-0431412a.json`. The first run on
the preceding candidate stopped at about 15 minutes because a hidden headed
page used animation-frame polling for an already-ready import predicate. The
bounded timer-polling correction is in this candidate; the failed report is
kept locally as historical diagnostic evidence and is not presented as a
hardware pass.

## Scope and remaining qualification

This proves the mixed-use retention and recovery gate on the physical Windows
UHD 620 machine. It does not claim a 20% motion-p95 improvement, matched
baseline/candidate performance, GPU timing, discrete Windows coverage, macOS
coverage, or complete S47/S60 release readiness.
