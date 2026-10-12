# S47 atomic warmup boundary - 12 October 2026

Candidate `0602cbe267449ac1b5f89c5b17996c93cb5a306e` is an isolated follow-up to
[`fda1cb88`](../s47-observation-retirement-38237890055/README.md). It installs the
completed-render listener and holds the fixture clock in the same serialized
browser callback. The unchanged page/host budgets remain 5,000/6,000 ms; the
viewer render loop remains active through warmup and measurement. It preserves
the actual held clock in progress evidence, including unavailable measurement
time as null. No application rendering defaults or source populations change.

Root validation passes 97 focused tests, formatting for 1,570 registered files,
package boundaries and diff checks. Tests exercise the actual phased clock,
serialized callbacks, host observation envelope, prewarm audit ordering,
null-valued progress fields, timeout failure and listener/binding cleanup.

[Hosted run 38241920477](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38241920477)
**fails** at candidate idle run 1 warmup, with zero completed candidate samples.
The baseline outer smoke passes. Co-location alone is not sufficient to resolve
the dense software-rendered frame/host deadline.

The [unaltered raw report](report.json) records:

- Page-entry acknowledgement at 2,712.367 ms after host dispatch; listener
  registration at 1.9 ms after page entry, clock hold at 2.2 ms, and render request
  completion at 2.3 ms. The whole held clock reaches the host with zero malformed
  or overflowed progress events.
- The late completed frame arrives 3,596.9 ms after page entry; page settlement is
  3,597.2 ms. Host observation is 6,316.879 ms, beyond its unchanged 6,000 ms gate.
  The late settled response remains a failure. The page's 5,000 ms timer does not
  fire; its listener and timer are released. Later progress callbacks arrive
  after invocation release and are counted as unowned.
- Warmup retains the declared 1,000 ms fixture boundary; actual native elapsed
  time before the clock hold is 3,714.4 ms. Measurement never starts.
- Startup and main-setup terminal retirement and reached document cleanup checks
  pass. The failed provider document's progress binding is removed in 5.5 ms;
  outer child cleanup is confirmed.
- The failed document has a complete 8,423.294 ms CPU profile with no profiler
  errors. It covers idle run 1 from immediately before warmup through failure,
  rather than the earlier run's different documents. Sample weights are not GPU
  time or exact CPU execution time.

Application and harness identify exact clean `0602cbe2`; pre-capture served asset
checks pass. Final served asset verification is unavailable because capture fails.
The renderer is Linux SwiftShader at 1440 by 900, not physical Windows hardware.
The failure report explicitly marks its projection as bounded/truncated.

[Review and hashes](review.json) preserve the 70,106-byte report and both profile
sidecars byte-for-byte, and verify the profile's embedded size/digest. The prior
failed artifact is unchanged. Keep this candidate isolated; analyze the measured
stacks in the failed document before selecting another runtime or harness change.
No speedup, completed S47 acceptance or driver attribution is established.
