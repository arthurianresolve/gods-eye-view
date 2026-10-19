# S69 native Windows matrix checkpoint — 19 October 2026

Candidate deployment is blocked. Six of eight workload pairs completed, with
dam and cable motion regressions above 10%. The weather baseline failed before
its candidate ran; map streaming is unrun. Production remains at `e7a878e`.

## Revisions and conditions

- Baseline application: `e7a878e168bc97ffedddc27e13bf3e69b7ee6256`.
- Candidate application and build harness: `19065997a3f6360d68cb9ed5b389c4754856b596`.
- Operating capture producer: `19065997a3f6360d68cb9ed5b389c4754856b596`.
- Remaining matrix producer: `d372aaa644e4db2464d70f9611fc11e97beaf951`.
- Physical Windows Intel UHD 620, ANGLE/D3D11 hardware rendering, Chrome for
  Testing 152.0.7977.75, native DPR 2, 1,440 × 900 CSS viewport and 2,880 × 1,800
  drawing buffer. Manual/DENSE/75%, matched fixture populations and settings.
- Each qualification block uses five runs, 30 seconds of warmup and 60 seconds
  of measurement. Instrumented diagnostic runs below are separate.

The matrix plan SHA-256 is
`02d8e0b8d91257bb1450ae21ff1a3ed02ec33b2e89395d3eca4608440491c5e3`.
Builds, dependencies, Linux checks and bulk evidence use VM105. Windows retains
the files required for actual GPU capture and receipt verification. No nested
container or production service change was needed.

## Completed comparisons

Values are median run-level scripted-motion p95, rounded for display. Passing
this individual regression threshold is not full release acceptance.

| Workload                | Baseline ms | Candidate ms | Change | Motion regression threshold      |
| ----------------------- | ----------: | -----------: | -----: | -------------------------------- |
| Operating view          |       456.4 |        454.0 |  -0.5% | no unresolved motion regression  |
| Dense investigation     |       530.2 |        545.7 |  +2.9% | within 10%; 20% objective missed |
| Datacenters             |       317.0 |        317.1 | +0.03% | within 10%                       |
| Dams                    |       300.1 |        409.9 | +36.6% | failed                           |
| Submarine cables        |       339.2 |        549.7 | +62.1% | failed                           |
| Combined infrastructure |       378.3 |        368.1 |  -2.7% | within 10%                       |

Dense selected tracking is 1,364.8 versus 1,368.4 ms (+0.3%); its proposed 20%
objective is also missed. No material performance improvement is claimed.

Operating idle has a separate, hash-bound disposition at `7aa89243`: its raw
+80.8% inter-render interval flag remains preserved. The short production-loop
diagnostic establishes correct satellite motion, intentionally invisible wind at
12 km, and equivalent visible wind geometry/animation at 60 km. It clears only
that pair's idle interval finding, never dam/cable motion or retention.

The [raw-report index](raw-report-index.json) records all 13 original report hashes, exact application and producer revisions, and individual sample values. It includes the failed weather report; no failed report is replaced by a diagnostic success.

## Dam tail diagnosis

Four fixed alternating captures, baseline/candidate/baseline/candidate, use
producer `080d755f5ec1666f66c81f93200b456a50a0b7bb` with bounded frame tracing.
All four retain foreground ownership and untruncated timing records. Their
scripted-motion frame-interval p95 values are 283.8, 462.1, 325.5 and 439.5 ms.
The corresponding `viewer.render` call wall-time p95 values are 16.8, 18.6,
20.7 and 17.6 ms. Most of the added interval lies before the next animation-frame
callback. These wall times do not measure GPU execution or prove a driver,
engine, HUD or browser defect.

Every recorded governor state has no active holds or scheduled updates. The
existing producer disables optional application diagnostics before measurement.
The Cesium distribution and worker source digests are identical across the pair.

The [diagnostic review](dam-trace-review.json) binds the original protocol and
summary by hash. Raw reports and traces are preserved on VM105 under
`/opt/gods-eye-view-validation/s61-s70-20261018/dam-tail-diagnostic-080d755f-20261018T222558Z`.
The trace producer marks these captures comparison-ineligible. They do not
replace the original five-run failures or authorize an acceptance waiver.

