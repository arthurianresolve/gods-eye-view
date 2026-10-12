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
