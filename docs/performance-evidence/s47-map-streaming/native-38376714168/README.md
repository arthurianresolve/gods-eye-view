# Hosted Metal native map control: run 38376714168

Status: **failed**. This is diagnostic evidence, not performance or physical
Windows acceptance.

- [Workflow run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38376714168)
- Baseline: `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`
- Candidate and harness: `7fbbf1fa56fe3d9c746827be0b501b7b31cfb87e`
- Requested backend: `macos-native-diagnostic`
- Observed renderer: `ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)`
- Artifact: `performance-build-smoke-38376714168`, ID `11801921754`
- ZIP: 5,893 bytes; SHA-256 `390ad9b1f7638ea2f0c0ad52908bea9979f8b0cccc2c231ae1b7a9e4241820bb`
- [Unmodified raw report](performance-build-smoke.json): 30,614 bytes;
  SHA-256 `10b82b79d70aa93ddef759f572911c4fa7f82148bda79290f091384845bcf536`

## Observed outcome

The baseline fails during `native-map-streaming-journey` with
`Observed route starts at the declared native camera pose.` The candidate
journey never runs. Duration is 128,853 ms. No page errors are recorded.

This occurs later than the terrain-readiness timeout in
[the same-code SwiftShader run](../native-38366041110/README.md). Both operating
system and renderer differ. The generated fixture bytes also differ, so these
are not matched-input measurements or an isolated GPU causal comparison.
The report verifies hosted Apple paravirtual acceleration, not physical desktop
coverage or a performance improvement.

The SwiftShader fixture manifest is
`36eb2997bb092b029a541b810f92d7c19d982010e763129948acb438c18a277f`;
the Metal manifest is
`798411accb8f7f52c8f58562ec6263f1bebd48cdbcda97527b57c1a4ef5fe0d4`.
Of 51 shared delivered assets, six have different hashes: `tileset/tileset.json`
and GLBs `level-1/1-0`, `level-2/1-0`, `level-2/1-1`, `level-2/2-0`, and
`level-2/2-1`. Shared terrain and imagery bytes match. The current generator
therefore needs cross-platform determinism investigation; same source revision
alone does not prove the same fixture. This does not establish that byte
differences caused the observed camera or missing-asset failure.

Fixture delivery records 84 requests and 84 acknowledgements, no pending
requests, and 104 `native-asset-not-in-manifest` error observations. The report
retains error counts without missing asset paths. Fixture delivery validation
and its `cleanupConfirmed` field remain failed.

Owning context closure and interception retirement are confirmed, with zero
pending, late or failed drain operations. Probe cleanup completes in 6.968 ms:
both listeners are removed, the hook restored, the render loop retired and the
script registration removed. These owner-cleanup results do not override the
fixture delivery errors.

## Evidence gap and next correction

Neither `mapStreamingNativeJourney` nor `mapStreamingJourneyFailure` is present
in the raw failure report. Source inspection of the tested harness shows that
`runNativeMapJourneyForSmoke` awaits a completed journey, validates it, and only
then returns the envelope assigned by its caller. A validation exception loses
that journey before the outer catch can retain it.

A read-only controlled replay of the actual smoke helper confirms this loss on
a validation exception. A second replay of the actual delivery adapter submits
two distinct missing canonical OSM tile paths; both become a single
`native-asset-not-in-manifest` count with no asset identity. These controlled
reproductions explain missing diagnostics; they do not establish the browser's
actual camera discrepancy, missing tiles, or their causes.

Preserve bounded completed-journey observations on validation rejection and
bounded canonical fixture asset identities for missing assets. Test smoke and
serialized failure-report paths. Keep strict validation, visual settings,
terrain detail and deadlines unchanged until observations support a correction.
Do not turn this failed control into acceptance or repeat it unchanged.
