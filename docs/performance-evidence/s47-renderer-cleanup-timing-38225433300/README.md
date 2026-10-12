# Renderer cleanup execution and acknowledgement - 12 October 2026

The isolated diagnostic at `a342c54a428ab234af9449bad78c875f1d67a9be`
records page-local cleanup duration and a bounded late document outcome. Late
acknowledgement cannot clear an original timeout. Root independently passed 90
focused tests; the executor also passed formatting and syntax checks. Tests
reject malformed late classifications and prevent arbitrary secret fields from
entering the cleanup report. No application runtime or deadline changed.

The exact-commit [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38225433300)
**fails** after 129,647 ms. Baseline `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`
passes its static smoke. Candidate smoke reaches the capture CLI, which fails
while replacing its main setup document, before its first measured sample or CPU
profile. Both smoke pages have the expected 2,500 aircraft, 4,362 datacenters and
716 dams. This does not establish paired timing or hardware performance.

| Cleanup observation | Host elapsed | Page execution | Result |
| --- | ---: | ---: | --- |
| Baseline smoke document | 6.814 ms | 0.100 ms | Confirmed |
| Capture startup document | 2.800 ms | 0.100 ms | Confirmed |
| Capture main setup document | 999.668 ms at timeout | Initially unknown | Failed |
| Same main setup operation, late acknowledgement | 1,975.751 ms from operation start | 0.100 ms | Hook restored, both listeners removed, state deleted; original failure retained |
| Final cleanup of that already-cleaned document | 972.853 ms | 0 ms | Already confirmed; does not overwrite the timeout |

The observed wait is outside the cleanup callback. The report does not separate
browser task scheduling, protocol delivery or host scheduling, and does not
establish that the render loop caused the delay. The next bounded experiment
retires rendering only on an owned document after its final observations and
before that document is closed. Measured windows, new documents, rendering detail
and the one-second cleanup gate must remain unchanged. A retirement timeout must
remain a failure, not become an additional hidden wait allowance.

This supersedes the missing late-detail limitation in the
[preceding run](../s47-renderer-cleanup-lifetime-38222535286/README.md); it does not
resolve the capture gate or the separate physical Windows frame-delivery failure.

- [Raw report](report.json): 54,427 bytes, SHA-256
  `6efe04f52513cf49b96546aeec287a5901927e553a9605ef9a1c3be350f92643`.
- [Terminal workflow metadata](ci-run.json).
- Hosted SwiftShader diagnostic only; no performance acceptance.
