# S69 native Windows matrix checkpoint — 20 October 2026

## Current qualification checkpoint

Runtime candidate `a18c6a76` removes the second animation-frame wait from
user-triggered layer preparation. The lifecycle's loading presentation is
already reconciled synchronously; one callback followed by its owned task
preserves a rendering opportunity before preparation. This follows the
[browser rendering guidance](https://web.dev/articles/optimize-inp#yield_to_allow_rendering_work_to_occur_sooner)
without treating it as proof of physical presentation or latency.
The [validation receipt](single-raf-feedback-validation.json) records
146/146 focused tests on both Node 24 and 26 and all static checks passing.
The integration test exercises the real lifecycle/presentation subscription;
abort, hide, supersession, teardown and scheduler failures retain cleanup.
The initial sparse-source formatting setup failure remains recorded, and its
successful Node 24 focused results are reused only with identical source bytes.
The private build is pending hardware qualification; production is unchanged.

The preceding `9d355c29` checkpoint passes all seven selected CI jobs and
release verification, including Windows, macOS and Linux recovery. Its
[integration receipt](qualification-9d355c29-ci.json) independently verifies
equal trees for the PR head and tested merge. Twelve optional jobs remain
skipped. This receipt does not cover the subsequent `a18c6a76` runtime change.

The [bounded actual-CSS reproduction](left-measurement-restoration-review.json)
rejects the proposed attribute-only continuity exemption before any new capture.
All sixteen normal cases start with the target visible. Eight restore exact
geometry and offsets; eight with deliberately disabled scroll anchoring retain
displacement after height styles are restored. Four leave the target outside
its clip. All sixteen deliberately persistent scroll-change negatives are
detected. Both marker and inline-allocation mechanisms, focus/tail layouts
and tactical/cyber styles are covered. Current source does not set
`overflow-anchor:none`, so this is a proof-rule counterexample rather than an
established cause of the earlier application failure. The tested but uncommitted
attribute-only QA draft remains rejected intermediate evidence. Its replacement
must recheck geometry at a natural layout boundary. The larger joint-rail
measurement experiment is parked separately, with 68 passing unit tests but
no browser timing result or shipped runtime change.

The fresh visual cohort passes under the explicitly amended
[source-bound decoration contract](decoration-quantization-v1/policy.md).
The complete `c373d91b` / QA `3cd4d528` cohort retains all 24 images and fails
its original strict consumer. Its 35 files (67,400,789 bytes) are preserved
on VM105 at `repeated-full-extent-c373d91b-3cd4d528-complete-20261020`.
All images were captured on their first attempt, with normal browser cleanup.
Independent examination of all sixty pairs isolates differences to the
unchanged logo filter and badge border, with equal source/semantic evidence.
The later cohort includes stable one-level cross-build shifts, so this is
not a claim that all differences are random.

The prospective rule uses independently calibrated channel bounds of two for
the source-derived logo filter support and seven for the mathematical badge
border. The logo's opaque interior, badge text/interior, exterior RGB and
all alpha remain exact. Complete source, text, actual font, geometry and
capture-boundary proof must match, and every one of the sixty pairs must pass.
No pixels are ignored and no nearest-control fallback or pixel-count budget
applies. Commit `2e448245` implements the opt-in rule. Its initial 88-test closure
and final eleven affected tests pass on both Node 24 and 26, along with 43
Windows image-integration tests. Independent source/receipt review passes.
The newly declared and captured cohort below supplies this visual validation.

The first `2e448245` / `e6e1abc1` new-policy attempt stops before its first
PNG: the proof validator requires nonempty boxes from all ancestors,
including the existing `display: contents` badge wrapper. The raw failure
does not preserve the exact rejected rectangle, so the source-based diagnosis
is not presented as a recovered browser measurement. Normal owned-browser
closure passes. Correcting that proof requirement leaves visible surface/text
boxes, source/style equality and pixel limits intact.

Commit `7ab0acac` implements that correction and retains the exact rejected
proof inputs on future failures. Its [validation receipt](decoration-boxless-validation.json)
records 36/36 focused tests, formatting and undefined-reference checks passing
on both Node 24 and 26, with independent source/log readback. A separate
four-state check of the actual baseline page passes on each first attempt:
the sole zero-box ancestor is the existing `DIV.cyber-panel-body` with
`display: contents`; the visible decoration and text remain nonempty.
This check captures zero images and is explicitly ineligible for visual
acceptance. Its seven files (5,165,019 bytes), including result SHA-256
`3b7c4d3b90be77057b0e84f5175a95e1310e9a38362773cded4d0db2c72bba20`,
are preserved at VM task
`decoration-eligibility-e7-boxless-complete-20261020`.
The fresh [`e6e1abc1` / QA `7ab0acac` cohort](decoration-quantization-e6e1abc1-result.json)
passes all 24 images and all sixty comparisons on its first capture attempts.
All six browsers close normally. The declared exact regions have zero changed
pixels; observed logo channel differences are at most one and badge-border
differences at most seven. All source, geometry, text, actual-font and capture
proofs pass. Its 38 files (95,766,251 bytes) are preserved at VM task
`repeated-decoration-e6e1abc1-7ab0acac-complete-20261020`.
Independent VM decoding and comparison of the same immutable images also
passes all sixty comparisons. Historical strict-policy failures remain failures;
this result supplies visual equivalence for the fresh candidate cohort, not
interaction, motion-performance, soak or deployment acceptance.

The [rail measurement correction](rail-measurement-validation.json) at
`e6e1abc1` preserves the existing layout equations while reading invariant
spacing before temporary measurement styles are restored. Both Node versions
pass 96 focused tests; the two new regression cases fail on the original
runtime. The earlier Node 24 package check ended with SIGKILL during observed
VM memory exhaustion, rather than the initially suspected timeout. Its empty
log and failed receipt remain preserved; the missing check passes in isolation.
The first new paired hardware attempt stops before navigation or samples:
the page has its maximized 1280 × 537 viewport, but CDP still reports
1037 × 511. The exact consistency check rejects the transient disagreement.
Its six files (71,185 bytes) are retained at VM task
`native-window-rail-comparison-e6e1abc1-3360f672-preparation-failed-20261020`;
the browser closes normally with no forced termination. This is not
application performance evidence and establishes no latency benefit.

The preparation correction at `e26b0b54` now requires two consecutive complete
and exactly matching Windows/CDP/page proofs before navigation, retaining
every attempted proof. It bounds preparation and failed-session cleanup;
post-navigation checks remain single-shot. Formal reports also retain and
validate the configured trace. The [validation receipt](native-window-settlement-validation.json)
records 153/153 focused tests on both Node 24 and 26 and all required static
checks passing, with independent source/input/log readback. The initial sparse
setup failure is retained separately; its missing tracked helper is present
in the passing run.

The fresh [paired hardware diagnostic](native-window-rail-e6e1abc1-diagnostic.json)
and [independent readback](native-window-rail-e6e1abc1-readback.json)
complete all sixteen trusted actions in four normally closed browsers.
All four preparations encounter one incoherent observation followed by two
matching coherent observations, exercising the actual transient condition.
Twenty native canvas checkpoints and four configured proofs pass.
The 1280 × 537 CSS viewport, native DPR 2 and 2560 × 1074 drawing buffer match;
all enabled/disabled geometry and ordered height-query tuples match.

Both `c373d91b` and `e6e1abc1` have three of eight native Event Timing
observations above 100 ms, all on disabling datacenters. The candidate observations
are 40, 96, 48, 112, 80, 128, 80 and 128 ms. Median full scene readiness
changes from 303.7 to 304.75 ms for enabling and 17.85 to 16.65 ms for disabling.
These mixed diagnostic results establish neither an interaction pass nor a
repeatable performance benefit. The formal twenty-sample capture below omits
these additional attribution observers.

The [exact `e6e1abc1` CI receipt](rail-layout-e6e1abc1-ci.json) records
seven selected CI jobs and release verification passing. Node 24/26,
production builds, browser journeys, Windows onboarding and installation/
recovery on Windows, macOS and Linux pass. Twelve optional dispatch-only
jobs are skipped, not passed. Hardware qualification remains separate.

The formal producer at `ff927fb2` adds explicit native-window qualification
without changing old fixed-size reports or timing gates. Its
[validation receipt](native-window-metrics-validation.json) records 146 tests
passing on each Node version, plus the required static checks. This implements
the capture/consumer contract; it does not qualify the application by itself.

Commit `f6e35691` adds an explicit identity-only input for this formal producer.
It checks the exact application/build/browser identities, complete source and
served assets before and after the whole capture, and the live owned-window
proofs. It retains one full envelope with digest references from interaction
and heap evidence. Legacy and weather inputs retain their interpretation;
inputs cannot be mixed, and the new source supplies no startup or performance
credit. Its [validation receipt](qualification-build-identity-validation.json)
records 167/167 focused tests on both Node versions, plus formatting,
undefined-reference, import and package checks passing. Independent readback
matches all eight source files and ten raw logs. Earlier sparse-setup and
explicit 512 MiB heap-cap failures remain preserved; the package check passes
using the previously validated environment.

The completed [formal capture](formal-native20-e6e1abc1-f6e35691-result.json)
uses correctness control `76cc760b`, candidate `e6e1abc1` and QA `f6e35691`.
Both builds complete twenty local-control actions, twenty loaded replay seeks
and 84 heap samples. All source, asset, native-window and foreground checks
pass, and both browsers close normally. The [archive readback](formal-native20-e6e1abc1-f6e35691-readback.json)
binds fifteen files (2,723,889 bytes), independently hash-verified on VM105.
One short concurrent metadata-writing command is disclosed in the run conditions;
its exact timing and effect are unknown.

The frozen consumer rejects local-control evidence because all forty actions
contain an unproven-geometry observation after positive visible feedback and
before their Event Timing endpoint. It does not establish actual hidden feedback:
the old producer did not retain mutation categories. These reports remain failed.
The raw Event Timing p95 is 160 ms for control and 216 ms for candidate;
these are descriptive values without acceptance credit. The candidate's first
two actions take 296 and 216 ms, while later actions range from 48 to 112 ms.
Both the continuity proof and the runtime delay require correction or diagnosis;
fixing the proof alone would not establish the unchanged 100 ms gate.

Loaded replay passes at p95 55.4 → 79.5 ms against the 250 ms limit.
Sampled peak heap is 73,152,748 → 71,763,568 bytes, a 1.899% reduction and
within the regression gate. This is sampled non-GC peak heap, not retained
heap or a soak result. Cold startup is unavailable for the deliberately
identity-only input. No capture is repeated or observation removed to obtain
these results; the next GPU run awaits the separate proof and runtime fixes.

The completed [native-window diagnostic](native-window-c373d91b-diagnostic.json)
and [independent VM readback](native-window-c373d91b-readback.json) retain all
six raw files (1,712,120 bytes), twenty owned-window checkpoints and sixteen
isolated trusted actions. Driver `3360f672` proves the actual 1280 × 537 CSS
viewport / 2560 × 1074 drawing buffer fits the physical Windows display at
native DPR 2, 100% page/pinch zoom and unchanged rendering settings.
All enabled geometry, disabled geometry and ordered height-query tuples match
between control `8c14b106` and candidate `c373d91b`.

Candidate native Event Timing observations are 40, 128, 48, 96, 56, 144, 48
and 128 ms: three exceed 100 ms, compared with two of eight control actions.
Candidate OFF scene completion takes 14.7–27.8 ms, but next rendering takes
96–144 ms. One left-panel callback contributes 32.4 ms of forced layout;
the remaining delay has no established unique cause. Cold/order-first ON
readiness remains variable and slower in this small candidate cohort.
The eight actions per build, verbose attribution and distinct viewport make
this diagnostic ineligible for the twenty-sample qualification gate.
There is no performance pass or claim that viewport fit resolves the latency.

The first native-window preparation stopped before application navigation,
with no samples, because the driver used scalar coordinate rounding instead
of Chromium's enclosing-edge rectangle conversion. That failure remains at
VM task `native-window-diagnostic-c373d91b-087677c0-preparation-failed-20261020`.
The corrected driver rejects one-pixel boundary mismatches and passes 111
focused tests on both Node 24 and 26, plus formatting, package boundaries and
capture checks. Its completed diagnostic is preserved at
`native-window-diagnostic-c373d91b-3360f672-complete-20261020`; all four browsers
closed normally without forced termination. The preceding
[CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39407063407)
passes all seven selected jobs. Production remains `e7a878e`.

The subsequent [frame-phase trace](render-phase-c373d91b-diagnostic.json) retains
four actions and both complete browser traces. The earlier 95.3–107.2 ms
first-disable full-render delay does not recur; the candidate completes its
scene frame at 30.3 ms, but the browser Event Timing API records 240 ms
(236.024 ms in the unrounded trace).
Rail layout delays commit, followed by 167.2 ms from commit to presentation.
No unique GPU cause is established. All four traced interactions exceed 100 ms;
this diagnostic does not qualify latency or replace the earlier failures.

The [independent display audit](native-display-viewport-audit.json) confirms
that the fixed 1440 × 1000 CSS fixture preserves native DPR, but its 2880 × 2000
canvas exceeds the currently observed 2560 × 1440 physical display. Historical
evidence lacks owned-window fit measurements. The additive visible-window mode
above now establishes that separate condition without changing the old fixtures
or lowering native pixel density and visual quality.

Runtime `c373d91b` passes [CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39403609327)
and [release-artifact verification](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39403609275).
This includes Node 24/26, browser journeys, production builds, Windows onboarding
and recovery on Windows, macOS and Linux. Optional dispatch-only jobs were
skipped; hardware performance acceptance remains separate.

The earlier untraced [natural-feedback diagnostic](natural-feedback-c373d91b-diagnostic.json)
retains all sixteen isolated actions comparing `8c14b106` with `c373d91b`.
Every action has a matching native Event Timing entry; six of eight candidate
observations exceed 100 ms, versus five of eight control observations. First-OFF
full readiness takes 95.3–107.2 ms on the candidate and 14.9–18.3 ms on control,
despite early visibility cleanup and zero height queries. The extra wait occurs
before the first recorded `preRender`; the capture cannot identify pending
worker state or the precise scheduling cause. The panel callbacks start after
that readiness timestamp.

All recorded geometry and ordered height-query tuples agree exactly across this
eight-record fixture after visible first-render grounding was restored. That
does not qualify raster quality or arbitrary scene overlap. All four slots use
1440 × 1000 CSS pixels at DPR 2, matching the preceding `f637e20c` diagnostic
and differing from the 1440 × 900 visual captures. The report binds the six raw
files (1,693,829 bytes), independently rehashed on VM105. This is not the required
twenty-sample interaction cohort; the 100 ms target and 10% readiness gate remain
unchanged and unqualified. Production remains unchanged.

The earlier [hidden-grounding diagnostic](hidden-layout-f637e20c-diagnostic.json)
preserves sixteen actions comparing `8c14b106` with `f637e20c`. Native
next-rendering latency exceeds 100 ms in five of eight candidate observations
and four of eight baseline observations. Candidate event processing itself
takes 2.9–10.3 ms. The cold exact-height task still overlaps pending browser
presentation; OFF can also be slow without height queries. Initial readiness
improves in this small diagnostic, but this is not an acceptance cohort.
Hidden-source grounding changes the pick command set; flat-fixture geometry
differences below 0.1 mm do not prove arbitrary building/overlap equivalence.
That grounding experiment was rejected; `c373d91b` restores normal visible
first-render grounding and retains the independent cleanup improvements.
The historical failures remain preserved.

The first full-application run with the new pointer-sweep harness stopped before
any screenshot because descendant `pointerleave` events were incorrectly
treated as document exits. Its four partial files (35,294 bytes, zero PNGs)
are preserved and hash-verified at VM validation task
`repeated-full-extent-f637e20c-3e71b4f6-failed-20261020`. The observer
correction at `f5cac94f` matches the application's boundary-event semantics;
49 tests pass on both Node 24 and 26. It does not relax any visual threshold.
An actual-application baseline still capture now succeeds. A subsequent
HUD-visible capture reached its guard deadline; that failed attempt is preserved
and under investigation. No full visual acceptance is established.

The `f637e20c` CI unit and release checks fail one brittle mobile-height
source-text assertion. The behavior-based replacement at `77d7fc13` passes
57 attribution/panel tests on both Node 24 and 26; full CI must still be rerun.
Historical checks and the frozen r21 report below remain unchanged.

The earlier [isolated ABBA scheduling diagnostic](feedback-runtime-8c14b106-isolated-diagnostic.json)
compares `2663fbff` with runtime experiment `8c14b106`. It retains all sixteen
trusted actions and their matching Event Timing entries, with a fixed one-second
drain between actions. Both builds have six of eight next-rendering observations
above 100 ms. Four first actions fail the frozen focus-isolation policy; the
observer also captures descendant focus and did not record its target, so these
failures remain recorded. Among the six isolated candidate actions, four still
exceed 100 ms. No acceptance benefit is established for the yield-only change.
The trace identifies forced layout in the left/right panel callbacks, separately
from the exact depth queries on enable.

The [natural pointer-sweep experiment](natural-pointer-sweep-diagnostic.json)
produces three byte-identical positive logo captures. A deliberate one-unit SVG
geometry shift still changes 1,794 pixels, with maximum RGB difference 195.
Only trusted pointer input changes; CSS, geometry, masks and pixel thresholds
remain unchanged. This standalone result supports the capture-harness fix but
does not clear full-application visual qualification.

The [full CI run for `3add2a3a`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39395627455)
and its [release verification](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39395627520)
pass, including Windows recovery. These results do not replace hardware
qualification for a new runtime.

The current application candidate is `190c5ab6`; public production remains at
`e7a878e`. Engineering completion remains **21/24 slices (87.5%)**. The latest
exact-current-190 CI checks passed. The complete r21 integrated review is
recorded at [final-review-190c5ab6-r21-20261020.json](final-review-190c5ab6-r21-20261020.json)
(SHA-256 `b800329bc9f5a0713365584f00037f29b4a8698e07c7ff0f772a86d45b6dc1e3`);
it returns `NOT_ACCEPTED`. Of 12 gates, ten are measured and two fail:
local-control interaction and strict visual equivalence. No gates are pending.
The earlier r15 and r18 outputs used incomplete evidence configurations and are
preserved under [qa-artifacts/preserved-intermediate-reviews-20261020](../../../qa-artifacts/preserved-intermediate-reviews-20261020/)
but superseded for current status by r21. The
[Windows recovery job for `220349dd`](windows-recovery-220349dd-failure.json)
fails browser shutdown after successful data checks. No production activation
is claimed.

The new [default-boot startup confirmation](normalized-startup-default-boot-190c5ab6-79d555cf-report.json)
passes its predeclared ten-slot startup-only gates: app-ready +5.383% and
loading-hidden -0.0219%, within 10%. Its independent VM readback is recorded as
measured. The integrated cold-startup gate is measured under this explicitly
scoped default-empty-layer boot contract. The earlier live-provider startup
regressions (+28.53% / +26.46% in the page-observed run, and +43.23% in the
original matrix dams row) remain preserved as failed historical evidence; this
confirmation does not retroactively clear them or measure dam activation cost.

The [v3 interaction/heap report](normalized-interaction-heap-190c5ab6-cd4005dd-report.json)
passes loaded replay seek at 91.3 ms p95 and sampled peak heap at -2.634%.
Local-control visible feedback is 709.3 ms p95 and full readiness regresses by
more than 10%, so the metrics report remains failed. The 76cc control includes
the same correctness changes and is not the original e7 runtime.

The final signed-`190`/`b843` Ampfing soak **passes**: 60m39s, 251 cycles,
2.895% retained-heap growth. The weather balanced comparison and idle
disposition are measured. The new
[five-run cable idle capture](cable-settled-idle-190c5ab6-79d555cf-report.json)
records zero frames in all five candidate windows. Its baseline records 13
frames in the first window and zero in the others. The corrected evaluator at
`0c5c4608` and the independent r21 review apply the unchanged budget to the
candidate: cable idle is measured, the candidate passes all five windows, and
the baseline's first-window failure remains preserved. Full visual
qualification still fails its strict pixel policy. The r21 review measures
the operating-view idle interpretation, weather comparison and disposition,
soak, private workspace, CI and signed-release artifact; only interaction and
visual equivalence fail in that complete review.
The stale pre-readiness HUD comparison was corrected separately at `220349dd`;
all screenshot-boundary HUD states agree. Production remains unchanged.

The QA observer correction at `42fae51d` retains valid feedback when the same
intent changes from transition to settled text between frames. The subsequent
four-slot ABBA diagnostic still finds delayed feedback on both builds. The
transition settles before the first natural frame; eight synchronous height
queries consume 310–555 ms on each enable. This identifies work to fix without
clearing the earlier failed acceptance report. The separate `716b6cc3` runtime
experiment also fails the 100 ms visible-feedback target: all eight candidate
two-RAF feedback samples fall between 134.1 and 688.5 ms. It changes application
code and is a runtime experiment, not a QA-only validation or acceptance pass;
its diagnostic remains non-acceptance evidence. The [normalized runtime
report](feedback-runtime-716b6cc3-diagnostic.json) preserves all 16 original
rows, and the [browser-recovery check](windows-recovery-716b6cc3-success.json)
passed. A separate `2663fbff` runtime diagnostic reports 37–103 ms disable
full-render time and two-RAF visible feedback above 100 ms in seven of eight
samples; see [its diagnostic report](feedback-runtime-2663fbff-diagnostic.json).
The [supplemental Event Timing diagnostic](event-timing-2663fbff-diagnostic.json)
finds seven matching click entries with 136–624 ms next-rendering duration;
one entry is unavailable. Processing takes 2.7–18.8 ms. The browser durations
confirm presentation delay but do not isolate GPU execution from compositor
scheduling or measure physical display time. They do not replace the existing
100 ms target or clear either failed runtime experiment.

The final signed-`190`/`b843` Ampfing soak **passes**: 60m39s, 251 cycles,
2.895% retained-heap growth, native Windows UHD 620/Chrome 155, with schedule,
foreground, cleanup and owned-resource checks passing. See the [normalized soak
report](ampfing-soak-190c5ab6-b843-20261020-report.json). The earlier no-space
attempt remains historical; the [r11 integration report](qualification-r11-20261020-report.json)
is a preserved partial review and is superseded for current status by r21.

The subsequent QA-only URL fix `45cd4c6a` prevents preview origins ending in a
slash from producing `//?welcome=0` requests. The [exact current fixture closure](qa-boot-url-fix-20261020.json)
passes nine tests on each of Node 24 and 26. Frozen hardware producers and the
application runtime remain unchanged.

The newer [Windows recovery job at `62295363`](windows-recovery-62295363-failure.json)
fails during owned-page cleanup after settings, workspace and rendered-asset
checks pass. One page target remains before browser shutdown, which subsequently
completes normally without forced termination. The page helper conflates
rejection and timeout; its two-second bound and pass criteria remain unchanged.
The failure is archived on VM105 and is separate from the passing native GPU
soak. This QA revision leaves the application runtime unchanged.

The [cable follow-up](cable-idle-followup-324eebe1-20261020-review.json) observes
zero frames in both settled 60-second idle windows, no tile-progress events and
no completed provider resource entries. The original burst is not reproduced;
one diagnostic pair cannot qualify its unavailable frame-interval comparison.
Completed resource entries do not prove that no requests were in flight.

The [completed interaction and sampled-heap capture](interaction-heap-190c5ab6-b843cac5-review.json)
passes source, identity and transfer verification. Candidate loaded-replay
response is 90.9 ms p95, within 250 ms; sampled peak heap changes -0.56%.
Local controls remain above the original 100 ms target: 625.4 ms p95 through
completed layer readiness and rendering, versus 704.2 ms on the control.
The [six-toggle timing diagnostic](local-datacenter-toggle-190c5ab6-review.json)
finds enable calls take 2.7–8.5 ms and active-button updates 6.8–20.7 ms. Its
first matching frame does not require completed LOD, so it cannot replace the
failed qualification result. All diagnostic listeners and wrappers are restored.

The [height-query attribution](local-control-height-attribution-20261020-review.json)
then measures eight synchronous `scene.sampleHeight` calls on each enable,
consuming 301.4, 242.6 and 82.3 ms. Disable actions make none. This identifies
repeated height work as a contributor to latency. A [cache prototype was rejected](ground-sample-cache-disposition-20261020.json)
before runtime adoption because it could not establish safe surface ownership
using Cesium's public API. These six instrumented actions do not replace the failed
qualification result or certify completed LOD placement.

The [four-page transition diagnostic](visual-transition-path-b843cac5-20261020-review.json)
and [paint-signature comparison](visual-paint-signature-b843-20261020-review.json)
establish variation within an unchanged build. The later candidate image is
identical to an earlier baseline image, despite a 7,751-pixel difference from
its own earlier capture. The new cross-build pair differs by eight pixels at
maximum channel delta seven. These observations narrow the investigation but
do not replace the failed full visual comparison or relax its policy.

The [radio-state follow-up](visual-radio-state-20261020-review.json) records no
active radio animation and equal paint signatures across builds. Its new pair
differs by eight pixels at a maximum channel delta of seven. Earlier within-build
header variation remains unexplained; no masks or tolerances were changed.

All seven required [CI jobs and release packaging at `abc6dd91`](qa-ci-abc6dd91.json)
pass. This revision changes QA only; the application candidate remains
`190c5ab6`. The [signed-package Ampfing soak attempt](ampfing-soak-190c5ab6-no-space-review.json)
failed after 26.5 minutes and 108 measured cycles when the Windows drive filled
up. IndexedDB returned `FILE_ERROR_NO_SPACE`, and recording export failed with
a storage quota error. Browser cleanup succeeded. The failed evidence is
archived. The subsequent 60m39s run and final 30-minute retention assessment pass
after space recovery and addition of a QA-only reserve guard, as recorded above.
Production remains at `e7a878e`; no stable release has been promoted.

The failed dam-labelled startup comparison measures empty-layer application
boot before the dam layer is enabled. Its startup shard records no camera pose.
It therefore remains an app-startup failure, separate from dam activation and
the passing dam motion comparison.

The [new coverage preflight](startup-coverage-preflight-20261020-review.json)
completed one candidate document but found eight worker targets whose network
sessions were not observed, plus five font/stylesheet requests outside the
fixture allowlist. The proposed ten-slot synthetic-provider comparison was not
started. This preserves the original startup failure while identifying gaps in
the proposed measurement setup; it is not a runtime failure or timing pass.

The [current dense investigation comparison](dense-investigation-190c5ab6-result.json)
completes five observations per scenario. Motion p95 changes 518.1 to 405.1 ms
(-21.81%), tracking 1,122.4 to 1,113.4 ms (-0.80%), and idle -9.10%; no scenario
exceeds the 10% regression limit. App startup changes -19.49% and loading
completion -10.45%. VM105 independently verified all seven raw files. Baseline
reuse remains declared, so this does not establish interleaved repeatability or
the combined dense/tracking 20% objective. The [datacenter comparison](infrastructure-datacenters-190c5ab6-result.json)
also completes: motion p95 changes 288.1 to 259.2 ms (-10.03%), app startup
-10.69%, and loading completion -11.49%. Its idle interval is unavailable in
both builds and remains unscored. The [combined infrastructure comparison](infrastructure-190c5ab6-result.json)
also completes: motion p95 changes 320.9 to 316.9 ms (-1.25%), app startup
-40.45%, and loading completion -28.82%. Its idle interval is unavailable in
both builds. All requested matrix captures are archived, with baseline reuse
explicitly recorded.
All seven required [QA CI jobs at `4567b9a8`](qa-ci-4567b9a8.json) and release
packaging pass, as do the [earlier `975a7f24` checks](qa-ci-975a7f24.json).
The tested application remains `190c5ab6`.

The [fresh operating-view idle review](idle-cadence-190c5ab6-b843cac5-review.json)
validates the exact current candidate, original baseline, browser, fixture,
native profile, and diagnostic source. It classifies the longer rendered-frame
interval as an intentional change in render demand. The original numeric flag
is preserved; this resolves only its interpretation, not motion performance or
visual equivalence. Cable idle still has an unexplained first-sample burst of
ten frames; the other four candidate samples and all baseline samples are idle.

The current runtime candidate is `190c5ab6`; public production remains at
`e7a878e`. Its fresh dam motion comparison is within the regression limit,
but the independently confirmed startup regression remains unresolved. The
[four bounded startup CPU profiles](startup-cpu-attribution-dams-190c5ab6-97c82fca-review.json)
show graphics initialization work in both builds without establishing a
candidate-only cause. Their
[supplemental interpretation](startup-cpu-attribution-dams-190c5ab6-97c82fca-source-interpretation.json)
corrects the initial grouping of a minified Cesium function as garbage collection
and identifies context-probe instrumentation. Neither report is timing acceptance.

The [four fixed-provider startup observations](startup-provider-fixture-dams-190c5ab6-4567b9a8-fixtures-ready-review.json)
complete in the declared control/candidate/candidate/control order. App readiness
is 3,047.7 / 3,127.7 / 2,582.6 / 2,582.2 ms. All responses from the five declared
map-provider origins match the diagnostic fixture, with no unmatched requests
and normal cleanup. The earlier 28.53% gap does not recur in this small diagnostic,
but changed synthetic payloads prevent timing acceptance or attribution to a
specific provider. The live-provider failure remains unresolved. The
[preceding setup failure](startup-provider-fixture-dams-190c5ab6-4567b9a8-review.json)
occurred before browser creation because the sparse producer checkout omitted
the dam data file; it contains no timing observations. The restarted run uses
the same producer after materializing and hash-checking the committed fixtures.

The [candidate CI review](exact-ci-190c5ab6.json) now includes the explicit
tracking run at `190c5ab6`, alongside its passing standard CI and signed-package
workflow. Every required standard job checked out `596a5d32`; the recorded Git
objects prove that this PR merge has the same source tree as the candidate.
Tracking and packaging used `190c5ab6` directly. VM105 independently verified
thirteen raw workflow, checkout-log, Git-object and review files. Skipped
optional jobs remain skipped, and this does not replace hardware qualification.

The [fresh visible-wind probe](weather-visible-wind-probe-190c5ab6-6025a88e-foreground-ready-review.json)
passes flow, pause and resume for both current candidate and correctness control;
the original camera and pause state are restored. The
[full ten-shard comparison](weather-balanced-190c5ab6-review.json) completes and
passes independent hash/identity verification for all 57 files. Median motion
p95 changes from 242.9 to 234.1 ms (-3.62%). Its
[startup review](weather-balanced-190c5ab6-startup-review.json) stays within the
10% limits: app readiness +1.94%, loading completion -1.84%.
Idle frame spacing changes +85.68%; the raw flag remains recorded separately.
The [original consumer rejection](weather-balanced-190c5ab6-idle-disposition-review.json)
is retained: it incorrectly compares `workload.fixtureId` with the workload ID.
The correction uses the fixture's own ID and
[passes 36 focused checks on each Node version](weather-fixture-identity-validation-20261020.json).
The updated positive case fails against the old source, and swapped identities
remain rejected. The [exact committed `ae74be8b` consumer](weather-balanced-190c5ab6-idle-disposition-ae74be8b-review.json)
validates the unchanged real probe and resolves only the idle frame-interval
interpretation. It does not claim CPU/GPU savings or establish another
workload's acceptance. Capture-producer identities remain unchanged.

The qualification capture now accepts an identity-only pair from the complete
validated weather envelope. It verifies all ten child hashes and requires exact
control/candidate roles, a shared declared pair, matching browser/renderer and
native visual profile. The single shards retain `comparisonEligible: false`;
their startup values cannot replace the separate five-pair startup review.
[All 38 focused tests](weather-identity-validation-20261020-r3.json) pass on
Node 24 and 26 on VM105, and the same reader validates the original real envelope.
The initial test fixtures omitted [integrity status](weather-identity-validation-20261020.json)
and [per-capture browser metadata](weather-identity-validation-20261020-r2.json);
those failed test results remain recorded. The fixture corrections do not alter
the reader's checks or the original evidence. Fresh interaction and sampled-heap
measurements remain pending.

The [full visual attempt with producer `97c82fca`](final-visual-190c5ab6-97c82fca-failure-review.json)
stops before any screenshot. Its guard observes phase 2 nine times, then phase 0
while REC and summary are unsettled; eleven calls started and ten returned before
the five-second deadline. The complete failed reports and normal browser and
interception cleanup are independently verified on VM105. The
[subsequent `25cab4fd` attempt](final-visual-190c5ab6-25cab4fd-preservation-review.json)
captures all four states for both builds, then fails pixel validation for
`hud-visible`. All eight PNGs and the complete reports are preserved and
independently hash-verified on VM105. [Pixel localization](final-visual-190c5ab6-25cab4fd-pixel-localization-review.json)
finds 78 changed pixels in still-settled (maximum channel delta 103), eight in
HUD-visible (maximum 7), exact HUD-hidden output, and 764 in HUD-restored
(maximum 103, around the logo). Recorded presentation state agrees. The
restored-state discrepancy remains unresolved; no mask or threshold changed.

The follow-up capture diagnostic separates debugger initialization, host command
latency, page snapshot time, and pixel readback time, and records the observed
scene frame number. Its bounded guard history is retained for successful and
failed attempts. The [source-bound VM validation](visual-guard-timing-validation-20261020.json)
passes 46 focused tests on each of Node 24 and 26, formatting, and the current
77-file capture lint inventory. VM105 cannot load the installed Sharp binary
because its CPU lacks x86-64-v2; the image suite remains in the required hosted
unit-test inventory. No new hardware visual acceptance is claimed by these tests.

The hosted Node 24 and 26 suites, including the image tests, pass for QA commit
`25cab4fd`. Its [Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39346101215/job/118378956242)
[fails during browser shutdown](windows-recovery-25cab4fd-failure.json) after the
interrupted-update workspace and settings checks pass. Chrome acknowledges
`Browser.close` and disconnects within 12 ms, but the owned browser and Crashpad
process remain at the ten-second exit bound; forced cleanup is confirmed. No
page, renderer or GPU process remains in that final process-tree observation.
The original failure is retained. The [single same-revision Windows repeat](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39346101215/job/118387237373)
passes without source, browser-selection or deadline changes. All seven required
CI jobs are now green at `25cab4fd`; Linux/macOS recovery, Windows onboarding
and release packaging pass. This hosted software-renderer result does not replace
physical GPU evidence. The tested PR merge `177463db` has the same source tree
as `25cab4fd`.

The later QA revision `ae74be8b` fails its
[mixed-use soak preflight](street-level-ae74be8b-failure.json) within the Street
Level browser job. Fixture delivery, content hashes and all eight materialized
datacenters are verified, but no feature becomes renderable during 75 completed
frames. The recorded camera pose is an initial observation, not the pose at
failure. The other six required CI jobs and release packaging pass. VM105 retains
the original failed log and metadata; the tested merge `4a155da5` has the same
tree as `ae74be8b`. A possible startup-navigation race is being investigated.
The failure is not classified as a runtime regression without further evidence.

The QA-only correction pins the fixture view through the production share-link
decoder at both navigations, preserving the declared OSM/DENSE 75 settings and
explicit current visual defaults. It requires two distinct completed frames
after acquiring camera ownership and captures the actual failure-time pose.
[All 54 focused checks](soak-camera-ownership-validation-20261020-r3.json) pass on
Node 24 and 26 on VM105. Replacing only the corrected camera helper with its
original source makes the frame-ownership regression fail with an assertion.
The initial [formatter configuration failure](soak-camera-ownership-validation-20261020.json)
and [test-fixture failures](soak-camera-ownership-validation-20261020-r2.json)
remain available. Hosted QA `7ff9736a` now passes the datacenter preflight:
eight features are active at the correct New York pose, three completed frames
are witnessed and disabling the layer releases its materialized/renderable
population. The run then [fails at replay in cycle 0](street-level-7ff9736a-failure.json)
after successful workspace/import and archive recovery steps. All six original
failure/log/metadata files are hash-verified on VM105. The other six required
CI jobs, including Windows recovery, and release packaging pass. Replay remains
under investigation; no runtime or acceptance threshold changes are included.

The follow-up replay patch starts a fresh document after programmatic recording
seeding, checks the expected select option, and commits the timeline control
before refreshing Flights. Option selection and recording loading share one
30-second deadline. The stale-document path is concrete, but is not proven to
be the historical CI timeout's cause. Bounded diagnostics retain failed replay
states without recorded payloads.

The [full hosted run at `b843cac5`](qa-ci-b843cac5.json) now passes all seven
required CI jobs and release packaging. The rendered mixed-use smoke and the
remaining browser journeys complete; Windows onboarding and Linux/macOS/Windows
recovery pass. VM105 independently verifies the raw workflow records. This
confirms the corrected smoke path; it does not clear hardware visual or
performance gates, and the historical failed runs remain preserved.

Two fixed four-page visual diagnostics stopped before images: the
[first](visual-transition-path-20261020-review.json) failed readiness, and the
[observed follow-up](visual-transition-path-observed-20261020-review.json)
retains the missing readiness details and its later atomic-guard timeout.
Eleven completed observations never find REC visible together with phase zero;
pixel reads take 111–355 ms. A QA-only correction avoids reads while REC is
hidden and reads the same two edges in one shallow strip. The five-second
deadline and all image masks/tolerances remain unchanged. The original reports
and normal cleanup receipts are hash-verified on VM105. The combined replay,
capture and production timeline/source tests [pass 122/122 on Node 24 and 26](replay-capture-validation-20261020.json).
Fresh browser evidence is still required.

The infrastructure-labelled startup shards measure empty-layer boot and the
default Austin fly-in before activating dams. Both builds use live Esri and
Re:Earth responses without payload hashes. A new, separate four-slot ABBA
diagnostic will use the existing deterministic Austin map responses to test
that variable; it will not replace the failed live-provider comparison. It
requires response acknowledgements, payload hashes, bounded redacted unmatched
request records and confirmed interception cleanup. The synthetic imagery and
terrain change decoding/rendering work, so the report explicitly rejects
acceptance use. [55 focused checks per Node version and 79 lint files pass](startup-provider-validation-20261020-r2.json)
on VM105. The [initial test-message failure](startup-provider-validation-20261020.json)
is preserved; its correction changes only the new CLI test expectation.
Source review then identified an additional confound before any hardware run:
the default whole-document interceptor would also block web fonts. The scoped
option now pauses only the five declared native map-provider origins. Fonts
and application assets are not intercepted by this diagnostic; other fixtures
retain their original whole-document isolation. [All 82 focused checks](startup-provider-scope-validation-20261020.json)
pass on each VM Node version, including scope rejection and lifecycle cleanup;
formatting and all 79 capture lint files pass. The earlier broad-scope runner
was prepared but never executed.

The corrected candidate's [cable pair](infrastructure-cables-190c5ab6-result.json)
has now passed independent VM validation. Its five-run motion median p95 is
311.7 ms versus the recorded baseline's 332.8 ms (-6.34%); startup changes
-16.52% for app readiness and -9.46% for loading completion. The original
baseline reuse is explicitly declared and is not a new interleaved speedup
experiment. All seven raw/report/protocol files were hash-verified on VM105.

The current [map comparison](map-streaming-190c5ab6-result.json) also passes
independent VM verification of seven raw/report/protocol files. Motion median
p95 changes 392.3 to 312.8 ms (-20.27%); transition-readiness p95 changes -37.01%,
idle rendered-frame spacing +0.95%, app readiness -29.56% and loading completion
-19.43%. Each scenario meets the existing regression limit. The complete
cable/map orchestration receipt is separately preserved on VM105 with SHA-256
`459c329d1f650b54daffa266c98a2e4e9dbe4824b8b0859063f4dc0c0d5a2bfc`.
The comparison explicitly reuses the saved five-run baseline. It does not prove
a repeatable speedup or satisfy the distinct dense/tracking 20% objective.

The current [operating-view pair](operating-view-190c5ab6-result.json) now has
five samples per scenario, with all seven raw/report/protocol files verified
on VM105. Motion median p95 changes 299.6 to 254.5 ms (-15.05%), app readiness
-17.19% and loading completion -12.06%. It declares the saved baseline reuse.
Its raw idle frame-spacing flag (+282.67%) remains open pending a fresh,
candidate-bound render-demand diagnostic; frame spacing is not execution time.
The [current-candidate consumer checks](idle-current-candidate-validation-20261020-r2.json)
pass 34/34 on each VM Node version. They require new raw and diagnostic hashes,
producer `b843cac5`, its immutable diagnostic script hash, and the exact Chrome
155.0.8059.84 build. Historical 190/B3 observations and altered producer/browser
identities are rejected. The [initial assertion-message failure](idle-current-candidate-validation-20261020.json)
is retained. These tests do not substitute for the pending physical diagnostic.

The preceding complete workload matrix applies to `b3c49b19`. Its
[recorded-position regression suite](replay-runtime-tests-b3c49b19.json) passes
158/158 on each of VM105 Node 24.16.0 and 26.11.0, with five failing assertions
against the original runtime. The [physical Windows check](replay-hardware-b3c49b19.json)
verifies all eight fleet and eight tracked observations at the selected recorded
position, including paused forward/backward seeks. It records the pinned Cesium
visualization-bounds witness, native UHD 620 rendering, foreground confirmation
and normal cleanup. Failed helper attempts remain archived. This establishes
correctness only; the previous candidate's performance and soak evidence is not
transferred to this revision.

### Workspace settings and camera setup failures

The corrected runtime candidate is now `190c5ab6`; its exact-commit release
workflow [39332092277](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39332092277)
passes build, downloaded-archive checks and GitHub attestation verification.
It remains a candidate artifact, with hardware acceptance and activation pending.

All seven required [CI jobs at that exact commit](ci-190c5ab6.json) pass.
VM105 independently verifies the signed archive and all 2,128 packaged files;
its [private production-host smoke test](production-host-smoke-190c5ab6.json)
passes all sixteen checks. The [prepared release](prepared-release-190c5ab6.json)
is available only through a private preview. Public production is unchanged.

The [signed-package browser preflight](private-package-preflight-190c5ab6-review.json)
also passes on physical Windows Chrome: saving, exporting, importing, reloading,
and reopening preserve the workspace's asset bytes in an isolated profile.
This check does not replace the full visual-settings comparison, latency tests,
retention soak, or public deployment verification.

The [corrected `0dc5cdb1` idle diagnostic](weather-idle-diagnostic-b3c49b19-0dc5cdb1-review.json)
completes both historical observations: 79 control and 78 candidate rendered
frames in sixty seconds. Every observed gap above one second has no registered
continuous demand. The [current `236b7704` diagnostic](weather-wind-visibility-190c5ab6-236b7704-review.json)
additionally observes the actual GPU wind state on correctness control `76cc760b`
and runtime candidate `190c5ab6`. All 311 control and 299 candidate observations
have a ready GPU renderer, zero height fade, and zero visible cells. The existing
12,000 m fixture camera is below the 15,000 m streamline fade threshold on both
builds. These gaps therefore do not establish stalled visible wind animation.
They also do not establish animation correctness at an eligible camera height;
that requires a separate visible-wind pause/resume probe. Wind calls
`scene.requestRender` directly, so governor holds alone are insufficient. The
[focused checks](weather-wind-visibility-validation-20261020.json) pass 31/31
on each VM Node version and all 75 capture no-undef checks. Diagnostic reports
remain ineligible for performance acceptance. Visible wind coverage, the full
visual gate and final corrected-candidate soak are still required.

The [first corrected-candidate repeated visual diagnostic](visual-production-repeat-190c5ab6-failure-review.json)
fails on the second of four planned pages: the candidate's presentation invariant
changes during the paused capture. Nine PNGs were preserved; every three-image
group is internally byte-identical. The helper discarded the candidate's
before/after presentation snapshots when the assertion threw, so that report
cannot identify the changed field. A reporting-only correction preserves those
snapshots before checking the same invariant. [Independent pixel inspection](visual-production-repeat-190c5ab6-pixels.json)
also finds a logo difference between two states of the same baseline and other
HUD differences between builds. The failed attempt and its possible unrelated
local-test overlap remain recorded; none of these images grants visual acceptance.

The first idle-only weather diagnostic using producer `190c5ab6` failed during
final report construction: the shared lifecycle validator still expected both
idle and motion samples. The failed report is retained under
`weather-idle-diagnostic-b3c49b19-190c5ab6` and is not acceptance evidence.
Its bounded failure envelope omitted the completed sample, so it cannot explain
the weather frame gaps. The corrected validator explicitly labels the one-sample
diagnostic as ineligible while retaining both samples for comparisons and all
three source-phase timing checks. The [focused VM checks](weather-idle-lifecycle-validation-20261020.json)
pass 28/28 on both Node versions; capture no-undef checks also pass.

The [corrected interaction/heap comparison](qualification-metrics-b3c49b19-1ef5973e.json)
failed and remains archived. The `3141ffe3` control completed twenty local
controls, twenty replay seeks, two warmup heap cycles and six measured cycles,
then failed visual equality: sharpening changed from enabled to disabled,
label fading from 7 to 16, outside opacity from 1 to 5 and scope feathering
from 11 to 35. This is a real application defect: the canonical view codec
drops those settings and `ShareLinkManager.applyView` supplies fixed defaults.
The workspace implementation introduced that behavior at `3d6b30c8`; the
later detection-mode/density fix did not preserve the remaining visual fields.
The raw report's final settings field was not assigned after the failed
assertion and is not proof of the postcondition.

The candidate completed no interaction samples: a latitude assertion failed
during camera preparation. The harness positioned the camera directly while
the application's delayed startup flight could still own it. The proposed QA
correction claims the existing navigation authority and requires the exact
pose on two completed renders. It changes neither pose tolerances nor timed
interaction boundaries. Both browsers closed normally.

A bounded optional visual object now carries effects, HUD, label fading,
scope and allowlisted style parameters through saved views, URL round trips
and version-one workspace documents. Older documents without this field keep
their historical restoration behavior. The [VM regression checks](workspace-visual-and-qa-validation.json)
pass 125/125 on each of Node 24.16.0 and 26.11.0; five new regressions fail
against the immutable original runtime. Import/package boundaries and all 75
capture no-undef checks pass. Failed test-fixture and sparse-checkout preparation
attempts remain archived. Hardware validation is still pending.
No final soak or production activation should proceed with the
known persistence defect, and earlier application evidence must not be
relabelled as testing the correction.

Visual producer `89e2acad` adds stable scroll geometry, active-element and pointer
observations. A capture requires two consecutive completed render/layout
boundaries with unchanged inputs, followed by unchanged capture boundaries.
All rejected attempts remain in the report. The
[17 readiness/lifecycle tests](visual-readiness-tests-89e2acad.json) pass on each
VM Node version; the VM's unsupported native Sharp tests remain assigned to
Windows/hosted validation. Its [hardware attempt](visual-readiness-89e2acad-hardware-failure.json)
rejected the baseline HUD-visible state because the REC indicator or scanline
phase changed before capture; the candidate was not captured. Scroll geometry,
pointer and focus remained stable. Producer `8efcea04` reads scene structure
before waiting for the required phase, removing extra browser round trips from
that short interval. Its [17 tests](visual-read-order-tests.json) pass on each
VM Node version. The subsequent `d7bb1b97` producer captured all four states on
both builds. [Independent VM decoding](final-visual-b3c49b19-d7-failure.json)
found identical settled-scene pixels, but rejected the HUD-visible, hidden and
restored states. The differences include eight CCTV source-badge corner pixels
and the animated logo. The revised observer requires a fresh pointer after
foreground confirmation, exact settled logo transforms, consecutive unchanged
layout boundaries, and bounded CCTV filter/animation/badge evidence. Structural
observations are labeled as pre-readiness metadata. The
[QA validation](readiness-import-validation.json) passes 28/28 on each VM Node
version; the Windows PNG consumer separately passes 39/39. The subsequent
[`aa400dfe` hardware capture](final-visual-b3c49b19-aa400-failure.json) completes
all four states but remains failed: settled and HUD-visible images each have
7,751 differing pixels, HUD-hidden matches exactly, and HUD-restored has 772
differences. The differences are confined to the logo and eight camera-badge
corner pixels. Recorded gaze and style inputs match; the relevant logo source
is unchanged between applications. The [within-build diagnostic](visual-within-build-aa400-diagnostic.json) also finds the
baseline's logo shadow changing after HUD restoration (7,218 pixels, maximum
channel delta 6), while the candidate's logo stays identical. This localizes
some raster variability but does not explain or clear the cross-build maximum
delta of 103. No mask, pixel threshold or visual setting changed.

