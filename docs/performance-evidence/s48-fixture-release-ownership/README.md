# S48 fixture interception release ownership

The isolated candidate is `947f1e121096436e6f8058f5c0f91b37b3a66902` on
`qa/s48-fixture-release-ownership`. It remains outside production `dev`.
The real-browser diagnostic fails later at idle warmup; no performance or
hardware acceptance is claimed.

The [previous failed run](../s48-registration-retirement-38261098402/README.md)
sent `Fetch.continueRequest` while its fixture session was releasing. The
independent reproduction confirms that the old owner could disable interception
before a pending responder resumed, and retained its request listener.

The candidate removes only its own listener, cancels outstanding response
preparation, drains issued commands, and closes the owned target while Fetch
interception remains enabled. It does not disable Fetch on a live target or
silently resume pending external/API requests. Late callbacks send no commands;
normal request completion releases its cancellation subscription. Renderer
probe cleanup precedes target closure. Failed command or close acknowledgement
evidence remains failed, including when optional diagnostics are off.

Root's [expanded focused run](focused-tests.txt) passes **117/117**, zero skipped.
Package boundaries, syntax, changed-file formatting and diff checks pass. The
full formatting scan found only the new CLI test; that file was formatted and
the entire changed-file set was rechecked successfully.

Independent checks use the actual interception implementation and the actual
capture CLI with controlled browser/provenance stubs. They are Node tests, not
browser measurements or validation of any stubbed build identity:

- [Ownership test source](root-review.mjs) and [candidate observations](root-candidate.json):
  delayed external/API responses, unrelated-listener preservation, cancellation
  subscription release after 50 completed requests, failed issued-command drain,
  and copied callbacks after target closure.
- [Actual CLI test source](cli-review.mjs), [old observations](cli-original.json),
  and [candidate observations](cli-candidate.json): the old program disables
  interception before probe cleanup; the candidate cleans the probe, removes
  its listener, and closes the target. Both successful close and rejected close
  acknowledgement paths preserve the initiating capture error.
- [Source hashes and artifact manifest](review.json).

[Hosted diagnostic 38265309601](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38265309601)
**fails** at the exact candidate commit. It retains the preceding run's dense
fixture, diagnostic worker audit, scene diagnostics, first-motion CPU profile,
depth-pick attribution, visual settings and deadlines. All three fixture-session
releases confirm closed targets and zero remaining commands/preparations.
All reached renderer cleanups pass within the unchanged one-second deadline
(18.908, 3.507 and 134.872 ms host elapsed). This validates the reached release
paths, not the complete capture or historical Windows failures.

Idle sample 1 then exceeds the six-second host warmup deadline. Page entry is
acknowledged after 2,612.419 ms; its render settles after another 3,650.7 ms.
The late result is retained without converting the timeout into a pass.
No measurement sample completes. The startup observes Chrome 152 on Linux with
SwiftShader, Manual/Dense at 75%, and a 1440 by 900 drawing buffer.

The hash-verified [raw capture report](performance-build-smoke.json.capture-cli-report-candidate.json)
preserves caller-level depth-pick observations: camera-orientation move-end
takes 1,124.4 ms at the initial pose, and voice move-end prewarm takes 2,200 ms
at the final pose. A subsequent orientation pick at the same pose and completed
render revision reports 0 ms, consistent with existing Cesium reuse. These are
synchronous API wall-time observations, not measured GPU execution time; they
do not justify an additional cache by themselves.

The [CPU profile](provider-idle-1-cpu-profile.json) contains 6,556 samples and
6,556 deltas totalling 8,407.555 ms within an 8,408.268 ms profile window.
Independent recomputation attributes sampled native leaf spans of 2,336.870 ms
to bufferData, 2,199.615 ms to readPixels, and 1,086.023 ms to
getProgramParameter. Profile status remains **incomplete** because
Profiler.disable exceeded its existing 2,000 ms bound; progress-binding cleanup
also reported a timeout at about 252 ms. These failures remain separate from
the confirmed fixture and renderer cleanup paths. These diagnostic samples
are not precise CPU execution or GPU timings, and cannot establish a performance
gain. The next investigation must attribute upload/shader readiness and prewarm
work before changing runtime scheduling. No unchanged retry is scheduled.

The next implementation ports the diagnostic onto current `dev` in a fresh QA
branch. This is needed because the isolated candidate predates the integrated
S49 camera-verb and prewarm ownership repairs. Two-dot source comparison shows
those dev-only fixes must be preserved; a wholesale candidate-tree replacement
would lose them. The same-revision cached orientation pick also means that
disabling prewarm could merely move its readback cost to the orientation path.
Any such control needs both arms and remains diagnostic, with production
defaults intact.

The [outer report](performance-build-smoke.json), [terminal run metadata](run.json),
and [verified hashes and replay totals](review.json) retain the failed outcome.
Physical Windows comparisons, full S48 and S60 remain incomplete.
