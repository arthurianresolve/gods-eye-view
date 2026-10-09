# Performance baseline

Current status (9 October 2026): remote `dev` includes the follow-up work through
`5328e25`. The corrected `3cdd5cb` software-rendered retention soak passed; see the
exact-revision report below. A new full validation is running for `5328e25`.
The [Cesium plan](CESIUM_PERFORMANCE_PLAN.md) distinguishes code, automatic checks,
physical GPU checks and hosted paravirtual rendering. It also records the limited
Windows UHD 620 capture result and repeated import-preparation CPU comparisons.
No accepted matched comparison establishes the S47-S60 20% motion-p95 target.
Historical results below remain evidence for their named revisions only.

This page records one hardware-rendered Apple M5 comparison captured on 22
August 2026 in Chrome 150 at 1440 x 900. It is not a minimum hardware
specification and should not be used to predict performance on untested systems.
The original capture artifacts are not included here. The capture command below
now produces a portable JSON report; the existing point-in-time results remain
unchanged.

## Test context

The baseline was captured on 22 August 2026 with these conditions:

| Setting | Value |
| --- | --- |
| Renderer | Apple M5 Metal through the hardware ANGLE path |
| Browser | Chrome 150 in a fresh isolated profile |
| Viewport | 1440 x 900 at device pixel ratio 1 |
| Focus | Page foregrounded for controlled scenes |
| Scene sample | 5 seconds of scripted motion, then 5 seconds at rest |
| Startup | Browser cache disabled; three samples |

The capture covered three startup samples, 16 cold layer scenarios with 14
measurements, 23 controlled option and stress scenes, and five
hardware-rendered overlay scenes.

## Startup

| Sample | App ready | Initial settle | Load event | Motion / rest | Used JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 784.980 ms | 2,035.082 ms | 439.5 ms | 60 / 60 FPS | 102.9 MiB |
| 2 | 604.849 ms | 1,855.836 ms | 442.4 ms | 60 / 60 FPS | 111.6 MiB |
| 3 | 558.527 ms | 1,809.592 ms | 438.8 ms | 60 / 60 FPS | 105.1 MiB |
| Median | 604.849 ms | 1,855.836 ms | 439.5 ms | 60 / 60 FPS | 105.1 MiB |

The initial-settle measurement is the more useful launch reference because it
includes the first visual and data settling window. All three samples reached
the display ceiling during both motion and rest.

## Cold layer activation

Cold activation was measured separately from warm option switching. Live object
counts are included so that future runs can compare source populations before
attributing a difference to the client.

| Layer | Activation | Source count | Motion / rest | Used JS heap |
| --- | ---: | ---: | ---: | ---: |
| CCTV city | 19,608.240 ms | 48 | 60 / 60 FPS | 192.7 MiB |
| Space Missions (report label: Rocket missions) | 3,581.066 ms | 26 | 60 / 60 FPS | 131.3 MiB |
| Radio | 3,458.709 ms | 750 | 60 / 60 FPS | 124.8 MiB |
| Bikeshare | 2,069.498 ms | 633 | 60 / 60 FPS | 157.4 MiB |
| Datacenters | 817.693 ms | 4,362 | 59.6 / 60 FPS | 328.2 MiB |
| Flights | 667.671 ms | 247 | 60 / 60 FPS | 118.4 MiB |
| Submarine cables | 614.727 ms | 2,629 | 60 / 60 FPS | 412.0 MiB |
| Military Flights | 557.113 ms | 68 | 60 / 60 FPS | 118.4 MiB |

CCTV had the largest cold activation cost in this capture. Submarine cables
used the most heap, followed by datacenters. Completed single-layer samples
generally reached 60 FPS, so activation time and heap separate these cases more
clearly than steady-state frame rate.

## Aircraft, detection, and Cockpit