The [new dam comparison](infrastructure-dams-b3c49b19-result.json) has motion
p95 of 299.7 versus 304.6 ms (+1.63%), within the unchanged regression limit.
Its app-ready startup median is 3,884 versus 4,289 ms (+10.43%), which fails
the 10% startup gate. The loading-screen-hidden median rises 8.44%. The original
five startup observations per build are preserved. A separately predeclared,
balanced [startup confirmation](startup-balanced-b3c49b19-review.json) completed
all ten predeclared shards with verified foreground state and normal cleanup.
The app-ready median is 5,784 versus 4,584 ms (-20.75%); loading-screen-hidden
startup is 6,973 versus 5,961 ms (-14.51%). The original regression did not recur
in this confirmation. Its failed record remains intact; this confirmation is
startup evidence only and does not establish the motion improvement target.
The [cable comparison](infrastructure-cables-b3c49b19-result.json)
passes: motion p95 changes from 332.8 to 329.0 ms (-1.14%), app-ready startup
changes -14.87%, and loading-screen-hidden startup changes -3.61%. Settled idle
timing remains unavailable in both builds, rather than being reported as zero.

The [current map comparison](map-streaming-b3c49b19-result.json) also passes:
motion p95 is 392.3 versus 359.2 ms (-8.44%), map-switch readiness is
14,413.9 versus 14,608.3 ms (+1.35%), and app-ready startup is 5,075 versus
3,961 ms (-21.95%). All six original files are independently hash-verified
on VM105. The pinned map corpus and native profile are unchanged.

