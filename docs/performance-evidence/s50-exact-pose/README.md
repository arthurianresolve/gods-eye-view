# S50 exact camera-pose ownership - 12 October 2026

Candidate `61c050caf84415dafd844e5524f1a91d09ef1a70` fixes a reproducible terrain
cache collision. The source-compatible `p1` key rounds latitude/longitude to
six decimals. Supported north offsets of 0.4 m and 0.5 m from latitude 40.7
produce different positions but the same key. A similar collision occurs for
east offsets near the equator. The previous code could keep an earlier DEM
footprint, accept a pending response for the earlier pose, or use shipped support
heights after a calibrated pose moved within the same rounded bin.

Source attribution: upstream/fork main checkpoint `591f299d` also contains the
six-decimal hash and the four hash-only cache/consumer guards in
`cctvFootprint.js`, `cctv/ground.js` and `cctv/geometry.js`. The defect is inherited
at those ownership checks. The executed negative control is the integrated
`48329a9f` runtime; no full upstream browser comparison is claimed.

Runtime cache reuse, geometry consumption and late-result acceptance now compare
all seven finite pose fields exactly. The snapshot includes the effective probe
range. Existing record and request-revision guards remain in force. Shipped data
still uses its unchanged `p1` compatibility key, with an additional requirement
that the effective pose equals the camera's base pose. Returning calibration to
that base pose restores eligibility. A legacy runtime cache without an exact
snapshot refreshes safely. No workspace schema, bundled sidecar, rendering detail,
camera ownership or public layer interface changes.

The regression tests use the actual calibration normalization, model and
geometry pose producer. Ground tests spy only on geometry publication and supply
controlled terrain responses. The separate geometry tests exercise actual
frustum construction and its support-height consumer.

- **Negative control:** at unchanged runtime `48329a9f`, copying only the two
  candidate test files yields 25 tests, 19 passes and six expected failures.
  The failures cover shipped-data eligibility, runtime support consumption,
  north/east cached-result collisions, a legacy hash-only cache and stale pending
  completion. [Original output](old-runtime-tests.txt).
- **Candidate:** all 83 focused tests pass, including queue coalescing, source
  reinitialization, terrain owner changes, calibration render demand, sidecar
  compatibility, frustum math and lifecycle report validation.
  [Original output](candidate-focused-tests.txt).
- **Static checks:** formatting passes for 1,563 registered files; package
  boundaries pass for 1,009 modules and 80 portable entries. A corrected spy
  assertion was checked directly with Prettier, and all 83 tests were rerun.
- **Hosted lifecycle:** [run 38240312988](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38240312988)
  passes five unchanged toggles with geometry submissions fixed at 10. Enabled
  checkpoints have six listeners, two timers and no pending jobs; disabled
  checkpoints have five listeners, no timers and no pending jobs. Rapid revisions,
  held late worker results and direct reinitialization pass. The owned Linux
  SwiftShader browser exits naturally in 69.3 ms.
  [Raw report](cctv-lifecycle.json), [independent replay](cctv-independent-review.json).
- **Hosted native calibration:** [run 38240316095](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38240316095)
  passes five alternating pairs on Apple paravirtual Metal. Recorded before/after
  pixel and geometry hashes match across each pair, native drags complete, and all
  ten viewers/governors are released. Candidate-mode idle renders remain zero;
  the same-build continuous-render controls total 1,449 frames. The browser exits
  naturally in 577.3 ms. This checks the existing scheduler and calibration input;
  it is not a before/after-code performance comparison or terrain-height visual
  matrix. [Raw report](native-calibration.json),
  [independent replay](native-calibration-independent-review.json).

Both hosted reports identify the exact clean candidate and were independently
revalidated with its unchanged validators. Integrated source at
`40b9f5c91355ccc37f7c2ca664f92893be4ccdb2` passes all seven standard CI jobs,
including Node 24/26, three-OS recovery, Windows onboarding and browser journeys.
[Exact integration run](standard-ci-dev-38240973936.json).

[Review manifest](review.json) records commands, test identities and original
artifact hashes. The saved PowerShell test outputs retain their original bytes.
This fixes one concrete S50 revision-ownership defect; it does not establish a
performance improvement, physical Windows validation or full S50/S60 acceptance.
