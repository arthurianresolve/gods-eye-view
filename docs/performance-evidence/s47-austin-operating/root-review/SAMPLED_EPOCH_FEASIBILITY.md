# Satellite sampled-epoch feasibility

Root independently exercised the native satellite rendering and public controls
against all 828 identities in the pinned Austin TLE catalogs. The
[source](satellite-sampled-epoch-feasibility.mjs) uses the production phased clock
and simulated 16, 33 and 120 ms frame delivery. Point setters clone positions as
Cesium does; no browser, WebGL context, GPU or production setting is changed.

At each held boundary, the audit derives a candidate epoch from the public cached
ISS position by searching the preceding 1,000 integer milliseconds. It then checks
every observed position against a separate catalog propagated at that epoch. The
private native timestamp is used only afterward to check the feasibility result,
never as an input to derivation.

All six derived epochs equal native ground truth. Each fleet has 828 matching
positions; the greatest Cartesian residual is about 3.15 micrometers, below the
experimental 1 mm tolerance. Raw position hashes are retained and differ across
frame cadences. Missing and duplicate identities, a fleet older than its cadence,
a one-meter displacement, a mixed epoch, and a distinct wrong orbit are rejected.
The [raw report](satellite-sampled-epoch-feasibility.json) is 5,985 bytes with SHA-256
`ed7c70f1b14cbb4b74f3d4649064cace21a8ae2ba4069d3a0f8a5a709ca1e030`.

An initial wrong-orbit negative substituted ISS for POISK. Those two source
records share the same physical trajectory, so no position mismatch resulted.
The report records this correction and uses CSS versus ISS for the distinct-orbit
negative. Source hashes and identity validation remain independently necessary.

This is a feasibility result, not a benchmark change or acceptance. The narrow
Chrome numerical control below now covers browser versus Node calculations.
Immutable baseline compatibility, complete application cached-position capture,
bounded serialization, and paired visual checks still need validation.
The satellite cadence blocker must remain until that integration passes. No
existing position checksum or source-identity requirement should be discarded.

# Subsequent hosted readiness failure

Run [38309379042](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38309379042)
at `eeb6dfdd7fad7eaf8b556ad542e250536c88f0af` passes the baseline smoke and initial
Austin scene setup. It then times out after the unchanged 60-second deadline in
`configure-austin-operating-sample-document` for the first fresh idle sample.
Both candidate documents acknowledge all 12 primary assets and 12 ALPR tiles;
cleanup is confirmed. There are no completed measurements. The report does not
identify which native layer failed readiness, so no further cause is claimed.

The [original failed report](hosted-smoke-38309379042-failed.json) is retained
byte-for-byte: 129,611 bytes, SHA-256
`46d168e2ee74defe091d586554aa0e8c1dae7377afebc5bbf052863c3fec4db7`.
Its truncated diagnostic envelope is not full performance evidence. A bounded
per-layer observation on readiness failure is the next diagnostic step; increasing
the deadline or relaxing readiness would not establish the cause.

# Windows Chrome numerical control

The [visible browser control](satellite-browser-precision.mjs) bundles the actual
production renderer, controls, orbit propagation and Cesium point collection
setters. It runs the same six simulated frame-cadence cases in Windows Chrome 154. Node 24.16 independently searches for the sampled epoch and recomputes all
positions from the pinned TLEs. The production clock function is serialized into
the browser as the capture harness does; its containing module also has Node-only
imports and cannot be bundled directly for a browser.

All six cases pass, with 828 identities per case and a greatest Cartesian residual
of 3.142 micrometers. The [summary](satellite-browser-precision.json) records source
and bundle hashes, browser identity, exact derived times, and raw-record hashes.
The [original browser payload](satellite-browser-precision-raw.json) is 521,679
bytes, SHA-256
`060fe78a38785b5cab2ab833a481cccda2a020d7e6ea5d209192faba25ac147f`.
The summary is 4,556 bytes, SHA-256
`a20021997dee45c01e80094ee37d014773412dfe3ef39070651260b27d0d40b8`.

This control creates no WebGL context. It validates the proposed numerical
tolerance in this browser, not actual frame delivery, full-application capture,
baseline compatibility, visual equivalence or GPU performance. The temporary
loopback server and browser tab were closed after completion.