The [current operating-view pair](operating-view-b3c49b19-result.json) completes
all five observations per scenario on both builds. Motion p95 changes from
299.6 to 284.9 ms (-4.91%). The original consumer flags idle rendered-frame
interval p95 at 265.4 versus 1,015.0 ms (+282.44%). The baseline uses continuous
rendering and records 323–340 frames per minute; the candidate uses request-render
mode and records 101–103. Long-task counts are respectively 207–304 and 18–30.
Satellite positions advance with matching sampled epochs at both boundaries.
The separate [current-build idle-cadence diagnostic](idle-cadence-b3c49b19-review.json)
now passes independent VM review of visibility, animation, ownership and original
pair hashes. It classifies this idle flag as an intentional demand-cadence
change. The original report remains unchanged; this disposition assesses
neither visual equivalence nor motion performance.
Operating-view startup also fails: app-ready medians are 3,276 versus 3,937 ms
(+20.18%), and loading-screen-hidden medians are 3,954 versus 4,642 ms (+17.40%).
The dams-only startup confirmation does not clear this workload. All eight
original operating-view files are hash-verified on VM105.

The [page-observed startup confirmation](operating-view-startup-page-observed-b3c49b19-review.json)
subsequently completed all ten predeclared, interleaved slots at producer
`14201a7f`. App-ready medians are 4,352.1 versus 4,565.3 ms (+4.90%);
loading-screen-hidden medians are 5,506.1 versus 5,741.3 ms (+4.27%). Both
remain within the unchanged 10% limit. Foreground preparation precedes the
navigation timer; page observations are upper bounds on readiness, with host
timing recorded separately. All 43 originals were independently hash-verified
on VM105. This confirmation assesses startup only; it neither rewrites the
earlier failed measurements nor certifies a later corrected application.

