# S48 registration retirement and fixture-release failure

[Run 38261098402](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38261098402)
**fails** at exact application/harness `7f4f5e07bdbbf6387f5ac267a41842b55a9cf5ec`.
This isolated change removes future-document probe registration at owned page
retirement instead of immediately after DOMContentLoaded. Its one-shot observer
belongs only to the top-level viewer document. The existing shared 1,000 ms cleanup
bound, fixture, settings and diagnostic flags are unchanged. Late registration
acknowledgements now retain elapsed host wait time without converting timeouts
into passes.

Root's [68 focused tests](focused-tests.txt) pass. The same actual-CLI loader
regression [fails on old `5441b038`](negative-cli-order.txt): the old program removes
registration before waiting for the viewer, while the candidate removes it after
document retirement. This is a caller-order check, not proof of browser latency.

All reached renderer cleanup checks confirm removal. In the capture CLI, the
startup, main-setup and failed provider document cleanups take 5.963 ms, 12.352 ms
and 6.550 ms of host time respectively. Their page callbacks report 0.1-0.2 ms;
these are not GPU timings. The main-setup render loop and probe are retired before
opening the next provider context. These observations do not establish a
permanent fix for every prior cleanup or physical Windows stall.

No measurement sample or CPU profile completes. Preparing idle sample 1 detects
a separate request-interception error from the retired main-setup session:

`Fetch.continueRequest: Fetch domain is not enabled` (command-send, session 2,
lifecycle stage `releasing`).

The failed result is preserved. The next investigation must reproduce and fix
the ownership/order of outstanding fixture commands relative to Fetch.disable;
it must not suppress this error or increase deadlines. No upstream application
failure is established by this harness error. The branch remains outside dev.

- [Original outer report](performance-build-smoke.json).
- [Original capture report](performance-build-smoke.json.capture-cli-report-candidate.json):
  20,878 bytes, SHA-256 `21ad706539120e02462e9b9465415c6c9f927a74f0ddb4e14aa20098bca17c71`.
- [Independent byte/source/cleanup review](review.json).
- [Terminal workflow metadata](run.json).