| Scene | Motion / rest |
| --- | ---: |
| Idle globe | 60 / 60 FPS |
| Flights, 2D | 60 / 60 FPS |
| Flights, 3D proximity | 60 / 60 FPS |
| Flights, all 3D models | 60 / 60 FPS |
| Military Flights, all 3D models | 60 / 60 FPS |
| Detection at 25% | 39.3 / 41.1 FPS |
| Detection at 50% | 37.4 / 39.8 FPS |
| Detection at 100% | 34.4 / 35.5 FPS |
| Cockpit | 49.6 / 49.2 FPS |

The clean detection scenes processed 8,169 to 8,170 observations. Selected
labels rose from 14 at 25% density to 28 at 50% and 56 at 100%. The aircraft
rows came from an earlier loaded, foreground-controlled pass because the clean
rerun received no live aircraft rows.

## Visual styles and combined stress

| Scene | Motion / rest |
| --- | ---: |
| Normal | 60 / 60 FPS |
| CRT (report label: Retro) | 60 / 60 FPS |
| NVG (report label: Surveillance) | 60 / 60 FPS |
| FLIR (report label: Thermal) | 49 / 60 FPS |
| Anime | 60 / 59.8 FPS |
| Noir | 47 / 56.6 FPS |
| Snow | 42.3 / 45.8 FPS |
| Combined static | 57.6 / 60 FPS |
| Combined operational | 39.9 / 43.1 FPS |

The combined static scene rendered 11,575 objects, used 872.2 MiB of JavaScript
heap, and issued 48,665 text draws during motion and 54,106 at rest. The combined
operational sample contained 3,909 observations and two selected labels, but its
live aircraft and traffic rows were empty, so it remains a limited stress case.

Snow, Noir, dense detection, and text-heavy combined layers are the clearest
controlled comparison points for later optimization work.

## Keyed live sources

NASA FIRMS, AISStream, and TomTom were captured in a separate hardware-rendered
pass. The page was visible but was not the focused window, so these frame rates
must not be compared directly with the foreground-controlled scenes above.

| Source | Point-in-time population | Activation or coverage | Motion / rest |
| --- | ---: | --- | ---: |
| NASA FIRMS | 100,430 detections in 3,557 cells | 30.0 s activation | 32.1 / 55.2 FPS |
| AISStream | 12,000 vessels | 6.4 s activation | 22.1 / 29.8 FPS |
| TomTom Traffic | 4,222 road dots | 70% coverage, 2 decoded tiles | 45.0 / 51.7 FPS |

These populations change continuously. A future comparison must record the
live counts again and match the focus conditions.

## Controls for a future capture

Start the app at `localhost:4173`, foreground its browser window, then run:

```sh
npm run performance:capture -- --url http://localhost:4173 --runs 3 --seconds 5 --out qa-artifacts/performance.json
```

The JSON includes renderer, browser, viewport, device pixel ratio, tab visibility,
startup timing, per-layer counts, JavaScript heap where supported, long tasks,
frame interval percentiles, and repeated idle/scripted-camera windows. Use
`--hardware-required` to reject software renderers or `--max-p95-ms N` for a
local threshold. `--inject-delay-ms N` is a diagnostic negative control and must
not be used for a baseline. A report flags changing layer populations across
samples; rerun base and candidate with the same fixture/data population before
comparing them. No hardware claim is made from a software renderer or a report
with mismatched populations.

For repeatable development captures, add `--fixture-aircraft 2500`. The harness
enables the flights layer and injects the same generated Austin aircraft ring
through its development-only layer seam, then records the fixture ID and count.
It adds a selected-aircraft tracking scenario that follows fixture `000001` for
the same repeated window. Add `--mixed-layers` to enable the local datacenter and
dam layers for a stable combined scene. Choose `--quality-mode manual` or
`--quality-mode auto` and retain both reports when comparing profiles. This is a
controlled workload hook, not a production feed, and software-rendered captures
remain smoke checks rather than hardware performance evidence. For the weather
history workload, use `scripts/qa-weather-perf.mjs --states history-playing
--repeat 3 --no-idle` and retain its route report with the source timestamps.

## Matched Windows UHD 620 comparison — 8 October 2026

A corrected three-run comparison used the same hardware renderer, browser,
foreground state, 1440 x 900 viewport at DPR 1, 5-second warmup, and stable
7,578-object scene in every build: a 2,500-aircraft Austin ring, 4,362
local datacenters and 716 local dams. Each reported value is a five-second
sample; p50 and p95 describe frame intervals within that sample.