The [dense pair](dense-investigation-b3c49b19-result.json) completes five
observations per scenario on both builds: idle p95 changes +5.56%, motion
-1.51%, and tracked motion +8.50%. These measured scenarios stay within the
10% regression limit; the 20% motion/tracking improvement objective is not
achieved. Startup fails separately: app-ready rises from 3,853 to 4,398 ms
(+14.14%) and loading-screen-hidden from 4,363 to 4,866 ms (+11.53%).

The [datacenter pair](infrastructure-datacenters-b3c49b19-result.json) records
motion p95 of 288.1 versus 276.8 ms (-3.92%). All five idle samples per build
have zero rendered frames and unavailable frame-interval p95. Startup fails:
app-ready is 3,413 versus 4,697 ms (+37.62%), and loading-screen-hidden is
4,429 versus 5,609 ms (+26.64%). The [host-conditions note](measurement-conditions-20261019.json)
records a 47.715-second local focused test suite during this capture block;
exact phase overlap is unavailable. The original reports remain intact and
must not be described as an otherwise-idle-host comparison or proof of a
repeatable speedup. Remaining focused checks and image decoding run on VM105.

The [combined infrastructure pair](infrastructure-b3c49b19-result.json) completes
all five samples per scenario on both builds. Motion p95 is 320.9 versus
328.7 ms (+2.43%), within the 10% regression limit. App-ready startup is 5,231
versus 3,952 ms (-24.45%); loading-screen-hidden startup improves 17.67%.
Settled idle frame intervals remain unavailable. All eight raw and invocation
files are independently hash-verified on VM105. This result does not clear the
separate operating, dense or datacenter startup failures.

