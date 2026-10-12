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
