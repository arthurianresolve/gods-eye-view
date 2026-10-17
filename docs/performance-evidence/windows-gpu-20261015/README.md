# Primary Windows UHD 620 exact-head soak — 15 October 2026

This packet records the physical Windows mixed-use stability result for the
current merged `dev` candidate. It supersedes the earlier candidate only for
the tested revision; the 14 October packet remains historical evidence for its
own commit.

## Exact candidate and environment

- Application, harness, and validator commit:
  `786583e0ee8a36a670fe81cd244e8923bf84014b`.
- Source and harness were clean at start and unchanged during the run.
- Both fork and upstream `main` were at
  `f0a1b22dc82c6c5cd9690d07c1cdb297818da86f`, already contained in the
  candidate.
- Browser: Chrome `152.0.7977.75`.
- Host: Windows 10 `10.0.19045`, x64, Intel Core i7-8665U, eight logical CPUs,
  16,907,538,432 bytes of memory.
- Renderer: Intel UHD Graphics 620 through ANGLE Direct3D 11/WebGL 2, driver
  `31.0.101.2145`; GPU compositing and hardware acceleration were verified.

## Results

The headed run completed 3,606,892 ms with:

- `operationStatus: passed`
- `fullSoak: true`
- `hardwareRenderingValidated: true`
- `stability.status: passed`, with no failed or pending stability checks
- 13 post-GC checkpoints and retained-heap growth ratio
  `0.023394102019120788` (2.34%)
- 252 mixed-use iterations, 1,008 source toggles, 252 replay seeks, 252
  imports, 504 workspace reloads, 252 archive failure/recovery exercises, and
  252 camera recovery exercises
- warmed listeners returning from 646 to 644, with stable owned scene and
  layer resource counts
- zero final pending worker tasks and zero application-owned pending jobs
- a 111,147,108-byte peak JS heap
- a completed browser close in 1,078 ms, process exit code 0, and no forced
  process termination.

The worker preflight passed its normal, reuse, expected-error, recovery, and
network-interception cases. The exported recording bundle also passes the
production `parseRecordingBundle` integrity and policy validator as a complete
two-chunk aircraft recording.

## Artifacts and integrity

- Raw soak report: `windows-uhd620-full-soak-786583e0.json`
  - SHA-256:
    `8c9fc7d2f7cedf87a51e1b55bd1713f9a58bbfa2010984d2d495dbd63473815c`
- Recording bundle: `windows-uhd620-recording-786583e0.json`
  - SHA-256:
    `9d7c488cd05bbda4aa65374e0ac60038186d69b745bd56f2bf805ad877eb8d2c`
- Independent stability recomputation:
  `windows-uhd620-full-soak-786583e0-review.json`
  - SHA-256:
    `16faf2833c0f4d7f7ea64d416eba4443d9e3f893f04b4f778d11baf2cb7ad197`

The recomputation uses the committed validator at the same exact revision and
returns `outcome: passed` with the same 2.34% heap-growth ratio.

## Scope

This passes the available primary-machine 60-minute retention and recovery
gate for the current candidate. It does not establish the matched
baseline/candidate motion-p95 objective, GPU timing, unavailable physical
macOS or discrete-Windows coverage, release publication, or VM105 deployment.