Code inspection shows these startup observations precede workload activation:
fresh contexts start with no enabled layers, but have workload-specific provider
hooks. The existing app-ready metric includes navigation, foreground activation,
the viewer-existence wait and the diagnostics-disable call. An opt-in
`--startup-attribution` diagnostic now records those boundaries separately,
along with Navigation Timing, locale and enabled layers. Its timestamps are
observations, not application publication marks. The separate diagnostic schema
is rejected by the acceptance consumer. [Focused VM validation](startup-attribution-qa-validation.json)
passes 39/39 on each Node version, formatting and the 73-file no-undef check.
The existing metrics and 10% gates are unchanged; any predeclared confirmation
remains separate from diagnostic attribution.

The default boot can also await live token, basemap and terrain setup, depending
on provider availability. The diagnostic now reads retained Resource Timing
entries once after the existing settled boundary. It emits only bounded counts,
timing/size coverage, fixed provider classes and projected map/terrain identity;
URLs, paths, query strings and credentials are never emitted. Buffer-drop
coverage remains unavailable, and zero byte fields may reflect cache or
Timing-Allow-Origin restrictions. This is attribution evidence only, not a new
startup acceptance metric. The [eight focused checks](startup-network-attribution-qa-validation.json)
pass on each VM Node version; syntax, formatting and all 73 capture no-undef
files also pass.