A one-change HUD control removes the unchanged-text equality guard at diagnostic
commit `de3c3a654790913dbf97c5b3288fe9a5876a23fe`, retaining all other candidate
behavior. Its first setup attempt stopped before Chrome because npm 11.20.0 did
not match the original build recipe's 11.13.0. A fresh VM build with Node 24.16.0
and npm 11.13.0 reproduces the matching build recipe. The
failed setup remains recorded. The control returned a motion p95 of 295.3 ms,
but the immediately following unchanged candidate also returned 299.0 ms. The
[control review](hud-control-review.json) binds both reports and traces. This
does not establish the equality guard as the cause. The experimental removal
is not retained; the earlier failures remain unresolved. Raw evidence is on
VM105 under
`/opt/gods-eye-view-validation/s61-s70-20261018/hud-write-control-fb8a6c33-20261018T225029Z`.

## Browser presentation diagnosis

The installed Windows Chrome executable reports version `155.0.8059.84`;
the preceding captures use Chrome for Testing `152.0.7977.75`. The next
diagnostic keeps application `19065997` fixed and compares four independent
launches in the declared order 152, 155, 155, 152, with the same native visual
profile and default composition. It is diagnostic only; neither version has
been qualified by this comparison yet. Graphics evidence now records the full
runtime version from `Browser.getVersion`, independently of GPU availability.
Malformed or unsupported versions remain null. All 31 renderer/backend/lifecycle
checks pass on Node 24.16.0 and 26.11.0 on VM105; 13 version/runner-discovery
checks pass on Windows. Logs and source hashes are retained in
`/opt/gods-eye-view-validation/s61-s70-20261018/renderer-version-check-1792374888350`.

Producer `7f793116` adds a bounded, opt-in browser trace alongside the frame
trace. One matched cable capture per frozen application preserves the same
2,629 objects, Manual/DENSE/75%, native 2880 × 1800 buffer and other visual
settings. Both traces cover the full 60-second motion sample without data loss.
The [browser review](cable-browser-review.json) binds the reports, raw traces,
protocol and analysis scripts by hash. Raw traces stay in the private VM105
archive `cable-browser-diagnostic-7f793116-20261018T231433Z`.

| Metric from this diagnostic             | Baseline | Candidate |
| --------------------------------------- | -------: | --------: |
| Rendered frame interval p95             | 328.5 ms |  555.0 ms |
| Rendered frames in the motion window    |      209 |       206 |
| Animation callback wall-time p95        |  25.1 ms |   21.8 ms |
| Chrome overlay scheduling wall-time p95 |   3.3 ms |  260.7 ms |
| Overlay scheduling thread CPU p95       |  0.94 ms |   0.84 ms |

The candidate has a larger frame-delivery tail despite similar throughput and
lower animation callback cost. The trace localizes substantial waiting within
Chrome's submission/presentation path. Thread CPU durations are measured
separately from event wall time; neither measures GPU execution time. Inclusive
event durations overlap and must not be added. This does not establish an
application or driver defect, and it does not clear either original regression.

The first trace attempt at `1988fc94` exhausted its buffer after approximately
32 seconds. Its [capacity failure](browser-trace-capacity-review.json) remains
preserved. The corrected trace selects renderer callbacks, thread tasks and
presentation events, retaining the same 32 MiB trace buffer and 64 MiB export
limit. It does not increase application performance or change visual quality.

The tracing refactor also broke an existing test's AST callback discovery.
`6c32dba4` resolves the actual callback argument array and keeps the behavioral
assertions. The subsequent Windows-only composition control at `c9c61d01`
requires a headed hardware run and both diagnostic traces. It always excludes
its reports from performance acceptance and changes only its owned Chrome
process. All 45 focused capture, tracing, CLI and deadline checks pass under
Node 24.16.0 and 26.11.0 on VM105. Full CI for this revision is separate evidence.

The [exact-revision CI review](c9c61d01-ci.json) records all seven selected
jobs and release verification passing at `c9c61d01`. Optional diagnostics remain
skipped and do not count as hardware qualification.

