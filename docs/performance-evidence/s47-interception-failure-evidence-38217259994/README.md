# Dense capture: complete CPU profiles, incomplete capture

[Run 38217259994](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38217259994)
tests application and harness commit
`9ec1172c922b8558bc5723b07eeef7a92b62dc09`. The run **fails** at the unchanged
180-second capture-child deadline. It completes idle samples 1 and 2 and motion
sample 1, then is stopped during motion sample 2 warmup. `Target closed` is
reported during that shutdown; it does not establish an independent browser crash.

The reporting repair preserves at most eight sanitized fixture errors, bound to
document/session ownership, lifecycle and callback phase. Thirty independent
focused tests pass, including actual callback-to-failure-artifact-to-smoke-summary
paths, late callbacks and credential/path redaction. No error filters or deadlines
changed. This hosted run records zero interception errors, so it does not explain
the two errors whose details were omitted by the previous harness.

All three bounded CPU profiles are complete, with verified hashes, byte counts
and document identities. Root reruns the sidecar/index verifier and independently
aggregates sample weights and parent stacks. The windows cover warmup through the
measurement boundary, not just steady-state execution. They include native waits,
idle and garbage collection; these are not precise CPU or GPU timings.

| Sample   | Profile window | `readPixels` weight | `getProgramParameter` weight | `getParameter` weight |
| -------- | -------------: | ------------------: | ---------------------------: | --------------------: |
| Idle 1   |      22,433 ms |    8,529 ms (38.0%) |             5,434 ms (24.2%) |      2,854 ms (12.7%) |
| Idle 2   |      20,857 ms |    3,125 ms (15.0%) |             7,430 ms (35.6%) |       2,067 ms (9.9%) |
| Motion 1 |      24,194 ms |    5,576 ms (23.0%) |             5,766 ms (23.8%) |      2,953 ms (12.2%) |

Every sampled `getParameter` call has the capture harness's `observeCommonScene`
as its direct JavaScript caller. That observer queries the renderer/vendor again
while the scene has queued rendering work. These fixed identity reads should move
to the existing early Cesium context probe. The live settings, populations, camera
and dimensions must still be read per sample, and context replacement, loss or
restoration must invalidate the early evidence.

The `readPixels` paths include Cesium depth picking from HUD summary context and
camera-update application callbacks. `getProgramParameter` appears under Cesium
shader/primitive preparation and drawing. Those findings identify owners for
follow-up; they do not prove a repeated-query engine defect or authorize lowering
visual fidelity. The next comparison should first remove the measured harness
perturbation while preserving the existing capture deadlines.

The baseline build smoke passes. The candidate observes all 2,500 fixture flights.
Only three of six samples complete, and the failure report marks some nested
evidence truncated. The three profile sidecars themselves are complete and each
has fewer than 21,000 samples. Outer child cleanup is confirmed. No full capture,
performance improvement, retention plateau or physical Windows pass is claimed.

The [raw smoke report](report.json) is 149,659 bytes, SHA-256
`8c5354f015b0e7b69d104e9f65010228c618b8e8782cab1989f61fea1ee71db3`.
[Independent review](review.json), [terminal CI metadata](ci-run.json), and the
three profile/index pairs in this directory preserve the observations. The
environment is hosted Linux Chrome 152 with SwiftShader.
