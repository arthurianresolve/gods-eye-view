# S48 capture diagnostics on current dev

This branch ports the isolated capture and attribution work from
`947f1e121096436e6f8058f5c0f91b37b3a66902` onto current `dev`.
The isolated source's [failed hosted result](../s48-fixture-release-ownership/README.md)
is preserved. This port does not establish a rendering speedup or close S48.

The capture producer retains the reviewed isolated implementation. The smoke
producer also includes the import-boundary repair described below.
The integration retains the newer dev camera-verb, viewer-disposal and shared
prewarm ownership repairs. The map lifecycle and streamed HTTP evidence paths
also retain their dev implementations. Fixed caller labels add attribution to
existing depth picks only when the diagnostic observer is installed; ordinary
camera behavior, picking order, visual settings and render deadlines are retained.

The interception merge preserves S57's before-continue observation hook inside
the cancellable preparation lifetime. Regressions cover normal observation before
request handling, a blocked hook cancelled before target closure, and a hook
exception reported with its phase. Superseded hooks cannot send late commands.

Implementation and automated results are recorded independently from browser
and hardware acceptance. The full local Node 24 suite passes. Hosted Node 24/26
then found a timing assertion error; the repaired commit `f7e0709c` passes all
seven standard integration jobs. This establishes the diagnostic tooling
integration gate, not performance acceptance. The separate hosted capture
failed at its outer process deadline after four samples. No complete capture,
performance comparison, Windows soak or final-candidate pass is claimed.

## Invalid-input startup repair

Root's first full Node 24 run recorded 7,398 passes, one failure and ten existing
skips across 7,409 tests. The failing invalid-input CLI child returned no exit
code after 5,211.5 ms with a 5,000 ms subprocess limit. The original assertion
did not retain the spawn error code, so the raw result does not establish every
termination detail. [The original failed log](node24-original-failed.txt.gz) and
[structured counts](local-validation.json) remain preserved.

Source inspection found an unnecessary eager Cesium import through both the
infrastructure fixture and comparison validator. The lightweight workload IDs
and clock assertion now live in a separate module. The heavy fixture producer
loads only after CLI arguments validate. Its JulianDate conversion, pinned
asset hashes and populations are unchanged. The infrastructure validator takes
the independently constructed expected fixture from the producer and rejects
missing or mismatched expectations; it does not derive expected values from
the submitted report.

The CLI regression now fails immediately if invalid input attempts to import
Cesium, Puppeteer or application browser fixtures. Its existing five-second
bound is unchanged, and future failures retain exit status, signal, error code
and elapsed time. Root's [actual old/candidate CLI control](cli-import-review.mjs)
[confirms the dependency boundary](cli-import-review.json): the original attempts
Cesium before producing a failure report; the candidate attempts none of the
forbidden dependencies and writes the expected bounded SHA-validation failure.
This control uses a module-resolution guard and is not a browser measurement.

The focused smoke, infrastructure fixture and comparison suites pass 45/45.
Formatting passes for 1,597 adopted files, and package boundaries pass. The full
Node 24 rerun under the original suite scheduling passes: 7,413 passed, zero
failed and ten existing skips across 7,423 tests, including all fourteen
serialized allocation checks. The previously failing CLI test takes 358.249 ms
in this run. [The passing log](node24-fixed-passed.txt.gz) and structured counts are
preserved separately; the earlier failed run is not reclassified.

Full logs use gzip with verified byte-identical decompression; the manifest records
both compressed and original byte counts and SHA-256 hashes.

## Hosted timing assertion repair

[Standard CI 38270548092](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38270548092)
tests `73018ec58d578401789de49ecb29cfec41a8bf72`. Both Node versions fail the
same assertion in `pairedRendererExperiment.test.mjs`: a late document-cleanup
acknowledgement was required to take at least the entire five-millisecond
cleanup budget. That budget starts before the page-evaluation stage, while
`lateHostReceiptElapsedMs` starts at the stage. Comparing these different
origins is invalid; the Linux timer callback can run before the stage itself
has accumulated five milliseconds.

The test now compares the late receipt with `document.elapsedMs`, recorded at
timeout from the same stage origin. It rejects missing, zero and earlier
receipt values. Late success still leaves the cleanup failed and its timeout
unchanged. No production deadline, cleanup behavior or acceptance gate changes.
Windows onboarding and Windows/macOS/Linux recovery all pass in the original
run; the Node failures remain failures.
Root's independent focused rerun passes 36/36 across the renderer experiment,
actual capture-CLI retirement integration and failure-report suites.

## Current-dev capture result

[Diagnostic 38270552137](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38270552137)
also tests exact application and harness revision `73018ec5`. It observes
2,500 aircraft, 4,362 datacenters and 716 dams, Manual/Dense at 75%, a 1440 by
900 drawing buffer, and Chrome 152 on Linux/SwiftShader. It is supplemental
software-renderer evidence, not physical Windows validation.