Run the reproduction from a checkout with dependencies, naming an immutable
source checkout and a fresh output directory. Open the printed loopback URL in
Chrome and click **Run six browser controls**:

```sh
node docs/performance-evidence/s47-austin-operating/root-review/satellite-browser-precision.mjs <checkout> <new-output-directory>
```

# CCTV readiness and cleanup consumer correction

Run [38311295634](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38311295634)
at `61c72ea2411163c3d5906467b2bcfd32e275a987` again fails the unchanged 60-second
source-readiness deadline, this time in the initial Austin document. The new
snapshot identifies CCTV: all 250 camera records are present, but native geometry
loading is still true. Satellites, ALPR, installations, radio and wind are ready.
The next snapshot additionally preserves existing native geometry loaded/total
counts and bounded CCTV resource counts; readiness and its deadline are unchanged.

The [original CLI failure](hosted-smoke-38311295634-cli-failed.json) is 36,047
bytes, SHA-256
`4e0bf33969efc04fe25af6de854cfed518bc59b5b2f74d61b01a39645257ebec`.
It also exposes a separate cleanup-consumer defect: the Austin evidence adapter
expects `pendingAfterDrain`, which the actual interception producer does not
emit. That producer reports command, preparation and abort-subscription counts
separately. Earlier unit fixtures had invented the missing aggregate field.

The corrected consumer checks all actual drain counters, listener removal and
error/late-request counts at stop and release. A regression uses the real
interception controller through request fulfillment, stop and page closure.
Missing or nonzero drain/error counters remain failures. The
[independent raw replay](cleanup-consumer-replay.json) changes both document
cleanup classifications from incomplete to confirmed without altering the raw
artifact. The capture's readiness timeout remains failed; this replay is not
permission to accept an incomplete capture.

Standard CI [38309375637](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38309375637)
at `eeb6dfdd` has six successful jobs. Its unfinished browser gate was cancelled by
the workflow concurrency policy when the newer merged-commit standard run was
started. It is not a fully passing CI run. Exact merged-commit run
[38311292251](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38311292251)
at `61c72ea2411163c3d5906467b2bcfd32e275a987` now passes all seven standard
jobs: Node 24/26, Windows onboarding, Linux/macOS/Windows recovery and the browser
gate. This validates the merged checkpoint, not the subsequent cleanup-consumer
correction or incomplete performance capture.

# Receipt-only worker contract correction

Run [38312888961](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38312888961)
at commit 35a8348b7441952cd3a9c60d2385f828636d7f38 passes the baseline smoke but
fails candidate startup worker verification. The real embedded-worker contract
producer exposes allowedModuleIds but omitted allowedModuleCount; the new
receipt-only consumer requires that count. Its original unit fixture supplied
the missing field manually. A regression connecting the actual producer and
consumer reproduces the hosted error before the fix. The producer now supplies
the count directly from the same validated module set. All 29 worker audit and
contract tests pass after the correction, including locked Cesium bundle checks.

The [original failed capture](hosted-smoke-38312888961-cli-failed.json) is preserved unchanged: 17675 bytes,
SHA-256 5cb3cdb3b5490c3e7005d923273c1128c25e7b84f14358b8a8ce6fb0abe9c2c4. The startup document now confirms real interception cleanup
with the corrected drain consumer. This run has no completed measurements and
does not diagnose the separate CCTV readiness timeout. No application runtime,
worker interception or source readiness deadline changes in this correction.

# Integrated sampled-epoch evidence checkpoint

Commit be43a3219eafa561f751f96a3495d24408e605bb adds the bounded sampled-epoch
producer and paired-report recomputation. The existing measurement boundary
observations capture all 828 public satellite positions once; host verification
derives the unique ISS epoch within the preceding second and checks every record
against the exact pinned TLE bytes. Identity and position digests are bound to
the same existing layer observations. The ISS witness uses that observation too.
A coherent alternate-epoch substitution is rejected when its raw rows disagree
with the captured digest. Ten full samples stay within the existing 8 MiB report
artifact limit. Runtime update cadence and performance eligibility are unchanged.