The composition control completed in the predefined reverse order, candidate then baseline.
Motion p95 was 351.5 and 357.7 ms respectively, with 209 and 196 rendered frames.
Both retain the Intel UHD 620 D3D11 renderer and matching visual settings.
The previously observed `ScheduleOverlays` events disappear from both complete
traces, corroborating that the requested browser switch affected presentation.
The [composition review](cable-composition-control-review.json) binds its evidence;
the private archive is `cable-composition-control-c9c61d01-20261018T233734Z` on
VM105. This supports a presentation-path interaction, but one instrumented pair
does not establish its application trigger, a driver defect, or a stable fix.
No persistent browser setting or application default changed. It is not a new
qualification profile or a waiver for the default-browser regressions.

## Framebuffer preservation control

The opt-in diagnostic at `9dbec028` changes only WebGL buffer preservation in
its owned browser. It verifies the real context before and after each sample,
rejects missing/lost contexts and changed attributes, and remains ineligible
for acceptance. All 49 focused checks pass on VM105 under both Node versions.

The fixed four-arm sequence uses the same candidate application at `19065997`,
first with preservation enabled, twice disabled, then enabled again. Three arms
completed; Windows refused to activate the fourth owned Chrome window before
measurement began. The [framebuffer review](cable-framebuffer-control-review.json)
binds the completed reports, traces and failed fourth attempt by hash.

| Arm         | Actual buffer preservation |  Motion p95 | Rendered frames |
| ----------- | -------------------------- | ----------: | --------------: |
| preserved-a | enabled                    |    324.2 ms |             221 |
| released-a  | disabled                   |    570.6 ms |             208 |
| released-b  | disabled                   |    552.5 ms |             214 |
| preserved-b | no measurement             | unavailable |     unavailable |

The completed arms retain native resolution, antialiasing, effects and 2,629
cable objects. Their traces are complete, and foreground ownership holds
throughout their samples. This incomplete, instrumented control demonstrates
no benefit from disabling preservation. The application default remains enabled;
no capture-correctness or visual-equivalence acceptance is claimed for a changed
default. Both original infrastructure regressions remain unresolved.

Raw evidence was retained in the private Windows directory
`cable-framebuffer-control-1792367992163` while validation access was unavailable.
After the approved access renewal on 19 October, all 14 files (82,308,738 bytes)
were copied to VM105 and verified byte-for-byte. The earlier weather transfer's
four files (226,626 bytes) were also verified without overwriting them. The
[transfer review](renewed-transfer.json) retains every file hash and archive name;
the original failed reports remain unchanged.

## Weather failure and diagnostic correction

The original baseline report failed in scripted-motion run 2 while entering
`early-history`. Five idle and one motion sample completed before failure. Its
SHA-256 is `a2a6904f03aa5e9c5741d994449da110d4f1d893b7ab94be95108fd25935b690`.
It lacks the failed transition's detailed observation, so its root cause is not
established.

Producer `fb8a6c33285e3a83f92b8d612d55fda21a13c42b` retains bounded expected and
observed timestamps, fixture identity, elapsed time, phase, clock and slider
state. Existing predicates, failure prefixes and deadlines remain unchanged.
Malformed/oversized context is rejected; arbitrary objects and URLs are omitted.
Thirty focused tests pass on VM105 under both Node 24.16.0 and 26.11.0.

All seven selected [CI jobs at this QA revision](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39172161048)
and its [release verification](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39172161051)
pass. Twelve optional diagnostic jobs are intentionally skipped; they do not
constitute hardware or soak evidence.

One diagnostic run per frozen application completed without reproducing the
failure. Both reports remain comparison-ineligible because this diagnostic uses
a one-second warmup and one repetition. The
[weather diagnostic review](weather-phase-review.json) records exact revisions
and raw hashes. Its VM archive is
`/opt/gods-eye-view-validation/s61-s70-20261018/weather-phase-diagnostic-fb8a6c33-20261018T223553Z`.
The full weather pair and map-streaming pair remain outstanding.

A full weather replay at `c9c61d01` completed five idle and five motion samples
on the baseline, then failed the final settings check: the contract expected
`satelliteInfrared: "filtered"`, while the application reported numeric `100`.
Both frozen application versions explicitly map the `filtered` setter alias to
`100` and the `full` alias to `0`. The preflight already handles this alias;
the final comparison did not. This is distinct from the earlier, unreproduced
`early-history` transition failure.