The [eight predeclared hardware observations](startup-attribution-ac50400c-review.json)
now complete at producer `ac50400c`, with independent VM hash, source, slot,
role, fixture and normal-cleanup checks. Both fixtures use English, no enabled
layers and the same automatically selected OSM stack. Foreground activation
takes 1,635–2,349 ms and is included in the legacy app-ready stopwatch. The
first control spends 2,164 ms in that step, followed by a 17 ms viewer wait
and 2 ms diagnostics-disable call. The retained resource entries do not show
a long external-provider response; incomplete buffer/TAO coverage still limits
that conclusion. These observations expose host setup inside the old startup
measurement. They do not establish the exact viewer publication or first
visible frame time, do not permit subtracting overhead from old samples, and
do not clear any failed startup gate. A distinct, predeclared confirmation
method now activates before navigation and records page-side observation times
separately from host setup. The opt-in `--startup-page-observed-v1` method is
restricted to startup-only shards and cannot be combined with attribution mode.
Viewer and loader predicates run concurrently; each records visible/focused
state and a page-clock upper bound on availability. These are not exact
publication or first-render marks. Host-clock boundaries remain separately
bound to their own durations. Mixed methods are rejected, and legacy reports
retain their existing meaning. The [focused validation](startup-page-observed-qa-validation.json)
passes 33/33 on both VM Node versions, syntax/format checks and the 75-file
capture no-undef check. New predeclared hardware confirmations remain required
for operating, dense and datacenter startup; no old result is recomputed.

The [presentation-fence diagnostic](visual-presentation-cross-build-diagnostic.json)
compares unpaused, debugger-paused and naturally advanced captures on each build.
DOM/SVG geometry, transforms and relevant computed paint inputs match. The paused
and naturally advanced cross-build logo regions differ at four pixels by one
channel unit, rather than reproducing the earlier maximum delta of 103. Other
HUD regions still vary, and the candidate's first capture also has broad
low-amplitude color variation. This diagnostic does not pass the full four-state
visual gate or explain every old difference. Its regions only localize changes;
they are not acceptance masks. All original PNGs and failed results are retained.

The upstream range `93ea088f..2f171c7d` was reviewed separately during the
frozen comparison. It does not change the logo source, its relevant styles or
the default scene boot, and supplies no demonstrated fix for the current logo
or startup findings. CCTV still-aspect and marker-color changes need fresh
visual evidence if integrated later. Terrain endpoint changes could affect
startup only if that endpoint is actually called; the default boot inspection
did not establish such a call. No upstream runtime change was added to the
frozen `b3c49b19` qualification. The fork's `main` remains at `1df2a272`.