Root merged this implementation with the receipt fixes at
665eec710cbf496ba9fe0d2543be17e72029b90f and independently passed all 68 focused
checks plus package boundaries. An [independent replay](sampled-epoch-root-replay.json)
verified all six preserved Windows Chrome numerical datasets through the new
verifier. The maximum residual remains 3.142 micrometers across 828 records at
each boundary. This is not a fresh rendered capture or performance acceptance.
The current hosted receipt-only check for the preceding worker-count correction
is [38313496758](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38313496758)
at f2ef271d4aae0639fd08a8ac26e971d7993210d1; it does not include sampled-epoch code.

# Paired cleanup revalidation and remaining failures

Commit 12d0adf3f269782cda0e58bcd1bab93e50799775 makes paired-report ingestion
recompute Austin cleanup from the complete release records, using the corrected
producer consumer. Stored confirmed flags alone are insufficient. Tests reject
missing and nonzero drain/error counters, mismatched document or session identity,
uncompleted disposal and contradictory summaries. Root merged this checkpoint at
f26a4e93f54604805fdf8bdf71291025d845bcc9 and independently passed all 74 focused
capture, paired-report, fixture and cleanup checks.

Receipt-only smoke [38313496758](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38313496758)
at f2ef271d4aae0639fd08a8ac26e971d7993210d1 now passes startup worker identity
verification. The candidate still fails the original 60-second Austin initial
readiness gate. Its subsequent bounded state observation also times out, so this
run does not identify loading progress or establish the cause. Both document
interception cleanups are confirmed. There are no completed measurements.

Standard [38312885340](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38312885340)
at 35a8348b7441952cd3a9c60d2385f828636d7f38 finishes with six successful jobs
and failed Windows recovery. In the final upgraded-application cycle, settings,
workspace bundle and rendered imported asset checks match, but graceful Chrome
process shutdown exceeds five seconds. The close request is acknowledged after
35.4 ms and the browser disconnects after 52.1 ms; forced process termination is
subsequently required. Three earlier recovery cycles close normally. This is a
failed gate, and the underlying process-shutdown cause remains unresolved.
The recovery JSON below is extracted from the job's QA_EVIDENCE markers; it is
not a separately downloaded artifact.

Preserved raw evidence:

- [hosted-smoke-38313496758-cli-failed.json](hosted-smoke-38313496758-cli-failed.json): 34434 bytes; SHA-256 1f104f60ca5839de302b40bb485b21b02ea91f788a4e44d317ae15a7f30fea29.
- [hosted-windows-recovery-38312885340.json](hosted-windows-recovery-38312885340.json): 8648 bytes; SHA-256 ee6c52dcbedd2c5cee84c2650e9f118c2810903627d86c97cb1555efc1fd965e.

# Integrated checks and isolated Windows recovery at 9cb2a7b8

Standard CI [38314355177](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38314355177)
passes all seven jobs at `9cb2a7b84c2cf545823388595bdd500b389a7bdd`:
Node 24/26, Windows onboarding, Linux/macOS/Windows installation recovery and
the browser gate. These checks cover the integrated sampled-epoch and strict
cleanup validation changes. The [checkpoint record](ci-checkpoint-9cb2a7b8.json)
binds their tested revision and individual job URLs.

The separately dispatched Windows recovery diagnostic
[38314447553](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38314447553)
also passes at the same revision with the existing SwiftShader WebGL backend.
All five installation, interrupted-update and rollback cycles preserve settings
and workspace contents and close without forced process termination. Graceful
close times range from 441 to 1,720 ms, within the unchanged five-second deadline.
The [downloaded raw artifact](hosted-windows-recovery-38314447553.json) is
18,119 bytes, SHA-256
`b1e358ca56156a69c4343a694ba14580d1ad63f46cd589fb6cbfd6fd9d7ed76e`.

This passing diagnostic does not reproduce or explain the earlier intermittent
Chrome process-shutdown timeout. No timeout process-tree snapshot was triggered.
The earlier failed report remains failed. Austin source readiness also remains
unresolved; these integration and recovery passes provide no completed Austin
performance samples or physical-GPU acceptance.

# Bounded setup-readiness history

Commit `f4c3859847596fe8ea3e0c241a06c350b4671148` adds an opt-in host-retained
history under the existing scene-frame diagnostics flag for the Austin fixture.
It samples the existing read-only native readiness observer through one owned
CDP session at no more than 1 Hz, retaining the latest 16 observations and an
omitted count. Each compact snapshot preserves layer identity, loading progress
and ownership counts within 1 KiB; oversized observations are explicitly marked
unavailable. Commands never overlap, stalled requests stop further sampling,
and late results are discarded. The sampler removes its own disconnect listener
using Puppeteer's actual event symbol and bounds session attachment, commands
and detachment separately. Unconfirmed cleanup remains explicit.

