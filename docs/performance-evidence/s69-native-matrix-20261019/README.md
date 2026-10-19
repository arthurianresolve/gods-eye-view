# S69 native Windows matrix checkpoint — 19 October 2026

Candidate `55639cc7` is not yet approved for deployment. Its complete weather
functional capture passes, and its new five-run dam comparison is within the
regression limit: 299.7 ms baseline versus 305.9 ms candidate motion p95 (+2.1%).
Cables also pass: 332.8 ms baseline versus 336.1 ms candidate (+1.0%). The
[corrected map comparison](map-native155-reviewed-comparison.json) passes:
motion p95 is 392.3 versus 398.9 ms (+1.7%); switching readiness is 14,413.9
versus 11,645.0 ms (-19.2%). These are separate from the original map frame
samples, which started from different poses and remain invalid.
The corrected weather control passes all ten functional samples, but its
[timing comparison](weather-control-timing-review.json) flags candidate motion
p95 at 282.7 versus 241.6 ms (+17.0%) and idle intervals at 3,235.5 versus
2,398.6 ms (+34.9%). The
[reverse-order uninstrumented confirmation](weather-confirmation-review.json)
passes all 60 source deadlines across the pair, but repeats the motion flag:
274.2 versus 308.0 ms (+12.3%). Weather performance remains unaccepted. Its idle
interval result reverses direction, illustrating that these gaps include
deliberate request-render idle time; no generic waiver is applied. The bounded
ABBA trace diagnostic remains separate from these full captures.
The missing top-level native-profile
label is derived only after checking every observed boundary; original capture
and wrapper records remain unchanged. Remaining exact-candidate comparisons
are pending, and the completed final soak failed retention. The
[four-state visual qualification](final-visual556-review.json) passes on Windows;
each baseline/candidate PNG pair is byte-identical. VM105 independently verifies
all archived file hashes, while repeat pixel decoding there is unavailable due
to its exposed CPU feature set. The [current report index](native155-matrix-progress.json) binds completed
raw reports; the older `19065997` matrix and failures below remain historical.
Production remains at `e7a878e`.

The [independent Ampfing soak review](staged-ampfing-soak556-review.json) records
171 measured cycles over 3,611,609 ms against the exact signed `55639cc7`
package, using capture producer `a7837467`. Operations, all foreground checks
and normal browser shutdown passed. There were no blur or hidden intervals.
Retention failed: post-GC heap grew 6.32% across the final measurement window,
above the unchanged 5% limit. All 13 checkpoints retained 668 listeners, zero
pending workers and the same measured application resource counts, excluding
cumulative cache-reuse counters. DOM nodes increased from 6,346 to 7,254 and
heap from 252.7 to 290.6 MB across the full run. The source of this growth is
not yet established; stable owner counts alone do not make retention pass.

The original raw report and first independent review remain archived. A second
review corrects only the first review's foreground label: the wrapper's
aggregate failure arose from retention, not foreground activation or process
cleanup. The [combined candidate review](current-candidate556-review.json)
consumes all four completed workload pairs and this soak. It reports weather
and retention failures, with operating view, dense investigation, selected
tracking, datacenters and combined infrastructure coverage still pending.
No earlier application result supplies those missing exact-candidate checks.

The [ownership investigation](retention-ownership-summary.json) fixes two QA
cleanup omissions: an undisposed import-control handle (`9dc2b1cb`) and console
argument handles shared with the page's exclusive fixture consumer (`89601fcd`).
Neither short diagnostic establishes that the hour-long retention failure is
resolved. A separate eight-cycle WeakRef probe demonstrates that Chrome's
inspector retains 42 logged objects independently of those Puppeteer handles.
Clearing only the private test browser's inspector entries collects those
objects and the transient test sentinel; the deliberately retained control
survives. It recovers 100,288 bytes and zero DOM nodes. This is insufficient to
explain the full failed soak's heap and DOM growth, which remains unresolved.
The three failed full-heap capture attempts remain archived as diagnostic
failures, with all owned browsers closed normally.

The [18702e77 CI receipt](qualification-ci-18702e77.json) records all seven
selected jobs and release packaging passing. That commit registers three QA
tests omitted from the discovery ledger and adds a strictly diagnostic weather
mode. The completed [alternating weather diagnostic](weather-interleaved-motion-review.json)
contains five control/candidate pairs with 30-second warmup and 60-second motion
samples. Settings, routes, populations, native drawing buffers and source phases
match; all source deadlines pass. Recorded power stays on AC with the High
performance scheme. The control median is 298.0 ms and candidate median 254.3 ms,
but pair changes range from +32.8% to -19.4%, with two slower and three faster
candidate samples. This variability does not identify a code cause or clear the
two full weather qualification flags. The raw 41 files and three supplemental
review files (1,177,013 bytes) are hash-verified on VM105 under
`weather-interleaved-motion-diagnostic-1792402126285`.

