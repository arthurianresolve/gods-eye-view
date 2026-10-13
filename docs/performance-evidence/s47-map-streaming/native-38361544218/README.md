# Native map terrain queue evidence

[Run 38361544218](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38361544218)
fails at exact candidate/harness `1b4c8dab8b718e03602ca84d53b6054cc1778f0f`.
Baseline is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`; hosted SwiftShader
does not establish physical-hardware performance. No candidate journey runs.

The [raw report](performance-build-smoke.json) is 32,766 bytes, SHA-256
`9156de67fbb1f6592cf27af9712aa9f27a2723844bb4b5e7a89d7e05397ad411`.
Artifact `11794629008` (`performance-build-smoke-38361544218`) has archive
digest `ffa0f7a779b36a8d7822d6331e4964823e5c43068a8cc2690046afc3112357cf`.

## Observed failure

Initial photoreal readiness completes. The first Esri transition reaches the
native terrain and imagery providers and a ready map controller, but cannot
complete the required ready renders within the unchanged deadline. Host
journey time is 56,006 ms; route checkpoint time is 49,155.4 ms. Page and
interception error lists are empty.

The repaired report now retains finalized delivery: 51 requests and 51
acknowledgements, zero pending/cancelled requests, zero delivery errors and
confirmed cleanup. It includes the native terrain layer metadata and served
terrain ancestors through level ten. These counts establish delivered fixture
bytes, independently of decoding and terrain preparation.

The globe snapshot contains zero high-priority, 48 medium-priority and 18
low-priority queued tiles, with 11 rendered tiles. All eight bounded samples
are level-17/18 tiles with quadtree state `LOADING` (1), terrain state `FAILED`
(0), no mesh, and a loading-imagery reference whose imagery state is `READY`
(4). The first sample is `(59940,43502,17)`, inside the Austin route patch;
its served level-ten ancestor is `(468,339,10)` (TMS path `10/468/684`).

`FAILED` is not proof of a rejected worker task. The pinned Cesium state
machine also assigns this state when a tile has no directly available terrain
and needs to upsample a parent. It can remain there while the parent is not
ready. The snapshot does not yet contain ancestor readiness or worker errors.
The earlier CPU failure for off-route siblings therefore cannot establish the
cause of these in-route queued tiles.

## Retirement and next check

Operation disposal is confirmed. Probe retirement completes in 10.093 ms
within its one-second bound, with both owned listeners removed, the hook
restored, the render loop retired and the future-document registration removed.
The context closes and interception release confirms zero owned pending work,
late requests or drain errors. No cleanup error is reported.

The next discriminating check follows this exact in-route ancestor chain
through source and bundled worker calculations, preserving structured-clone
semantics, then examines the first live ancestor unable to provide a mesh.
No new terrain data, readiness relaxation, timeout increase or engine change
is justified until that gap is identified. This run validates useful failure
retention; it does not complete M3 or performance acceptance.

## Follow-up diagnostic review

The [reproducible CPU replay](terrain-chain-probe.mjs) and
[saved result](terrain-chain-probe.json) now follow the exact sampled tile
from level ten through level seventeen. Source handlers and the minified
`Build/Cesium/Workers` handlers copied by the production Vite plugin agree
at all eight levels. Quantized vertex counts are
289, 188, 75, 35, 19, 13, 15 and 16; every horizon point is finite.
Root independently reran both modes and matched the saved rows and worker
hashes. This exercises CPU handlers with structured-cloned inputs/outputs,
not browser Worker transport, scheduling, WebGL or rendered readiness.

Diagnostic commits `75a50fbb` and `13344b8b` add one read-only ancestor chain
for the first sampled queued tile, capped at 24 rows. It retains mesh/data
presence, terrain states and upsampling availability with explicit unknown,
cycle and truncation states. Parent identities are checked during projection.
The existing eight queue samples and 32 imagery entries per sample remain
bounded. The chain survives both capture and outer failure serialization.

Root passes 81 focused capture, delivery, failure-report and outer-smoke tests,
25-file capture lint, changed-file formatting and package boundaries.
Tests cover the full bound, malformed identity, absent/throwing private
properties and cycles including the final permitted row. No render setting,
readiness condition, fixture byte or deadline changed. The next hosted run
must locate the first live ancestor that cannot provide a mesh; these component
checks do not establish that the original terrain stall is fixed.