The original source-readiness predicate, 60-second deadline and 100 ms polling
remain unchanged. Sampling ends before measurement and installs no browser
globals or Worker/Blob wrappers. Its reports remain comparison-ineligible;
host command elapsed time is not CPU or GPU execution time. This is diagnostic
instrumentation, not a fix for the source-readiness failure.

Root integrated the packet at `29c26f4f9c438493956383661c71dc142af76f54` and
independently passed 98 focused readiness, failure-projection, capture, fixture,
sampled-epoch, cleanup and paired-report checks. The implementation commit also
passes formatting for all 1,616 scoped files and import/package boundaries.
Root's integrated import/package boundary checks also pass.
A hosted run with this new diagnostic is required before drawing conclusions
about the original Austin loading timeout.

# Hosted readiness history and CLI-stub regression

The new diagnostic run
[38317263307](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38317263307)
at `fe0f66c38c9f394d8282f157d63d81846ab9c4d9` passes baseline inspection and
initial Austin setup, then fails the original 60-second readiness deadline in
the first fresh provider-sample document. There are zero completed measurements.
The [unchanged raw failure](hosted-smoke-38317263307-cli-failed.json) is 106,071
bytes, SHA-256
`9625bfc4fb00c3c8899abbf467ac5a092bb4277dfb3dc4672ede0caad437ff21`.

The [independent history review](readiness-history-38317263307-review.json)
shows CCTV advancing from 20 to 24 to 28 prepared geometries in the failing
document before a diagnostic command exceeds its own 1.5-second bound. The
sampler stops polling and confirms session detachment and owned-listener removal.
A later post-failure native observation succeeds: 144 of 250 CCTV geometries
are prepared and 106 remain queued. All other selected layers are ready at that
observation. This establishes queue progress during the failed run; it does not
identify the execution bottleneck or establish an engine deadlock. The observed
renderer is SwiftShader. No deadline, population or acceptance gate is relaxed.

Root also recomputed fixture-interception cleanup for all three documents from
the actual release records. Each confirms drained commands/preparations/abort
subscriptions, removed listeners and completed target closure. The sampler's
bounded history contains 16 observations, with nine earlier entries explicitly
omitted. These successful diagnostic cleanup checks do not make the capture pass.

The accompanying standard run
[38317266608](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38317266608)
fails three CLI integration tests on both Node versions: their substituted
Puppeteer modules omit the newly imported `CDPSessionEvent` named export. The
actual installed package provides it. Two tests then mask the import error by
attempting to read a lifecycle file that was never created. The failed job-log
excerpts are preserved for [Node 24](node-ci-115036767698-failure-excerpt.txt) and
[Node 26](node-ci-115036767729-failure-excerpt.txt). This is a test-double contract
regression introduced by the diagnostic packet; the existing lifecycle assertions
must continue to run after the stubs are corrected.

Commit `032307c7b056d1d4938d6a5943db86001144cc8d` corrects the two affected
Puppeteer stubs without changing the runtime import or lifecycle assertions.
Missing-witness failures now include bounded child-process diagnostics, and a
negative control deliberately omits the named export to verify that the original
import error remains visible. Root merged this correction at
`67dbc77b79fe74474310ea26156f3f7e8e292ab8` and independently passed all 48
readiness, failure-report, smoke and CLI lifecycle tests. The full standard
workflow still needs to validate the corrected revision; this local result does
not change the outcome of the earlier failed jobs.

# Corrected integration checkpoint and native renderer diagnostic

Standard CI [38319069167](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38319069167)
passes all seven jobs at `debafa026810fd162a7d4d048a2a5ef75ac645f6`: Node
24/26, Windows onboarding, Linux/macOS/Windows installation recovery and the
browser gate. The [exact-revision checkpoint](ci-checkpoint-debafa02.json)
preserves the job URLs and outcomes. This validates the CLI-stub correction;
it neither changes earlier failed runs nor explains the intermittent Windows
Chrome shutdown timeout.