The [map frame review](map-frame-route-review.json) preserves the raw motion
medians, 323.7 versus 361.2 ms. Their apparent +11.6% difference is not a valid
runtime regression finding: the harness restored a home sampled during startup
flight, outside the dedicated map journey's fixed route. The report consumer
also returned after checking switching readiness, ignoring the extra samples.
The correction establishes the declared map pose and speed for frame samples,
validates supplied frame evidence, and compares routes before timing. Historical
journey-only reports explicitly retain `not-collected` frame coverage. All 135
focused tests pass on VM105 with Node 24 and 26; the corrected consumer rejects
the original pair. The corrected native pair completed with producer `aa1e653f`.
The [exact-revision CI receipt](qualification-ci-aa1e653f.json) records all seven
selected jobs and release packaging passing for that correction. Twelve opt-in
jobs were intentionally not requested; these results do not substitute for the
physical Windows captures.

The initial consumer rejected the corrected pair because the actual requested
tile inventories differed. Consumer `37ebd5a9` adds an asynchronous map review
that rebuilds the pinned fixture and independently validates every delivered
asset, journey, rendering readiness and document cleanup before comparing the
fixed corpus. Requested inventories remain in the raw reports and their
differences remain in the review. Other contracts, settings and frame checks
remain strict. This path passes 170 focused tests on both Node 24 and 26,
including malformed assets, missing delivery, pending work, changed routes and
reduced-resolution rejection. The original wrapper failure is retained.
Nine raw map files were hash-verified on VM105 before the clean committed
consumer reviewed them. No runtime or visual-setting change was needed.

The [normal-tool integration receipt](native-map-consumer-integration.json)
records consumer `b20a5c61`: the matrix CLI and candidate manifest CLI now use
independent native map validation. All 179 focused tests pass on Node 24 and 26.
Both entry points accept the actual archived map pair. A manifest containing
only this pair correctly leaves other workloads and retention pending.
The [b20a5c61 CI receipt](qualification-ci-b20a5c61.json) records all seven
selected jobs and release packaging passing. Twelve optional diagnostic jobs
remain intentionally skipped; the earlier 37ebd5a9 CI was cancelled by the newer
push and is not counted as a pass.

The [weather ABBA diagnostic](weather-motion-diagnostic-review.json) ran control,
candidate, candidate, control with one-second diagnostic warmup and 60-second
samples. Motion p95 was 279.6, 262.7, 304.7 and 322.2 ms, respectively; all source
deadlines passed. Render-call wall p95 remained around 25–27 ms, with much larger
and variable gaps before the next callback. These timings are not exclusive GPU
durations and do not prove a specific system cause. All 28 files, totaling
232,068,815 bytes, were hash-verified on VM105. Instrumented samples do not replace
the five-run, 30-second-warmup confirmation or erase the original timing flags.

A second [one-change HUD diagnostic](weather-hud-motion-diagnostic-review.json)
compares `55639cc7` with control `1ecb4cdd`, whose only runtime difference is
removing the unchanged-text guard in `src/hud.js`. Candidate/control/control/
candidate motion p95 values are 237.7, 296.9, 309.0 and 222.6 ms. Every source
deadline passes. These two instrumented samples per build do not support
reverting that guard as a remedy; they do not clear the full weather timing
failure. All 28 files, totaling 235,727,876 bytes, were hash-verified and reviewed
on VM105. The candidate and production application remain unchanged.

The new complete Chrome 155 comparisons do not reproduce the large historical
dam/cable regressions. The separate same-build browser diagnostic does not
establish that upgrading Chrome alone fixed their cause. No runtime changes to
dam or cable rendering, visual detail reduction, composition override or
framebuffer-default change were retained from those diagnostic experiments.
The [independent dam/cable review](native-dams-cables556-review.json) verifies
all 12 raw reports, invocations and logs on VM105 (1,504,666 bytes), then
reproduces both comparisons with the clean `b20a5c61` consumer.

The signed `55639cc7` package is [prepared but inactive](prepared-release556.json).
Its 2,126 manifest files were reverified before and after moving the inactive
staging directory into the release directory on the same filesystem. This
avoids a second package copy on VM105. No service or HTTPS routing changed.
An isolated loopback preview served that exact signed package for the
completed Ampfing soak. Its served HTML matched the prepared package digest
before and after the run.
This is private staging; public HTTPS and operator-workspace deployment checks
remain separate requirements.

## Historical `19065997` revisions and conditions

The following revision list and comparison table describe the earlier matrix.
They are not passes for the current `55639cc7` application.

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

