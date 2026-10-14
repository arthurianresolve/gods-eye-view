# S59 pre-profiler calibration failure

[Original CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38172977669). Original artifact bytes are preserved in [report.json](report.json); SHA-256: `d3b9b0a0bc4a417588171ca0514c8bbb6efe85568e876bba714a8e563b848e42`.

The exact 20f5e257 diagnostic correctly fails before sampling: its pre-profiler console timestamp bracket remains 2.9 ms, above the unchanged 2 ms limit. There is no heap or performance acceptance evidence from this run. Cleanup succeeds.

Follow-up a8fbb007 uses an explicit-start PerformanceMark and verifies its startTime against the same trace event. Chromium maps explicit startTime to its monotonic time origin ([PerformanceMark implementation](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/timing/performance_mark.cc)); the emitted trace retains that startTime ([User Timing trace emission](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/timing/performance_user_timing.cc)). Marker call duration remains reported separately; the 0.001 ms timestamp-serialization bound is declared, not a measured call duration. Missing/mismatched marker witnesses fail; historical console anchors still use the 2 ms gate. Thirty-three focused checks pass. Exact-revision heap run 38173280866 is pending.

The follow-up [552d1144 heap diagnostic](../s59-load-profile-38173470721/README.md) passes after preserving explicit timestamps and accounting for bounded JSON double rounding. This diagnostic is not full S47/S59/S60 acceptance or physical Windows evidence. Failed reports remain failed.