The narrow comparison correction at `73ac762b` recognizes only the documented `100` alias,
keeps raw observations unchanged, and rejects `0`, `99`, `"100"`, null and
missing values. Failure diagnostics also retain valid numeric infrared values.
The complete related test group passes 93/93 on Node 24.16.0 and 26.11.0 on
VM105 after synchronizing the validation overlay's stale failure-report helper
to its exact parent source. The unchanged parent passes its 44 weather and
failure-report tests on both runtimes. Original failed test logs are retained.
Windows Node 24 also passes the same 93 checks. Its initial invocation could not
load the incomplete local ESLint installation; the 21 affected checks pass using
the existing dependency installation with the exact lockfile ESLint version.

The full replay's raw evidence is preserved at
`/opt/gods-eye-view-validation/s61-s70-20261018/weather-full-observation-c9c61d01-20261018T235514Z`.
Its bounded failure report retains only four of ten completed samples and is
explicitly truncated. It cannot be reconstructed into a qualifying full report;
a corrected full pair remains necessary. No application setting or deadline
was relaxed.

## Native map profile correction

Producer `52ca6010` completed all five candidate cold launches, then rejected
the map journey before its first readiness checkpoint. The serialized driver
dropped its explicit comparison profile when starting the asynchronous run and
still required a legacy 1440×900 drawing buffer. Native DPR 2 correctly produces
2880×1800. The correction passes the profile through and checks CSS dimensions
times the initial DPR on every observed render, while retaining SSE 1, native
resolution, effects and the existing legacy contract. Regression cases cover
DPR 2, fractional DPR, downscaling and changing resolution, DPR, SSE or canvas
size. The [map profile review](native-map-profile-review.json) binds the failed
report and all 61 focused map/profile/pairing checks passing on both Node
24.16.0 and 26.11.0. Hardware qualification remains pending the corrected pair.

The full Node suites at `52ca6010` exposed a separate test-ledger omission for
the newly added readiness test. Node 26 recorded 9,625 passes, one ledger
failure and seven platform skips. The ledger and formatting scope now include
the new files; all four runner-discovery checks pass locally. These earlier CI
runs remain failures until a new revision completes its checks.

## Completion conditions

### Native map fixture coverage correction

The map attempt at producer `45c9096e` completed five startup samples, five
map journeys and ten timed samples, but failed final integrity. Its six
interception sessions released successfully; the measured document instead
recorded 402 missing-asset observations across 90 distinct paths. The retained
first requests are level-16 OSM imagery, starting at `imagery/16/14985/26981.png`.
The v4 fixture only covered levels 0–15. The aggregate cleanup message therefore
obscured a fixture coverage failure, not an established application resource leak.
The original report remains failed in `map-qualification-1792373760332`.

Fixture v5 adds complete level-16 route coverage and its metadata. All 168
existing compressed high-level PNG patterns remain byte-identical; eight more
patterns complete the original pixel formula's 176-pattern inventory. The
reproducible generator is `scripts/generate-map-native-imagery.mjs`; its `--check`
mode verifies the pinned output. The corpus has 1,994 assets totaling 5,886,509
bytes, bounded by 2,100 assets and 8 MiB including its index. These are fixture
storage limits, not reduced rendering detail. Unknown levels and out-of-route
requests still fail closed. Delivery errors are now checked between journeys
and timed samples, before further repetitions can conceal them behind cleanup.

Native Windows image tests confirmed the previously missing requests decode and
existing patterns retain their bytes. The initial full local image suite then
encountered an outdated overflow-test bound and stalled in its provider-parser
test; it was explicitly cancelled before the next GPU sample. VM105 cannot run
its installed native Sharp binary because its virtual CPU lacks x86-64-v2.
These attempts are not full-suite passes. The corrected six focused image and
corruption tests pass on Windows. The revised delivery/capture/comparison suite
passes 121 checks on both VM105 Node versions, with two Windows-only cleanup
checks explicitly skipped. Logs and hashes are retained in
`native-map-corpus-check-1792376088073`. A new physical fixture capture and the
full image-parser suite remain required.

Application `55639cc7` now contains the weather ownership correction below.
Its exact-commit [signed packaging](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39187761110)
and [tracking](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39187765119)
pass. Its [PR integration CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39187029881)
passes all seven selected jobs. PR merge artifacts are not substituted for the
exact application artifact. Production still serves the verified `e7a878e`.