GPT-6 Luna's `cea1a3bd73ffe80b8af5441b820affa558784688` adds an optional
`macos-native-diagnostic` backend, integrated on this QA branch at
`652913fd894f8977973e7aa8409cfcf566c71f1b`. Root independently passes all 42
focused tests serially, including actual capture-CLI lifecycle tests and native
report validation. Integrated formatting passes 1,618 files; import/package
boundaries pass. An initial parallel local run timed out one existing 15-second
CLI subprocess; the unchanged deadline passes on serial rerun. That observation
is retained as a local test-execution limitation, not an application failure or
proof of its cause.

The backend uses the standard `macos-latest` GitHub-hosted runner for this public
repository. Parent and child Chrome launches omit software-renderer flags and
must verify the observed Cesium renderer against bounded Chromium acceleration
evidence. Missing, contradictory, software-fallback or substituted evidence
fails validation. Native reports remain explicitly ineligible for comparison
and physical-desktop performance acceptance. Ordinary Windows capture arguments
and the default hosted SwiftShader mode remain unchanged. Populations, visual
settings and the original readiness deadline are preserved.

The first native Austin diagnostic is
[38320527836](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38320527836),
and the native packet's standard integration run is
[38320791275](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38320791275).
Both target `652913fd894f8977973e7aa8409cfcf566c71f1b`; their outcomes were
pending when this checkpoint was written. A hosted Metal run can establish
full-fixture reachability, but differences in OS, CPU and browser prevent a
causal GPU-versus-software comparison without same-host controls. The packet
remains on QA pending actual capture validation; `dev` is not promoted by these
unit-test results.

# Native Austin result: readiness reached, warmup contract failed

Run [38320527836](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38320527836)
at `652913fd894f8977973e7aa8409cfcf566c71f1b` fails during the first idle
warmup with `Render boundary observer arguments are invalid.` Zero measurement
samples complete. The observed renderer is Apple paravirtual Metal, with
Chromium reporting WebGL acceleration enabled. The baseline inspection passes;
the candidate reaches both initial Austin setup and its first fresh provider
document's source-readiness boundary.

The subsequent setup observation preserves the requested Manual/Dense 75%
settings and selected populations: 828 satellites, 250 CCTV cameras, 776
viewport-selected ALPR cameras, 357 installations, 750 radios and 65,160 wind
cells. These are source/setup observations, not completed frame measurements or
visual-equivalence acceptance. Both readiness samplers separately reach their
1.5-second command limit and stop; their sessions and owned listeners are
confirmed removed. Root recomputes all three fixture-document cleanup results
from actual drain/release records and confirms the stored results.

The [independent review](native-38320527836-review.json) binds the tested
revision, observed renderer, selected populations and cleanup records to the
unchanged downloaded artifacts:

- [Outer smoke report](hosted-native-38320527836-smoke-failed.json): 220,255 bytes;
  SHA-256 `b91be12f89615e1b5548eb8ea2593acf3d43134c64e6715239aefd73d28d2a76`.
- [Raw failed capture](hosted-native-38320527836-cli-failed.json): 145,345 bytes;
  SHA-256 `a1c8156a3c755e21dd5b47a2bc7cc83ecde6f0e72218e9b2d44b62ac5d7e6af5`.

The immediate cause is a capture-harness contract mismatch: Austin uses the
shared render-boundary path while its absent optional progress binding is
represented by `null`; the observer only accepted omission. The native backend
made this later stage reachable. This report does not demonstrate a Cesium
runtime defect or a Windows hardware recovery fix. Luna's narrow correction
`ff04a619` accepts the absent binding and retains rejection of malformed actual
bindings. Root independently passes 45 boundary, completed-render and actual
capture-CLI tests. A hosted rerun is still required; the original failed run
remains failed.

# Native boundary rerun and successful-path scope audit

Run [38321326898](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38321326898)
at `66d8c8c169f53a358f2e8ac9a3a65b25fe171fab` gets past the optional-binding
failure. Both warmup and measurement render boundaries settle, observe
`postRender`, and remove their page listeners and timers. Their page wait times
are 27.3 and 29.8 ms; these are boundary waits, not motion latency or GPU time.
The measurement boundary confirms final-post-render loop retirement. Sample
assembly then throws `measurementBoundarySettle is not defined`, so zero
complete samples are published and the run remains failed.