The base app was `95fa816` and the candidate app was `0171b69`; both used the
same corrected capture harness at `fdd4d7d`. All six samples had 2,500 observations and a stable object population. Base and
Manual reported 120 candidates and 30 selected labels in every sample. Auto
reduced its candidate count from 80 to 64 while throttling label density.
Raw reports: [base](../qa-artifacts/performance-baseline-main-detection-fdd4d7d-3run.json),
[Manual](../qa-artifacts/performance-candidate-manual-fdd4d7d-3run.json), and
[Auto](../qa-artifacts/performance-candidate-auto-fdd4d7d-3run.json). The machine
reported an Intel UHD Graphics 620 through ANGLE Direct3D 11 in HeadlessChrome
153 on Windows x64.

| Build/profile | Idle p50 / p95 by run (ms) | Scripted-motion p50 / p95 by run (ms) | Motion mean p50 / p95 (ms) | Detection labels |
| --- | --- | --- | --- | --- |
| Base `95fa816` | 67.1 / 153.3; 74.6 / 157.6; 73.9 / 160.1 | 86.5 / 120.0; 91.0 / 153.7; 89.2 / 137.8 | 88.9 / 137.2 | 30 at 75% density throughout |
| Candidate Manual `0171b69` | 82.0 / 263.8; 72.4 / 188.0; 78.6 / 181.4 | 80.3 / 146.6; 87.9 / 153.9; 85.8 / 142.4 | 84.7 / 147.6 | 30 at 75% density throughout |
| Candidate Auto `0171b69` | 84.5 / 222.2; 92.5 / 177.1; 89.4 / 182.2 | 92.8 / 184.0; 97.3 / 118.1; 96.7 / 117.1 | 95.6 / 139.7 | 20, 20, 10 idle; 10, 4, 4 moving |

Auto reduced label density from 50% to 0% during motion, while preserving four
selected labels at the reported 0% setting. Its mean motion p95 was close to the
base and Manual results, but its mean p50 was slower and label density fell.
Three short samples on one GPU do not establish a reliable performance gain;
Auto remains opt-in pending broader hardware and visual review. The results do
not establish a general Windows or minimum-hardware guarantee.

The capture now cancels any startup camera flight before fixing the synthetic
scene camera, and reports detection and camera diagnostics if visible labels do
not appear. This prevents a late startup animation from moving the fixture out of
view and producing misleading zero-label samples.

### Selected-aircraft tracking and weather history

The capture harness also exercises the selected-flight camera follow path. The
base and candidate each ran three 5-second samples with the same foreground
Chrome session, 2,500 generated Austin aircraft, 4,362 datacenters, 716 dams,
and `flights:000001` selected and tracked. Every sample reported a stable 7,578
object population and retained the tracked aircraft identity. Raw reports:
[base `95fa816`](../qa-artifacts/performance-baseline-selected-tracking-95fa816-3run.json)
and [candidate `215a8d9`](../qa-artifacts/performance-candidate-selected-tracking-215a8d9-3run.json).

| App commit | Tracking frame p50 by run (ms) | Tracking frame p95 by run (ms) |
| --- | --- | --- |
| Base `95fa816` | 105.9, 91.2, 97.6 | 288.2, 1116.9, 1171.5 |
| Candidate `215a8d9` | 111.1, 97.9, 89.4 | 201.0, 196.5, 396.7 |

The base has two very large p95 samples, so these three-run captures are useful
for harness and regression coverage but do not establish a stable tracking-speed
gain. They were captured on one Windows UHD 620 system and are not a hardware
matrix.

Weather history playback was separately measured with three repeated routes
through `scripts/qa-weather-perf.mjs`. Each route measured zoom-in, close idle,
orbit, zoom-out and globe idle while Radar, Satellite and Lightning history were
playing. All three setups reported ready, and all weather layers reported
playback active. The harness used the live NOAA nowCOAST feed, so the exact frame
times and tile populations changed between repetitions; treat this as playback
coverage and a point-in-time load sample, not a matched base/candidate weather
comparison. Results: [JSON](../qa-artifacts/weather-perf-s06-20261008/dev/results.json)
and [summary](../qa-artifacts/weather-perf-s06-20261008/dev/summary.md).

