# Primary Windows UHD 620 soak — 14 October 2026

This packet records current and historical exact-candidate Windows hardware
evidence for the mixed-use stability gate. It is supplemental hardware
validation; it does not replace the five-pair matched performance matrix,
unavailable discrete-GPU or macOS coverage, or a production deployment check.

## Reconciled dev candidate

The current clean candidate is
`c943fa855762815c133b1fc4f6f5e7778ca4f4ce`. It contains the latest upstream
`main` through `95d376f13d395bf4747b2cc8f4726a814243257e`, including the right-panel
restoration fix, plus the hardware-soak foreground/throttling hardening. The
[exact-commit CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38619523138)
passes every standard job.

The current 60-minute run used Chrome `152.0.7977.75` in its headless browser
path while retaining the physical Intel UHD 620 ANGLE/D3D11 renderer. The raw
renderer and Chrome graphics records classify it as native GPU rendering with
physical desktop coverage; SwiftShader was not used. It completed 3,604,427 ms
with:

- `operationStatus: passed`
- `fullSoak: true`
- `hardwareRenderingValidated: true`
- `stability.status: passed`, with no failure or pending reason
- retained post-GC heap growth ratio `0.0201210656` (2.01%)
- 253 iterations, 1,012 source toggles, 253 replay seeks, 253 imports,
  506 workspace reloads, 253 archive failures/recoveries, and 253 camera
  recoveries
- 13 retained-resource checkpoints, listener count stable at `644`, final
  worker pending count `0`, and natural browser shutdown without forced process
  termination.

The source, application and harness commits all equal `c943fa85`; the worktree
was clean at start and unchanged throughout. The committed report is
`windows-uhd620-full-soak-c943fa85.json` (SHA-256
`262c50b4fa78d3f240efe0e0d840005f35a5bc76ac247b23ef81538ca262e55d`).
Only its local absolute recording-bundle path was normalized to the adjacent
filename before commit; the unmodified local report hash is
`f607fc7b18e292721a55cd87b47070c41383150d19e72cbe77a90cebfa952312`.
The portable recording bundle is
`recording-rendered-soak-c943fa85.gev-recording-bundle.json` (SHA-256
`4c2e94578e9b38e16725bfb0436aed2f2c63bf271e56722403478541799c34fe`).
The adjacent `validation-manifest-c943fa85.json` binds the exact CI and retention
evidence to this commit while leaving matched comparisons, unavailable physical
hardware, and external accessibility review pending.

The formal pre-release candidate run is `candidate-c943fa85.json` (SHA-256
`ed967fa6eb096c7f70eb2b768719ede89c8e0e7cf480b210f8c190b1e9288b4c`). It
passes the exact-tree check, formatting, package boundaries, the complete unit
and allocation suites, production build, all eight browser journeys, install
recovery, and the physical Windows retention gate. Its `pending-evidence`
status has zero failures and three pre-release pending checks: matched workload
comparisons, the unavailable additional physical hardware matrix, and external
accessibility/usability review.

## Historical exact candidate

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