Root revalidates the native renderer and all three document cleanup records in
the [independent review](native-38321326898-review.json). The unchanged
[outer smoke report](hosted-native-38321326898-smoke-failed.json) is 300,044
bytes (SHA-256 `45e203f7a70cf4fc90affd63164e373e30883f69d9d3b020659862425579eb31`);
the [raw failed capture](hosted-native-38321326898-cli-failed.json) is 207,316
bytes (SHA-256 `5f959cf026cb793f07162048643b76b0bad5d52f4abe14c63f802ef934c6b1f0`).

An additional read-only ESLint 9.39.1 `no-undef` audit finds four unresolved
project references in the complete capture and outer smoke scripts. The
measurement result and `clockEnd` are consumed outside their declaration block;
the Austin comparison-contract function is called without its import; and the
outer CLI validator refers to an Austin fixture variable owned by another
function. The [scope audit](scope-audit-66d8c8c1.json) records exact source hashes
and locations. Only standard Node/browser globals are declared; no project
identifier is suppressed. No repository dependency or lint configuration is
changed by this diagnostic. These are harness correctness defects, and the
next correction must cover the complete successful report path before another
capture is accepted.

# Scope correction independently checked

Luna's correction `e12e1d33b638fad2c7cf208787fb86dcc4ea098c` repairs
all four unresolved project references without changing the application, fixture
populations, visual settings, or timeouts. Root independently passes all 91
tests across the boundary observer, completed-render diagnostics, Austin
comparison contract, capture contract, capture CLI, and outer smoke suites.
The integration commit is `9e66e4a274f311b0a6b08f4ca636a9ff2cef3e7f`; its scripts are
byte-equivalent to the reviewed and tested Luna revision. The added contract
test exercises the observer result consumed by the comparison contract; it does
not by itself execute the complete capture CLI's successful lexical path.

A fresh [scope audit](scope-audit-9e66e4a2.json) on the integrated revision
reports zero errors and warnings across 17 capture/Austin modules and tests.
Source hashes are recorded for every checked file. The exported boundary helper
validates the page-reported completed-render wait, not host or GPU execution
time. A new real hosted capture remains necessary before successful-path
acceptance; both preceding failed native reports remain failed.

The earlier native-backend integration revision `652913fd` now has all
[seven standard CI jobs passing](ci-checkpoint-652913fd.json), including
Node 24/26, Windows onboarding, Linux/macOS/Windows recovery, and browser gates.
That run predates the boundary/scope corrections and does not validate them.

Fresh reconciliation on 2026-10-13 confirms fork and upstream `main` both
resolve to `8b8ccc9a81379e8b40d4be67610570ee5b159512`. Local and remote
`dev` remain `726e404b50a6586f9eb9085ca2478f605dfc698c`, 608 commits ahead
and zero behind main. This QA branch contains dev and main already. No additional
main merge, rebase, or discarded diff is required.

# Four native samples reach the final integrity gate

Run [38322832429](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38322832429)
at `f204837e224e8a7d5ae98a7ebe051365db24b0e0` completes four short Austin
samples before failing final integrity with an unlabeled `false !== true`
assertion. The preceding scope failures are no longer reached. This remains a
failed run; no timing or comparison acceptance follows from the completed count.
The bounded failure serializer drops every complete sample, leaving four sample
delivery summaries but no candidate before/after visual settings for replay.

Root independently confirms Apple paravirtual Metal and recomputes all six
fixture-document cleanup records from their actual releases. Every cleanup is
confirmed and all four retained ALPR route-coverage summaries are complete.
The [review](native-38322832429-review.json) binds exact source hashes and
unchanged [outer](hosted-native-38322832429-smoke-failed.json) and
[raw capture](hosted-native-38322832429-cli-failed.json) reports.

A concrete incorrect harness expectation is visible independently of the
unlabeled assertion: the Austin comparison requires FXAA enabled, and its
mock fixture supplies that invented value. The real frozen baseline observer
reports antialias enabled, four MSAA samples and FXAA disabled before and after
inspection. Candidate viewer configuration likewise sets four MSAA samples and
does not enable FXAA; pinned Cesium 1.138.0 initializes the FXAA stage disabled.
The next correction must preserve those rendering defaults and validate the
complete visual contract with meaningful failure labels. Because candidate
samples were truncated, this record does not identify the exact failed sample
or prove that correcting FXAA alone will make the full capture pass.