The Manual candidate's three moving p95 samples (146.6, 153.9 and 142.4 ms)
passed a 200 ms **test-only** ceiling. An idle sample reached 263.8 ms and was
correctly excluded from the moving-scene budget. With the same dense scene and a
200 ms injected main-thread delay, the moving p95 reached 266.9 ms and the gate
failed as intended: [negative-control report](../qa-artifacts/performance-delay-control-dense-fdd4d7d-1run.json).
The 200 ms ceiling verifies the harness behavior; it is not a product target.
## Corrected retention soak — 9 October 2026

[CI run 37944725028](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37944725028)
tests clean application/harness commit `3cdd5cbd9f744de2a0d4d8a45a9a114660a182f8`.
The corrected interceptor handles worker requests directly, and the workspace
fixture observes completion before autosave can replace its status. No Cesium
dependency patch or VM change was necessary for these reproduced failures.

The [full soak job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37944725028/job/113868003442)
completes 169 measured cycles in 3,602,183 ms. All 13 post-GC checkpoints have
632 listeners and zero pending worker tasks. Retained heap starts at 73,424,108
bytes and finishes at 80,248,328 bytes; growth in the defined retention window
is 2.03%, below the 5% limit. Operations and stability pass. The workflow's
`rendered-soak` artifact contains the complete JSON and measurement conditions.

This is Chrome 152 with ANGLE/SwiftShader, explicitly reporting
`hardwareRenderingValidated: false`. Forced GC separates this retention
diagnostic from latency measurements. It does not establish a hardware plateau,
a motion-p95 improvement or visual equivalence for the remaining optimizations.
The earlier failing reports remain historical evidence rather than being
reclassified as passes. Node 24/26, builds, browser journeys and all three
installation-recovery jobs also pass for this exact revision.

## What is not established yet

Free GitHub-hosted macOS also supplies verified **paravirtual Metal** acceleration.
The [0fa3140 run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37960247130/job/113920967041)
completed 252 cycles in 3,603,543 ms on Chrome 152. Its 13 post-GC checkpoints
retain 629 listeners and zero pending worker jobs; final-window heap growth is
1.58%. The [original result](performance-evidence/hosted-mac-0fa3140-original.json)
failed solely on the cumulative cache-use counter; the
[separate corrected-validator reassessment](performance-evidence/hosted-mac-0fa3140-review.json)
passes. The report explicitly excludes physical desktop coverage. It does not
measure the target Windows GPU or a motion-p95 improvement.

A second software-rendered run at `5328e256460a13edbf1be65397d2faf43e8d3075`
completed 130 cycles in 3,620,845 ms. Its [original report](performance-evidence/soak-5328e25-original.json)
failed because the old validator counted cumulative cache reuse as retained
ownership. A [separate, revision-bound reassessment](performance-evidence/soak-5328e25-review.json)
passes the corrected validator: owned resource counts stay bounded, browser
listeners return to 632, and final-window retained-heap growth is 1.70%.
The original failed verdict remains available. This is Chrome 152/SwiftShader;
it provides no hardware motion-p95 result. See the [current slice ledger](CESIUM_PERFORMANCE_PLAN.md)
for subsequent code changes, failed Windows capture diagnostics and remaining
acceptance work.

- The Apple baseline is not a Windows measurement. The separate Windows diagnostic
  above covers only one Intel UHD 620 system and does not establish performance
  across Windows devices.
- The report does not record machine memory capacity, so it cannot support a
  minimum-memory recommendation.
- The report does not cover other GPU renderers or viewport configurations.
- Military Installations is outside this comparison because it requires close
  camera context.
- The keyed pass has no controlled rerun suitable for comparison with the
  option scenes.

Use this page as a regression baseline for one known hardware and browser
configuration, not as a compatibility guarantee.
