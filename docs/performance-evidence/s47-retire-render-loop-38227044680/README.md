# S47 retired-document experiment - 12 October 2026

The exact-commit [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38227044680)
at `09fec83fdd8cbc41965e79dfaf6df2614c6a07d4` **fails** an outer fixture-clock
assertion after completing all six candidate captures and all three CPU profiles.
The baseline static smoke passes. This is a short, instrumented SwiftShader
integration diagnostic, not matched hardware or performance acceptance.

The harness retires an owned document's public Cesium render loop only after
its final observations, inside the existing cleanup evaluation. It does not
change measured windows, production rendering, or the one-second cleanup gate.
All eight candidate CLI document cleanups are confirmed: startup, main setup,
and six sample documents. Their host times range from 1.482 to 15.712 ms;
page execution takes 0.100-0.200 ms. Baseline smoke cleanup takes 728.290 ms and
candidate smoke cleanup 4.393 ms, also within the unchanged gate. This run does
not establish why the earlier callback acknowledgement was delayed, nor resolve
the separate physical Windows frame-delivery failure.

The terminal error is `Expected values to be strictly equal: undefined !== 1`.
The outer validator still accesses `fixtureClock.start.startCount`, whereas the
phased producer emits `measurementStart`, a held warmup boundary, followed by
`end`. All six retained clock records have the current structure. The validator's
unit fixture had fabricated the obsolete `start` field and concealed this
contract mismatch. This is our QA defect, not evidence of an upstream runtime
failure.

Repair `e3f7e096098ec2bf3c9499ce499c44951268a5a6` validates the actual phased
clock contract, including epoch offsets, warmup and measurement durations,
exact phase/start counts, boundary identity, native elapsed observations and
source freshness. Its test creates records with the real clock producer and
rejects twelve phase/time/ownership mutations. Root passed 70 focused tests,
formatting and syntax/diff checks, then independently validated all six archived
clock records; the obsolete assertion rejects each one. The old report remains
failed and byte-for-byte unchanged. Its nested capture report is compacted;
that narrow clock replay is not a replay of the complete capture validator.
The replacement [exact-commit run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38228543716)
was dispatched separately.

| Profile window | Sampled `getProgramParameter` | Sampled `readPixels` | Sampled `getParameter` |
| --- | ---: | ---: | ---: |
| Idle 1 | 4,068.380 ms | 3,842.086 ms | 0 ms |
| Idle 2 | 6,259.007 ms | 2,708.119 ms | 0 ms |
| Motion 1 | 3,599.405 ms | 6,008.895 ms | 0 ms |

These are sample-delta weights grouped by leaf function across the entire
profile window, including warmup and boundary settlement. They are not exact
CPU execution or GPU timings. No sampled renderer/vendor `getParameter` stack
remains in these three windows; absence of samples is not proof of zero calls.
The `readPixels` stacks lead through Cesium `pickPosition` into application
view-target, camera-control and HUD summary paths. `getProgramParameter` stacks
lead through Cesium shader binding/preparation. These observations support
further attribution without removing valid picks or lowering visual detail.

- [Unmodified failed report](report.json): 312,588 bytes; SHA-256
  `d78589285fc0749ef017bc3f1e642b9b11610ce4952cab275b10660957fc21da`.
- [Review and byte identities](review.json) covers the report and all six exact
  CPU-profile/reference sidecars in [cpu-profiles](cpu-profiles).
- [Terminal workflow metadata](ci-run.json).

The experiment and clock repair remain isolated pending complete integration.
They do not close S47, S48, S60 or the physical Windows acceptance gaps.
