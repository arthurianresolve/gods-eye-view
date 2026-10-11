# S47 observer costs: attributed, capture still failed

Frozen application and harness: 6721940d14fbfab444cda2c889698383ea36a5d7, both clean. The original hosted report is preserved byte-for-byte in report.json.

Two idle samples complete, followed by a failure at the unchanged five-second completed-render boundary before the first motion sample. The scene retains 2,500 aircraft, 4,362 datacenters and 716 dams, Manual 75% / Dense, at 1440 by 900 with SwiftShader. Post-capture served-asset verification is absent because the capture failed.

The four before/after observations record 2,108.0, 4,064.0, 3,315.2 and 2,440.9 ms total wall time. Renderer/vendor reads account for almost all of that cost; each other individual settings/population read is below one millisecond. These are synchronous wall times and may include waiting for queued rendering; they are neither CPU execution times nor GPU timings. They do not establish a Windows driver root cause.

Follow-up 681e704a reuses the existing early probe on the actual Cesium context, retaining live canvas/context/loss checks and live settings/population observations. It passes 40 focused observer, probe, failure-report and smoke checks; hosted run 38170201283 is pending. It is isolated QA code, with production rendering and deadlines unchanged.

This failed diagnostic supplies neither paired performance acceptance nor hardware acceptance.

[Hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38169235037).

Original report SHA-256: 03382c4f5cef8465ae2e3195fdbed9754883892a3cc46dbe1a0ddb2f5a6be66e