Four samples finish: two idle and two scripted-motion. The bounded failure
report retains the last two samples, while all three requested CPU profiles
are saved separately and complete. The 180-second outer child deadline then
initiates owned-process shutdown during the first tracking warmup. That inner
boundary reports `Target closed` after 1,889.585 ms, before its six-second
deadline. This is not independent evidence of a tracking or GPU fault. All
six earlier fixture releases and renderer cleanups are confirmed; final
document cleanup cannot be confirmed after the connection closes. The overall
capture remains failed, and post-capture served-byte verification is absent.

The [independent replay](hosted-38270552137/review.mjs) verifies report/profile
hashes against their producer records and recomputes statistical leaf weights
from raw sample IDs and deltas. A changed-report-byte negative control is
rejected. [Raw evidence and recomputed totals](hosted-38270552137/review.json)
preserve the failed outcome and exact revision.

| Profile | Sampled deltas | `getProgramParameter` | `readPixels` | `bufferData` |
| --- | ---: | ---: | ---: | ---: |
| Idle 1 | 20,539.144 ms | 6,914.735 ms | 3,779.038 ms | 1,751.790 ms |
| Idle 2 | 18,667.380 ms | 6,974.395 ms | 4,173.585 ms | 481.672 ms |
| Motion 1 | 24,085.783 ms | 7,475.291 ms | 11,214.592 ms | 483.655 ms |

These are sampled main-thread weights, including native waits, not measured
GPU durations or precise CPU execution times. The profiles include warmup;
they cannot distinguish steady-state from initial shader work by their totals.
Caller observations show orientation and prewarm picks at different completed
render revisions. They do not justify a cross-frame pick cache without
proving equivalent scene inputs and preserving picking accuracy.

Next work must isolate the remaining workload and distinguish initial
shader/geometry work from repeated work, with existing visual settings intact.
No unchanged diagnostic retry or timeout increase is scheduled. S47, S48 and
hardware/performance acceptance remain partial.

## Control with optional profiling disabled

[Run 38272847654](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38272847654)
tests `f7e0709c8536fb8ca63619fd5288ae3a4123602e`. Git comparison confirms its
application and capture implementation match `73018ec5`; only the timing test
and documentation changed. This control disables optional CPU profiling,
scene-frame attribution and depth-pick attribution together, retaining the
same dense fixture, visual settings, worker mode, sample counts and deadlines.

It fails idle run 1 warmup with **zero completed samples**. Page entry is
acknowledged after 2,399.284 ms; the page's completed-frame boundary settles
after another 4,909.7 ms. The host records its six-second deadline as exceeded,
with the late result retained. Progress-binding cleanup also times out at its
250 ms bound. The first two renderer cleanups pass; final document cleanup
exceeds its one-second budget. Those failures remain separate from confirmed
fixture-session closure.

The [hash-checked raw report and review](normal-control-38272847654/review.json)
show that optional profiling is not required for this warmup failure. This
single control cannot measure profiler overhead or identify a driver, engine,
application or host-scheduling cause. No deadline is increased and neither
failed report is accepted as a performance comparison.

## Standard integration result

[Run 38272643470](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38272643470)
passes all seven selected standard jobs at exact commit
`f7e0709c8536fb8ca63619fd5288ae3a4123602e`: Node 24.14.0 and 26.x,
Windows onboarding, Windows/macOS/Ubuntu recovery, and the Street Level browser
journeys. Formatting, package boundaries and production builds pass within
these jobs. The [terminal job/step record](standard-38272643470.json) preserves
the selected and skipped checks. Optional performance, tracking and soak jobs
were skipped; PR-only published layer-token checks also did not run.

The subsequent commits add evidence and documentation only. This result
supports integrating the reviewed diagnostic tooling into `dev`; it does not
validate an exact final release candidate or close S47, S48 or S60. The two
failed capture runs above remain failed.

## Saved-camera-pose control

The [installed-engine control](normal-control-38272847654/camera-setup-review.mjs)
uses Cesium 1.138.0 Camera and its real View camera-change comparator in Node.
At the dense fixture pose, applying the saved position/direction/up a second
time causes no camera-change event. A one-metre movement negative control
causes one event. [Raw values](normal-control-38272847654/camera-setup-review.json)
reject this repeated pose write as a direct camera-change cause at that pose.
This is not a rendered experiment: initial layer-enable order, other poses,
GPU work and browser scheduling remain untested by this control. No runtime
scheduling change follows from this negative result.

## Integrated attribution follow-up

The reviewed tooling and its preserved evidence were fast-forwarded to `dev`
at `0d2324e64824b59b3b02fea50932deda4e572c08`; application, harness and test
code are unchanged from the all-green standard CI commit `f7e0709c`.

The raw-profile replay now preserves full sampled ancestry for `readPixels`,
`getProgramParameter` and `bufferData`, and divides sample weights across
two-second intervals relative to each profile start. It checks that every
interval and function total reconciles with the original sample deltas.
Every sampled `readPixels` leaf in the three profiles descends from Cesium
`pickPosition`, through two sampled ancestry paths. Shader-program query
weight occurs across multiple intervals, rather than only the first interval.
These observations narrow the next attribution work to scene picking and
shader preparation; they do not prove redundant work or justify eliminating
queries. The intervals are not mapped to warmup or measurement because those
clock domains have not been independently aligned. Sampling weights include
native waits and remain distinct from GPU execution time.