## Historical `19065997` comparisons

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
encountered an outdated overflow-test bound and an apparently stalled parser
test; it was explicitly cancelled before the next GPU sample. A bounded follow-up
found slow test-side pixel allocations: the parser body completed after about
77.5 seconds, after its diagnostic timeout. That cancelled attempt is not a pass.
An earlier malformed diagnostic wrapper skipped its callback and is explicitly
invalid; neither diagnostic supplies acceptance evidence.

The corrected diversity assertion stops after finding nine distinct RGB values,
using numeric values instead of allocating a Buffer and hex string per pixel.
It still fetches, hash-checks and fully decodes every tile, preserving the original
requirement of more than eight colors. All nine image/parser tests now pass on
Windows Node 24.16.0 in 26.8 seconds; the parser case takes 10.9 seconds. The
[full Windows log](native-map-full-windows.txt) retains all nine outcomes.
VM105 cannot run its installed
native Sharp binary because its virtual CPU lacks x86-64-v2; that platform skip
remains explicit. The revised delivery/capture/comparison suite passes 121 checks
on both VM105 Node versions, with two Windows-only cleanup checks explicitly
skipped. Logs and hashes are retained in `native-map-corpus-check-1792376088073`.
A new physical fixture capture remains required.

Application `55639cc7` now contains the weather ownership correction below.
Its exact-commit [signed packaging](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39187761110)
and [tracking](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39187765119)
pass. Its [PR integration CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39187029881)
passes all seven selected jobs. PR merge artifacts are not substituted for the
exact application artifact. Production still serves the verified `e7a878e`.

The exact `55639cc7` archive was independently downloaded and verified against
the repository, release workflow, source commit and GitHub-hosted attestation.
Its SHA-256 is `f2190f1111510d95ab86939e8809c59401423ab721ed9aae06aaf1971c2933f8`.
The [staging receipt](staged-release556.json) binds all 2,126 packaged files,
the weather source hash and bundled application identity. An initial helper
incorrectly expected a standalone `dist/build-info.json`; that attempt stopped
before dependency installation or service changes. The corrected verification
checks the actual bundled identity and preserves the earlier failure log.
Locked production dependencies installed successfully on VM105, and all
[16 private production-host checks](production-host-smoke556.json) passed.
These cover current and retained assets, compression, ETags, ranges, host/route
boundaries and shutdown. The candidate is staged only; deployment still requires
the performance and visual gates.

The completed cable presentation diagnostic compares the same `19065997` app in
fresh Chrome 152, 155, 155 and 152 processes. Actual full runtime versions and
executable hashes are recorded. Motion p95 is respectively 497.7, 312.6, 341.7
and 345.9 ms. In the first launch, `ScheduleOverlays()` has wall p95 264.301 ms
but thread CPU p95 1.049 ms; the other launches have wall p95 4.316, 3.819 and
0.937 ms. These wall durations indicate presentation-path waiting, not GPU
execution time. The last Chrome 152 run overlaps the Chrome 155 results, so
upgrading alone is not a proven fix. Default composition and framebuffer settings
remain unchanged. These four diagnostic captures are ineligible for acceptance;
the new full matrix uses installed Chrome 155.0.8059.84 for both applications.
The [version-control review](cable-browser-version-review.json) records hashes,
trace counts and limitations. All 21 raw files (118,817,425 bytes) were hash-verified
on VM105 in `cable-browser-version-control-563d9dd4-20261019`.

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
Application `55639cc7` subsequently passed its complete native Chrome 155 run:
five startup observations and five 30/60-second samples each for idle and motion.
All 30 source transitions met the unchanged five-second deadline; the slowest
took 3,506.9 ms. Median run-level motion p95 was 282.7 ms. The
[functional review](weather-native155-review.json) binds the raw report and
records all phase delays. Nine raw/evidence files, totaling 914,081 bytes, were
hash-verified on VM105 in `weather-native155-55639cc7-20261019`.

The original `e7a878e` baseline still failed in motion run 2 on Chrome 155: at
5,044.8 ms all three products displayed 12:00 after selecting 11:50, with pending
and deferred tile requests. Its failure remains recorded and cannot supply a
complete timing comparison. Passing candidate observations establish functional
recovery, not a quantified speed improvement against that failed baseline.

A separately named [weather correctness control](weather-control.json),
[`d6bb7a29`](https://github.com/arthurianresolve/gods-eye-view/commit/d6bb7a297cfadc863c3b453a3d7c1fc737aab046), has parent `e7a878e` and changes only
the weather ownership source and its regression test to the exact `55639cc7`
bytes. It is built with the same Node 24.16.0 builder and passes focused tests
on Node 24 and 26. Its completed hardware capture passes functional checks but
flags the timing differences recorded at the top of this report. This control applies
only to weather timing: all other workload comparisons retain the original
baseline. It does not erase the baseline failure or credit the shared
correctness fix as a measured speed improvement. Results for `19065997` are
not relabeled.

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
