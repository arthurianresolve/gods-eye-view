# S50 CCTV frustum input-reuse experiment — rejected

This isolated experiment tested an exact-input memo in `applyFrustumGeometry`.
The baseline is `37afdc6d66b74487ee2280dacc38566ccb3a1530`; the candidate used
the same base commit and the source snapshot recorded below. No production
change was retained.

The memo could skip `computeFrustumGeometry` when camera pose, ground altitude,
probe clamp, footprint support values, and materialized output references all
matched. Focused behavior tests covered camera/ground/probe changes, in-place
footprint mutation, cleared position/geometry/billboard/polyline references, and
non-finite latitude behavior. The candidate passed 11/11 tests. The report also
requires identical final output hashes between baseline and candidate for each
workload.

The final five alternating Node 24.16 pairs show gains for repeated inputs and
intermittent pose/terrain updates, but the moving workload changes heading on
every call and is slower in every pair. Its median increased 35.6% in the final
candidate report. That path is real: calibration drag calls
`applyFrustumGeometry` for each transient pose. This miss-path regression fails
the unchanged 10% performance gate, so the memo is rejected despite the gains
in the other workloads. This is a pure-function CPU microbenchmark, not a full
layer, rendered, or GPU acceptance test.

The original candidate source and test, benchmark harness, focused TAP output,
and complete five-pair report are retained in this directory. The final report
is [`comparison-final-node24.json`](raw/comparison-final-node24.json). To reproduce the
comparison, use the isolated S50 worktree at the baseline commit. Copy
this evidence directory from the archive commit into that checkout first, then
copy its candidate snapshots into their source paths as below. The checkout
needs the pinned dependencies installed. Do not run these copy commands over
active development work.

```powershell
Copy-Item docs/performance-evidence/s50-frustum-input-reuse-rejected/candidate/src/layers/cctv/geometry.js src/layers/cctv/geometry.js
Copy-Item docs/performance-evidence/s50-frustum-input-reuse-rejected/candidate/src/layers/cctv/geometryReuse.test.mjs src/layers/cctv/geometryReuse.test.mjs
Copy-Item docs/performance-evidence/s50-frustum-input-reuse-rejected/candidate/scripts/performance/cctvFrustumInputReuseComparison.mjs scripts/performance/cctvFrustumInputReuseComparison.mjs
node --test --test-reporter=tap src/layers/cctv/geometryReuse.test.mjs
node scripts/performance/cctvFrustumInputReuseComparison.mjs qa-artifacts/s50-frustum-input-reuse-replay
```

The output path must be fresh. The runner checks HEAD, candidate source bytes,
the harness, and all imported runtime dependencies before and after the five
pairs. It does not force garbage collection.

Candidate `geometry.js` SHA-256:
`801b0e62c9a9ba2df83a21a16a6a23989a89ee797e4d250de7c4a207faef6ad0`

Baseline `geometry.js` blob SHA-256:
`3465e545bacfb9f55d04f1365065277323590ad5f8dc715ae3b7fc25be9bdedf`

Candidate test SHA-256:
`757e2d4bf91d95ee292341a8ba408631d8c60507251a05f01e289adcdd665b2a`

Final comparison harness SHA-256:
`8ba78e8bc9a9d9dcec76a860c550cb8840ac0ed63dc4ce828a448f2733f6291e`

Final report SHA-256:
`3f05bf23604dda7a67d13d809169b9c46190be9efa541671fb4ff10c733e6495`