# Permanent harness scope gate

The recurring undeclared-reference failures now have a dedicated standard-CI
gate covering the same 17 capture/Austin files. It uses only `no-undef`, standard
Node/browser globals, and no inline configuration. Luna implemented the gate
in `94577d10`, disabled inline suppression in `86537883`, and updated the
pinned tools to ESLint 10.12.0 / globals 17.13.0 in `21be98a4`. The earlier
ESLint 9.39.1 audit remains historical; ESLint's [support policy](https://eslint.org/version-support/)
identifies version 9 as end-of-life. The new dependency supports Node 24/26.
No existing application dependency version changes in this packet.

Root independently passes all three gate tests and the 17-file check. A stronger
[actual CLI control](permanent-scope-gate-control.json) copies the checked files
into an isolated directory, substitutes the two real broken entrypoints from
`66d8c8c1`, and confirms exit 1 with all four historical undeclared references.
Restoring the current entrypoints produces exit 0 with all 17 files passing.
Tracked files are not modified by this control. This prevents that defect class
in the audited scope; it does not prove successful capture or runtime performance.

# Rendering contract correction and independent controls

Luna's `0bf84d03` records the actual rendering contract: resolution scale 1,
four MSAA samples, WebGL antialiasing enabled and FXAA disabled. It binds the
native before/after settings to the capture and condition copies and rejects
coherent changes to each rendering property. Follow-up `8282a620` gives
sample-local assertions the existing `<scenario> run <n>:` prefix, preserving
scenario/run extraction in bounded failure reports. ALPR coverage and source
provenance failures also receive explanatory labels. Application settings, fixture
bytes/hash and the 256 KiB failure cap are unchanged.

The [independent control](austin-aa-contract-control.json) runs the real
fixture-backed comparison case with a read-only loader substitution of the
old contract. It [fails at the old FXAA assertion](austin-aa-old-contract-control.tap)
with the baseline-observed settings. The corrected contract and bounded-failure
suites pass all 14 checks after integration. This demonstrates the contract defect;
it does not reconstruct the discarded candidate samples from run 38322832429.

An earlier broader local run at `ac14dfbd` passes 100 of 101 checks. The first
CLI startup case fails after 15,027.7 ms with empty stderr at its unchanged
15-second child limit. The subsequent isolated [four-case CLI rerun](austin-aa-cli-recheck.tap)
passes, with the first case taking 3,250.8 ms. The original failure is preserved
and its delay cause remains unresolved; no timeout was relaxed.

All [seven standard CI jobs](ci-checkpoint-f204837e.json) pass at exact
`f204837e224e8a7d5ae98a7ebe051365db24b0e0`, including Windows recovery.
That revision predates the permanent scope gate and rendering-contract repair;
those changes require their own exact-revision hosted capture and standard run.

At integration `a734071297f3cd6cc1cbee1d2c43b64412152149`, the full formatting
check passes across 1,621 files and package-boundary validation passes for
1,010 modules and 80 portable entries. A fresh fetch also confirms the same
main/dev revisions and zero missing main commits recorded above.

# Infrastructure CLI validation before fixture loading

Luna's changes in `28e2b0a7`, `5cc7708d` and `6bfd6ab1` defer the
Cesium-backed infrastructure producer until workload, flag and build-provenance
checks permit a capture. Integration is `29b06390276bee67ea882d7e0393e7150ff109c8`.
The same factory still verifies pinned asset bytes and constructs the Cesium
JulianDate clock. No capture limit, application setting or fixture changes.

Root's [actual CLI control](infrastructure-cli-import-control.json) uses an
import hook that rejects Cesium resolution. The unchanged previous entrypoint
hits that witness before rejecting missing provenance; the candidate produces
the intended provenance error without importing Cesium. All [27 independent
focused tests](infrastructure-cli-focused-tests.txt) and the 17-file scope gate
pass. The malformed-receipt case was also checked during uncommitted development;
it does not require a clean worktree merely to test early JSON rejection.
This demonstrates removal of unnecessary early work. The earlier intermittent
15-second startup delay remains unexplained.

# Native capture exposes an unrecorded installation predicate

