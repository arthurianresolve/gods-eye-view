# Hosted tracking CPU profile — 22 October 2026

The [GitHub Actions run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39732658511) passed its bounded build and capture smoke with baseline `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`, candidate and harness `e0001dd73800ace8e4725acf359a2d2e8434183d`. The latest runtime-changing commit was `8ac4d263`. The candidate capture used the verified dense fixture, explicit SwiftShader rendering, one run per scenario, a 1-second warmup, and a 1-second measurement request. The tracking profiler starts immediately before that sample's warmup and stops at its measurement boundary. The runner marked the profile complete and the capture ineligible for latency comparison.

The tracking profile spans 15,231.9 ms and contains 12,407 sampled stacks. Its largest self-weight locations are native `getProgramParameter` (6,345.5 ms), `readPixels` (3,760.0 ms), and `bufferData` (814.6 ms). Those are statistical sample weights across startup and measurement, not GPU execution time or proof of steady tracking cost. The sampled `readPixels` stacks include Cesium `pickPosition`; the minified application caller is not sufficient to assign a source owner. These observations do not justify a tracking runtime change or establish an improvement on the physical Intel UHD 620.

The four raw files are retained here because the workflow's artifact retention is three days. The sidecar's declared SHA-256 and byte length match the profile independently after download. The URL inventory in these JSON files contains only localhost and local build-asset paths.

| File                                                                                       | SHA-256                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [build smoke report](performance-build-smoke.json)                                         | `ae7f9238e908082d774bbdcaa9d5d3f9d13af60c512d260ae660e288c359a3db` |
| [candidate capture report](performance-build-smoke.json.capture-cli-report-candidate.json) | `3df1a341b54241c591df162ff11c88309c53886aafc422ea3ff273508fc72fbf` |
| [profile reference](provider-selected-aircraft-tracking-1-cpu-profile-ref.json)            | `9ed0a0eb339bd2aec6d9aa4c8571d878eae72960613992452ef3765a58c2a653` |
| [sampled CPU profile](provider-selected-aircraft-tracking-1-cpu-profile.json)              | `5ca4bd68818dd4418c554c258524e76771501d6e6ff5946ef268e338b4d553ba` |

S69 remains open for current-runtime, matched physical-GPU latency and strict visual-equivalence checks. The final Ampfing hardware soak and exact-package HTTPS/recovery checks remain separate S70 gates.