The [QA CI receipt](qa-ci-1ef5973e.json) records all seven required jobs passing
for `1ef5973e`, including Windows recovery and rendered mixed-use smoke. Its
release packaging also passes. Twelve optional diagnostics were not selected by
that workflow and are intentionally skipped. The exact application remains
`b3c49b19`; these CI results do not substitute for its pending hardware evidence.
The [later `4911f52f` CI receipt](qa-ci-4911f52f.json) likewise records seven
required jobs and release packaging passing, with twelve intentionally unselected
diagnostics. All four archived receipt files are hash-verified on VM105. The
subsequent Resource Timing producer `ac50400c` also has a [passing CI and release
receipt](qa-ci-ac50400c.json). Its [first macOS attempt](qa-ci-ac50400c-attempt1-infra-failure.json)
never acquired a hosted runner and ran no steps; only that job was retried, and
the retry passed. The capacity failure remains archived. The newer
[page-observed producer `14201a7f`](qa-ci-14201a7f.json) now also passes all seven
required jobs and release packaging. Its exact raw CI responses and review are
hash-verified on VM105; its physical startup confirmations remain pending.

The [startup and idle contract checks](operating-startup-idle-qa-validation.json)
pass 142/142 on both Node 24.16.0 and 26.11.0 on VM105. Startup-only captures
now accept the actual Austin fixture identity and its operating-view row; the
dams contract is unchanged. Idle disposition requires the current candidate's
own raw pair, diagnostic hashes and full Chrome version. Historical evidence
cannot clear the current flag. The fresh idle diagnostic is now reviewed above;
the distinct startup confirmations remain outstanding.

The [first current balanced weather attempt](weather-b3c49b19-foreground-failure.json)
failed native foreground initialization before recording any sample. Its six
original files are hash-verified on VM105. A fresh, separately declared plan
uses the owned blank-page handoff before the same native foreground checks;
measurement durations, source deadlines, paired order and limits are unchanged.

The [fresh ten-shard weather result](weather-balanced-b3c49b19-review.json) now
completes with all 47 original files hash-verified on VM105. Independent consumer
`16cddc98` verifies comparability. Motion p95 changes from 260.9 to 263.6 ms
(+1.03%), within the unchanged 10% limit. Idle rendered-frame intervals change
from 984 to 1,703.2 ms (+73.09%) and remain flagged pending a weather-specific
demand/cadence review. The operating-view idle disposition does not cover this
different workload. Successful capture is not a complete weather acceptance.

The exact `b3c49b19`
[tracking](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39280015189)
and [signed candidate packaging](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39280010153)
workflows pass. The independently downloaded archive has SHA-256
`1f4b358ab24655305469573c060ad9a9ca9cef4b909f04a9d173e189ef549924`.
VM105 reverified its GitHub-hosted attestation and
[all 2,126 packaged files](staged-release-b3c49b19.json), and
[all 16 private HTTP checks](production-host-smoke-b3c49b19.json) pass. The
[prepared package](prepared-release-b3c49b19.json) serves only a private
loopback preview. The [exact-commit CI receipt](exact-ci-b3c49b19.json) records all
seven standard jobs, separately selected tracking, and signed packaging passing.
The raw workflow responses are hash-verified on VM105. Optional diagnostics
skipped by workflow selection do not replace hardware qualification.
The [independent provenance consumer](provenance-consumer-b3-validation.json)
also verifies the downloaded ZIP members, archive/checksum, embedded manifest,
attestation claims, staging receipts and all sixteen private HTTP checks against
that exact candidate. It leaves overall qualification unaccepted while the
remaining gates are incomplete.

Further required evidence is
the remaining matrix and visual comparison, twenty local-control changes,
twenty loaded replay seeks, sampled peak heap, a browser workspace preflight,
and a new final Ampfing soak. Replay/heap comparison control `3141ffe3` contains
the original baseline plus the same weather and recorded-pose correctness fixes,
without the candidate's performance optimizations. It is explicitly distinct
from the original baseline. The [first metrics attempt](qualification-metrics-b3c49b19.json)
failed on both builds because the harness expected four stored rows from four
snapshot timestamps. The recorder correctly retains a fifth row containing an
altitude correction. The corrected harness and consumer preserve this meaning,
validate the recording identity and 3,000 ms coverage, and reject a four-row
report. [All 19 focused tests](replay-fixture-contract-validation.json) pass on
both VM Node versions, including the real recorder-to-replay contract. The
[corrected hardware attempt](qualification-metrics-b3c49b19-dc3a85e5.json)
completed twenty local-control changes and twenty loaded replay seeks on each
build, then failed before heap sampling at the visible import-control wait.
The Workspace disclosure was never opened by this harness. The shared import
fixture now opens its disclosures through application controls before requiring
the same visible file chooser. Missing APIs and hidden controls still fail;
the failed attempts are preserved.

The metrics diagnosis also found that the shared mixed-use fixture matched
`/datacenters.geojsonl` but missed the production asset
`/assets/datacenters-CtzejECr.geojsonl`. The unmodified bundled bytes contain
4,351 source rows and materialize 4,362 features, rather than the fixture's
declared eight. The correction matches only the same-origin bundled source
asset and requires a delivery/materialization preflight before timing. Old
full-catalog measurements and soaks are retained with their original meaning;
the Dense and infrastructure matrix still use their full populations.
The observer correction counts trusted input delivery delay, avoids catalog
normalization in every poll, and requires matching selected state and visible
output in the same natural preRender/postRender pair. Both fixture receipt APIs
return bounded cloned request evidence. Disabled controls record their actual
false state, separately from whether that state matches the expectation.
The [reviewed QA validation](interaction-fixture-reviewed-qa-validation.json)
passes 71/71 tests on Node 24.16.0 and 26.11.0, format/syntax checks, and the
capture no-undef check across 71 files. The earlier
[69-test receipt](interaction-fixture-qa-validation.json) is retained as historical
evidence; code review identified the success-receipt and disabled-state gaps
after that run. No runtime, renderer, visual-setting or threshold changes are
included. The 100 ms local-control and 250 ms loaded-seek limits remain in force.
A new complete
metrics run and a new exact-candidate soak are required.
Production still serves `e7a878e`.

The subsequent browser-realm review found two witness identifiers referenced
outside the function serialized into Chrome. Node tests that called the
function directly did not expose those missing closures. The identifiers now
live inside the serialized function. An isolated-realm regression exercises
both local-control and replay preRender/postRender completion without module
bindings. The [serialization validation](interaction-serialization-qa-validation.json)
passes all 72 focused tests on each VM Node version, format/syntax checks and
the same 71-file no-undef check. Application bytes and acceptance limits remain
unchanged; this validates the observer, not hardware latency.

QA revision `f97b9b98` also records a separate
[hosted Windows recovery failure](qa-f97-windows-recovery-attempt1.json).
The prior installation saved its settings and workspace correctly, but Chrome
152 acknowledged browser closure and then left its browser/crashpad processes
running beyond the existing ten-second shutdown deadline. This occurred before
installing the current candidate. Forced cleanup succeeded; the recovery job
still failed. The underlying browser/runner cause is not established. The
exact `b3c49b19` application's passing CI receipt remains separate, and the next
QA revision must repeat Windows recovery without relaxing its deadline.

QA revision `347bf41e` passes Windows recovery, both Node suites, Windows
onboarding, Linux/macOS recovery and candidate packaging. Its
[rendered mixed-use smoke failure](qa-347-rendered-smoke-attempt1.json) is
preserved: the exact eight-feature fixture was delivered and materialized,
but the startup camera did not show its location. Disabled cleanup passed.
The corrected unmeasured preflight moves to the declared fixture location and
requires a completed visible frame before disabling the layer. Witness
collection stops in `finally`, leaving only the existing lightweight frame
counter during measurement. Camera evidence distinguishes requested and
observed positions; visibility and cleanup failures have separate messages.
The [combined QA validation](soak-camera-preflight-qa-validation.json) passes
217/217 on each VM Node version, formatting/syntax, and the 71-file no-undef
gate. Fresh rendered CI and hardware results are required before this fix can
clear the failure.

The previous candidate is `d8ef9002`. Its cancelled-camera-image cleanup fixes
a native DOM ownership leak reproduced on Chrome 155; the
[intervention and engine census](image-cleanup-census-review.json) and
[allocation-cohort review](allocation-cohort-review-d8ef.json) record the
bounded diagnostics. Old data sources, visualizers and batches are collectible;
the sampled remaining allocations predominantly include compiled code, terrain
caches and current scene state. This does not replace the full retention gate
or clear the earlier failed soak.

All seven selected [PR CI jobs](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39237487199),
[exact-commit tracking](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39237600684)
and [signed candidate packaging](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39237505166)
pass. The independently downloaded archive has SHA-256
`30aca862210f2f857ebc5265d618d4cee73c73ea091263f4faf26644bf2e0669`.
Its 2,126 packaged files and GitHub-hosted attestation were reverified on VM105;
all 16 private production-host checks pass. It is prepared behind a private
loopback preview. Production still serves `e7a878e`.

The [private package workspace preflight](private-package-preflight-d8ef-review.json)
passed in Chrome 155 against those exact signed bytes. UI save, export, import,
reload and reopening preserved the workspace asset hashes in a throwaway profile.
Normal browser cleanup passed. Three earlier helper failures remain archived;
they concerned selecting the entry script and opening the collapsed scene panel.
This private loopback check does not establish public HTTPS activation or clear
the independent performance and retention gates.

The [balanced full weather review](weather-balanced-d8ef-review.json) validates
all ten captures against this exact candidate. Median run-level motion p95 is
272.6 ms for the weather correctness control and 296.1 ms for the candidate
(+8.62%), within the unchanged 10% regression limit; this is not a speedup.
Consumer `16cddc98` checks recorded native profiles, Chrome's exact full runtime
version alongside its reduced user agent, and both the byte hashes and internal
canonical hashes of the predeclared build receipts. Node 24 and 26 checks and
independent revalidation pass on VM105. The consumer's
[CI and packaging checks](consumer-ci-16cddc98.json) also pass. All 16 evidence files were hash-verified
there. The original producer envelope's metadata failure and all raw captures
are preserved; no acceptance limit or measurement was rewritten.

