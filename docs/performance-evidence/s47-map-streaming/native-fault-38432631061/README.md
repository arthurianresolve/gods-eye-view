# Native fault control: terrain-stage validation correction

[Run 38432631061](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38432631061)
at `dddef9eb66357394f596fad028fb671b9263abf3` remains **failed**. This is free
hosted macOS diagnostic rendering, not physical Windows qualification. Original
artifact `11831278589` is preserved byte-for-byte below.

The healthy baseline and candidate journeys and the candidate capture CLI
completed. In the first independent fault document, one declared missing Esri
metadata response caused automatic OSM fallback. Manual retry then recovered
Esri. The initial photoreal snapshot uses `EllipsoidTerrainProvider`; fallback
and recovery use `CesiumTerrainProvider`. The controller reached ready states
and fresh frames. Interception recorded 212 requests: 211 normal acknowledgements
and one declared fault acknowledgement, with no pending/error observations.
The owned context closed and interception cleanup was confirmed.

Validation incorrectly required tiled terrain in the initial photoreal state.
Production viewer creation leaves Cesium's default ellipsoid terrain in place;
`MapStackController._activateTileset` deliberately leaves terrain untouched while
the globe is hidden. The first globe activation creates tiled terrain lazily.
The test harness had modeled that initial state incorrectly too.

Reviewed correction `e701e0ff792a19f2f2c6fc1d25efce56c815c3b0` (Luna source
`dbfda2de42192d0bed1b5c26c39006e61193f1f2`) requires ellipsoid terrain only for
that initial photoreal stage. Every fallback, retry and final globe state still
requires `CesiumTerrainProvider`. No runtime, deadline, detail or acceptance cap
changed. Root passes **98/98** page/delivery/outer tests, changed-file formatting,
capture no-undef checks, and replay of the original control. Three mutations of
the initial, fallback and recovery terrain classes each fail specifically on
the terrain-provider assertion.

Replay validates only the saved control. The original run stopped before full
outer worker/renderer evidence was collected, and it did not execute the corrupt
or superseded controls. It is not retrospectively passed. Fresh all-scenario
validation is [run 38434748788](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38434748788)
at the corrected revision; its outcome must be recorded separately.

| File                                                                                   |  Bytes | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Outer report](performance-build-smoke.json)                                           | 479891 | `e249f8b744f91de900623c62d899ce5d2c4e8e85ac730ae978f025ca2529647e` |
| [Candidate CLI report](performance-build-smoke.json.capture-cli-report-candidate.json) | 379776 | `5a14f1928b6b1cbbea81cc8a1168400ad01fdb3fc3356ae8af101bad6c500caf` |
| [Correction test log](fix-focused-tests.log)                                           |   9595 | `7892805cd3ce255613e4b9a6c5f0c5b133ede3f1e49e9be577845dcbb2acc103` |