Run [38325432288](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38325432288)
at `6b675ff90ade278438ae6111ea2354463bfc01df` completes three short samples,
then fails the installations population assertion at scripted-motion run 2's
measurement end. The [independent review](native-38325432288-review.json)
recomputes all six document cleanup records and confirms Apple paravirtual Metal.
The measurement render boundary settled in 68.984 ms of host elapsed time.
This is neither a timeout nor performance acceptance.

The [unaltered capture](hosted-native-38325432288-cli-failed.json) and
[outer report](hosted-native-38325432288-smoke-failed.json) are hash-bound in the
review. The assertion throws before the failing after-observation is attached,
and the report does not preserve its exact predicate or inputs. Completed-sample
records were also dropped by the bounded serializer. A new compact diagnostic
must preserve the real rejection reasons without relaxing population checks,
changing rendering defaults, or increasing the 256 KiB failure-report cap.

The infrastructure CLI integration also passes the complete 1,621-file formatting
check and both package-boundary checks (1,010 modules, 80 portable entries).

# Bounded installation predicate evidence

Luna's diagnostic `f6c594c0` and test follow-up `64b25bdb` preserve the
original installation predicate and its evaluation order. Rejections now attach
input-derived reasons and bounded scalar observations through the existing
error-actual/error-expected reporting path. Integration is
`469ddc6d5b74ad6094a40776fafcc7f7ab918a07`. Loading/error state, declared and
observed counts, identity-list validity, unique/unknown identity counts, and
observed/recomputed digests are distinguished. No source payload or full catalog
is attached; no deadline or readiness criterion changes.

Root's [23-case old/candidate control](installation-population-control.json)
confirms identical acceptance and verifies the failure details survive complete
current-observation replacement under the unchanged 256 KiB cap. All
[39 focused integration tests](installation-population-focused-tests.tap),
the 17-file scope gate and changed-file formatting pass. These controls prove
the diagnostic behavior, not the cause of run 38325432288. A fresh exact-revision
hosted capture is needed to obtain that missing observation.

All [seven standard CI jobs](ci-checkpoint-6b675ff9.json) now pass at
`6b675ff90ade278438ae6111ea2354463bfc01df`, including Windows recovery and
the complete browser job. This validates the scope and antialiasing contract
packet, not the later lazy import or installation diagnostic changes.

Read-only source review identifies a hypothesis to test, not a diagnosis of the
missing after-state: installations camera events use a 180 ms viewport debounce
(`src/layers/installations/lifecycle.js`, `viewport.js`, `policy.js`).
Ingestion marks loading during source/floor processing and retains prior records
until replacement publication (`ingestion.js`). A completed render therefore
does not prove installation ingestion has finished. The observer reads stats and
copies analyst projections synchronously before awaiting hashes; those awaits
alone do not explain an identity/count inconsistency. The new predicate evidence
must distinguish loading, data validity and identity faults before a correction
is selected. Current deadlines and rejection rules remain unchanged.

The exact next diagnostic candidate is
`f9413507bf66a1734e4abb59c6db756c30a232f3`: native Austin run
[38326601285](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38326601285)
and standard run
[38326809262](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38326809262).
Both were dispatched for new validation; this entry does not record a pass.

# The new diagnostic identifies in-flight ingestion

Native [run 38326601285](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38326601285)
at `f9413507bf66a1734e4abb59c6db756c30a232f3` fails scripted-motion run 1's
measurement-end installation check after two completed samples. Its sole
input-derived reason is `still-loading`: the captured layer has no error,
357 unique string identities, zero unknown/non-string identities, and matching
observed/recomputed identity digests. Root rechecks those scalar relationships
and independently recomputes all five reached document cleanups.

The [review](native-38326601285-review.json) binds the original
[capture report](hosted-native-38326601285-cli-failed.json) and
[outer report](hosted-native-38326601285-smoke-failed.json). The completed-render
boundary returned after 56.642 ms of host elapsed time while installation
ingestion was still active. This demonstrates the missing source-readiness
condition in that capture boundary; it does not establish an installation-data
fault or reconstruct the missing after-state from the earlier run.

The next correction waits for observed in-flight ingestion to complete and then
for a completed render within the existing page/host boundary budgets. It must
retain strict population validation, held fixture clocks, route endpoints and
all rendering settings. Full capture and performance acceptance remain failed.