The cable presentation diagnostic compares the same `19065997` app in fresh
Chrome 152, 155, 155 and 152 processes. Actual full runtime versions and executable
hashes are recorded. This experiment uses default composition and framebuffer
settings and is ineligible for performance acceptance. No browser upgrade
benefit or resolution of the dam/cable regressions is established by a partial run.

### Weather metadata ownership correction

The instrumented producer `52ca6010` reproduced the baseline failure in idle
run 3, after two complete samples. The early-history control dispatched at
7.0 ms and returned at 8.4 ms. At 6,173.2 ms all three layers still displayed
12:00 UTC while the clock selected 11:50 UTC. Each layer had an incoming
observation, no pending/deferred tiles, and seven or eight completed tiles.
The raw report is `weather-corrected-qualification-1792373323643/baseline.json`.
This identifies a staging delay; it does not by itself prove its cause.

A separate deterministic reproduction establishes redundant cancellation:
polling an unchanged manifest during a shared history selection aborts both
the refreshed product and an unrelated product's pending observation. The
narrow correction preserves an owned pending or displayed history selection
when product, times, latest time and coverage are unchanged. Changed metadata,
failed frames, expired history, host changes and explicit selections retain
their existing refresh/recovery paths. No imagery detail or timeout changes.

The new regression fails against the original source and passes with the fix.
All 81 weather-rendering/clock tests pass on Node 24.16.0 and 26.11.0 on VM105;
logs, original source and file hashes are retained at
`/opt/gods-eye-view-validation/s61-s70-20261018/weather-refresh-check-1792374115607`.
The fix has not yet been hardware-qualified and does not clear the original
five-second failures. A new application revision must receive its own build
identity and validation; results for `19065997` cannot be relabeled.

The first same-build cable control completed at producer `6753d211` with motion
p95 434.3 ms and 206 rendered frames. Windows refused foreground activation of
the second fresh browser while Discord held the foreground, before any startup
or timed sample. The four-launch diagnostic is incomplete and supplies no
qualification result. Its raw directory is
`cable-same-build-control-1792372176711`; the failed launch is retained.

An opt-in `--browser-ready-file` handoff now allows the operator to foreground
the owned Chrome window before navigation. It requires a fresh path separate
from capture outputs and the owned PID file, accepts only that browser PID, and
times out after 120 seconds. The original native-window and page-focus checks
still run after the handoff and at their existing boundaries; readiness alone
does not establish foreground ownership. No timed sample or warmup is extended.
The focused readiness, foreground and weather checks pass 55/55 on Node 24 and
26 on VM105, with the Windows-only PowerShell parser test explicitly skipped.
The corresponding 26 readiness/foreground checks, including that parser test,
pass on the physical Windows machine under Node 24.16.0.

The corrected weather replay at producer `6753d211` reproduced a source
transition failure on baseline `e7a878e` in idle run 4. Three idle samples
completed. At 25,305.9 ms, the visible timeline and clock selected 11:55 UTC,
but all three displayed observations still reported 11:50 UTC. The five-second
transition deadline remains a failure; the candidate arm was not started.
The [transition review](weather-transition-review.json) binds this original
failure and the following diagnostic change. It records dispatch timing and
allowlisted per-product loading, tile and imagery counts only when a phase
fails. URLs, provider errors and payloads are excluded. All 30 focused checks
pass on both Node 24.16.0 and Node 26.11.0 on VM105. This adds no runtime
optimization or acceptance waiver.

The [resumed CI receipt](resumed-ci.json) records all seven selected CI jobs and
release verification passing for PR head `6753d211`. The tested PR merge commit
is `55aa2af0aeb0d94ef1cc82f9fd45d36ebe32c573`; both revisions have tree
`98cb3ec0fa6f673ea5a6b48cbdeb831611953863`. This is equal-tree integration
evidence, not an exact-head artifact claim. Twelve optional diagnostics remain
intentionally skipped. No hardware finding is cleared by these CI results.

Identify the cause of the blocking regressions and fix or reject the affected
optimization, preserving visual detail. Qualify the exact resulting application,
including any newly required comparisons; do not relabel earlier application
evidence. Complete weather and map streaming, then verify the signed VM105
deployment, HTTPS/workspace behavior and final 60-minute native Ampfing soak.
Missing evidence remains pending. Earlier failures and missed objectives remain
visible even when a later corrected run succeeds.