The [current map comparison](map-streaming-d8ef-result.json) completes five
matched samples per scenario on Chrome 155 and the physical Windows UHD 620.
Motion p95 changes from 392.3 to 368.7 ms (-6.02%); map-switch readiness changes
from 14,413.9 to 14,219.7 ms (-1.35%). No measured map regression exceeds 10%.
Capture producer `aa1e653f` verifies native fixture delivery and complete frame
coverage for the current `d8ef9002` application. The predeclared baseline reuse
keeps its original bytes and hash. The other workload pairs, visual qualification
and the retention gate remain separate requirements; this result does not
authorize deployment or stable publication.

The [current dam result](infrastructure-dams-d8ef-result.json) also completes
its five-run comparison: motion p95 is 299.7 versus 284.4 ms (-5.11%), with no
measured regression above 10%. Its idle timing remains unavailable for both
settled fixtures, rather than being represented as zero. This current result
does not erase the earlier Chrome 152 failure or establish its historical cause.
The [current cable comparison](infrastructure-cables-d8ef-result.json) is also
complete: motion p95 changes from 332.8 to 321.1 ms (-3.52%), with no measured
regression above 10%. Its settled idle timing is unavailable in both builds.
Four other workload pairs still need current-candidate results.

The additional qualification-metrics producer records twenty real datacenter
control changes and twenty loaded replay seeks per build. A replay witness
requires the selected source timestamp and coordinates in the enabled aircraft
layer, its billboard on the canvas, and a later completed rendered frame. It
reports state latency separately from the conservative requested-frame latency;
the limits remain 100 ms and 250 ms. A separate one-second heap series covers
six measured mixed-use cycles after two warmups without forced GC. It is a
sampled peak, not a continuous peak or a replacement for retained-memory evidence.
The consumer verifies exact build, Chrome, hardware renderer, native dimensions,
Manual/DENSE 75% settings, foreground evidence and normal browser disposal.
Thirty-nine focused consumer and idle-cadence tests pass locally. The broader
[VM consumer checks](qualification-metrics-tests-6d4038e6.json) pass 174/174 on
each of Node 24 and Node 26 at `6d4038e6`. The subsequent displayed-position
check at `cb3a7c18` requires the public billboard's geographic coordinates to
match the selected moving observation, and verifies the local-control and replay
camera routes before timed input. Equivalent angles modulo a full rotation are
accepted; genuinely different poses are rejected. Its [VM checks](qualification-metrics-tests-cb3a7c18.json)
also pass 174/174 on each Node version. The actual hardware captures remain
pending; added tooling is not a performance pass.

The [moving replay diagnostic](replay-position-d8ef-review.json) now reproduces
a pre-existing correctness failure in both `e7a878e` and `d8ef9002`. All eight
observations per build have the correct selected source and analyst position,
but their visible billboards remain on the live-clock trajectory during paused
Home/End seeks. Longitude error reaches about 0.06 degrees. The diagnostic ran
on the physical UHD 620 with foreground and normal cleanup confirmed; original
reports, source and synthetic recordings are hash-verified on VM105. The flight
renderer still applies its live delay and forward-only history to recorded
observations. The correction in `b3c49b19` now passes the focused automatic and
hardware checks above; this historical failure is not converted into a
successful replay-latency measurement.

Single weather startup shards can be read only as individual observations after
their balanced parent envelope is validated. Their comparison-ineligible flags
remain unchanged. Current-candidate idle-cadence review likewise requires its
own original raw pair and a fresh functional diagnostic, including the exact
Chrome version. Historical candidate diagnostics cannot clear a current result,
and an idle-cadence finding cannot waive motion, image or memory failures.

The [current visual review](final-visual-d8ef-failed-review.json) is **failed**.
Initial still and HUD-hidden captures match byte for byte. HUD-visible and
HUD-restored differ at eight pixels on the rounded camera-status-badge corners,
with a maximum channel difference of 7/255. The existing policy requires the
visible controls to match across builds, so this is not accepted as raster
variance. Its cause is unresolved. All original PNGs, observations and process
receipts are hash-verified on VM105; no mask, image edit or threshold change
was applied. An earlier runner setup failure, before any browser launched,
used the dependency loader without `sharp` and is preserved separately.

Independent [PNG decoder controls](portable-png-decoder-controls.json) now pass
on VM105 under Node 24 and 26. The VM's CPU configuration cannot run the native
Sharp binary, so an isolated, hash-pinned pure-JavaScript decoder reads the
original PNGs and applies the unchanged pixel policy. It passes the historical
positive control and reproduces the current eight-pixel failure exactly. This
validates the decoder, not the candidate; production and image bytes are unchanged.

The [predeclared same-build controls](badge-same-build-controls-d8ef-review.json)
are complete: two fresh browser contexts for each unchanged revision, in
baseline/baseline/candidate/candidate order, retaining all four visual states.
The unchanged final validator correctly rejects equal-revision pairs. Independent
VM decoding reproduces the eight-pixel, 7/255 variation within the unchanged
baseline, including its hidden and restored states. The candidate's initial
still differs from its subsequent visible states at 78 pixels with a maximum
RGB change of 103/255, around the panel scrollbar; its repeated same-state
captures match. These controls establish additional fixture variability, not
visual acceptance or a runtime regression. All 27 original files (25,355,613
bytes) are hash-verified on VM105. No masks, image edits or threshold changes
were applied, and no GPU job ran alongside the completed Ampfing soak.

The final metrics audit also identifies missing interaction and peak-memory
evidence. `pairedReport.mjs` currently compares scenario frame timings but does
not gate captured startup times, local-control latency, loaded replay latency,
or paired peak heap. The existing startup medians are 5,075 versus 5,252 ms for
maps (+3.49%) and 3,884 versus 4,111 ms for dams (+5.84%). A single heap value at
the end of a capture cannot establish a peak, and a replay-seek count cannot
establish p95 latency. These requirements remain pending, with a separate
passing metrics review required before activation. No gate is waived and no
historical capture is rewritten.

The first exact-package Ampfing attempt was [interrupted after 37 cycles](staged-ampfing-soak-d8ef-foreground-interruption.json)
when Windows could not confirm foreground ownership. It cannot satisfy the
60-minute gate. A formatting command invoked a `.cjs` file without Node and
opened it in VS Code, a likely cause consistent with the observed editor window;
the original wrapper did not retain Windows' failing foreground response, so
exact attribution is unavailable. The retry explicitly preserves that response
on failure. The [completed retry](staged-ampfing-soak-d8ef-review.json) ran
158 measured cycles in 3,608,651 ms against the exact signed `d8ef9002`
application and the same clean producer. All operations, foreground checks and
normal cleanup passed. All 13 post-GC checkpoints retained 668 listeners and
stable application ownership counts; DOM nodes ended at 6,345 versus 6,339 at
the warmed baseline. Retained heap still failed the unchanged gate: 5.3421%
growth, with no missing evidence. Production remains unchanged.

The periodic checkpoint scheduler measures each interval from the previous
completed checkpoint and waits for equivalent-state cycles. Its cadence drift
placed the final-window baseline at minute 26.31, so this nominal hour
compared 33.84 minutes. The [future scheduling correction](soak-checkpoint-schedule-review.json)
declares a complete 30-minute interval after the first equivalent checkpoint
at or beyond minute 30. It never inspects heap values to choose duration,
shortens the requested run, changes the 5% evaluator, or reinterprets this failure.
It fails if the required checkpoint/interval cannot fit a bounded 24-minute
extension. All 104 focused soak and evidence-consumer checks pass on each of
Node 24 and 26 on VM105, with no skips. All seven selected integration jobs and
packaging also pass at the frozen producer `c38fa694`, as recorded in its
[exact-commit CI review](harness-ci-c38fa694.json). Application and server code
are unchanged from `d8ef9002`. The [anchored hardware run](staged-ampfing-soak-anchored-d8ef-review.json)
passes independent VM105 verification: 154 measured cycles over 3,703,613 ms,
with all operations, foreground, native dimensions and normal cleanup passing.
All 13 retained checkpoints have 668 listeners and stable application ownership.
Heap growth over the predeclared final interval is 4.2238%, below the unchanged
5% gate. The earlier 5.3421% failure remains historical evidence. This qualifies
retention for `d8ef9002`, not a later runtime revision. The remaining matrix,
visual and replay correctness requirements still block final acceptance.

An optional heap snapshot was attempted only after the measured failure and
exceeded its predeclared 768 MiB raw-size bound. It provides no valid heap
snapshot or acceptance evidence. The failure receipt and complete original
soak remain archived; the incomplete transfer was hash-recorded and removed
to recover VM105 space. The cause of the remaining heap growth is unresolved.
The reports below retain their original application revisions; earlier
`55639cc7` passes are not relabeled as `d8ef9002` evidence. The inactive unpacked
`55639cc7` package was removed only after its manifest and retained signed
archive were verified; its source, archive and evidence remain available.

The earlier candidate `55639cc7` was not approved for deployment. Its complete weather
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
274.2 versus 308.0 ms (+12.3%). That historical timing pair remains unaccepted. Its idle
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

The next weather qualification uses a new, predeclared balanced protocol to
reduce confounding from long consecutive baseline/candidate blocks. It has five
temporal pairs in the fixed order control/candidate, candidate/control,
control/candidate, candidate/control, control/candidate. Each fresh process
records both idle and motion with the original 30-second warmup and 60-second
measurement. Individual shards remain ineligible on their own. The manifest
consumer accepts only a complete hash-bound ten-shard envelope with the exact
plan, application/build/harness identities, browser, native visual conditions,
source deadlines, foreground checks and original timestamps. Archived Windows
evidence remains consumable from a different storage directory or Linux host.
The 10% regression threshold is unchanged, unavailable idle measurements remain
unavailable, and prior failures and motion-only diagnostics are not promoted.
This protocol is implemented and covered by 108 focused checks; no new balanced
qualification result is claimed yet.

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
