# S60 physical Windows matched Dense capture - 15 October 2026

This packet preserves the first accepted five-run baseline/candidate Dense
comparison on the available physical Windows machine. Both reports use Chrome
152, a 1440 x 900 drawing buffer at DPR 1, and the Intel UHD Graphics 620 ANGLE
D3D11 renderer. Every sample remained foregrounded and visible. The workload
contains 2,500 aircraft, 4,362 datacenters, and 716 dams at Manual / Dense 75%.

The frozen application revisions are:

- baseline: `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`
- candidate: `6e196d8fcf82751ea7658aabceb9a99948a572a4`
- shared capture harness: `c10aabe66af80acdc1088486ec05d0d14a3091ac`

The harness revision fixes the cross-version fixture adapter. It applies the
declared density through the public `setDetection` API in every fresh measured
document and verifies both the engine and visual-state value. One earlier pair
was correctly rejected because the frozen baseline's visual state remained at
50% while the engine used 75%; that rejected report is historical diagnostic
evidence and is not part of this packet.

Both accepted reports contain 15 samples: five idle, five scripted-motion, and
five selected-aircraft-tracking samples. Each sample uses a 30-second warmup
and 60-second measurement. The strict paired validator reports:

| Scenario | Baseline median p95 | Candidate median p95 | Change |
| --- | ---: | ---: | ---: |
| Idle | 220.7 ms | 200.9 ms | -8.97% |
| Scripted motion | 217.5 ms | 213.1 ms | -2.02% |
| Selected-aircraft tracking | 1107.1 ms | 1143.2 ms | +3.26% |

No scenario regressed by more than 10%. The proposed 20% motion/tracking
objective was assessed and **not achieved**, so this packet supports the
regression gate but not the stretch improvement claim.

Artifact hashes:

- `baseline-dense-investigation.json`:
  `9fc04cf278513532cf9d1a632e39c14c983dcc8866bd9e00f02d54903848d2bc`
- `candidate-dense-investigation.json`:
  `9a9b9e61a15ef711b3bb96849b608dd9977367a7a8e7592f701d027577b8d92d`
- `paired-dense-investigation.json`:
  `030c839e97dba6fef496f8e29868c986f8c99e454e2a63feb9c9956b076a6208`
- baseline `receiptSha256` identity:
  `a98378d59b5ef465bd40142aa485e52f5a210ab265601686765d0b168f8576f6`
- candidate `receiptSha256` identity:
  `bd6c149f97d44006ab9964141c488b7efd54d1aef064762e5949c5fb5a4f87b2`

The receipts are unsigned local build receipts. They bind clean application and
harness commits, dependency/build recipes, output assets, and served bytes; they
are not release attestations. Physical macOS and discrete-Windows coverage is
unavailable in the current environment and remains recorded as unavailable.
