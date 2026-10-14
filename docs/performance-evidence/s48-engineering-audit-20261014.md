# S48 engineering audit, 14 October 2026

This is a review note for the S48 engineering row in `docs/CESIUM_ACCEPTANCE.md`.
It separates delivered diagnostic machinery from the still-unresolved cost
evidence. It does not change the acceptance ledger or declare S48 closed.

## Source and evidence identity

- Reviewed source snapshot: `9e0109f1d1720712fedb7e9249d9992d418198d4`
  (the requested root QA revision). The root worktree later advanced to
  `edac418b`; relevant S48 sources below were read from `9e0109f1` so later
  unrelated panel-key commits do not alter this review's source identity.
- Matched diagnostic source: `b29fd471df314b5bf803617b63e645b7fe3885af`.
- Report: `docs/performance-evidence/resume-validation-20261014/overlay-matched.json`,
  SHA-256 `e4b438f0cd76b591ecac57f16d1910663d0ab6f12abea85750d1fe6f3da0d850`.
- Runner: Windows `Node v24.16.0`; schema `gev-overlay-cpu/v2`; five alternating
  disabled/enabled pairs per workload, a fresh Node process for each arm,
  identical virtual frame clock and population witnesses.
- Relevant source SHA-256 at `9e0109f1`:

| File | SHA-256 |
| --- | --- |
| `scripts/performance/overlayAttribution.mjs` | `aeff06ae49c558d5397d04cac61dfe35e121f3f2b9f0c0c302217e6fc0c7973d` |
| `scripts/performance/overlayAttributionContract.mjs` | `9f7c112ab79236aeef118d122414a6608f4e00a474ec243f10fbbef319302166` |
| `src/overlays/worldOverlayAllocation.worker.mjs` | `029241fc006be6f72bac1ca29695895c4408f91ea53e0ee3e71c5d80d8d60e60` |
| `src/performance/cpuTimings.js` | `f6282d0f1eca59760622e852448d9481d83a7005ab1febc9a7cf784c3108027c` |
| `src/performance/performanceSnapshot.js` | `13067eda7083cdb9e2f63c27bd7857fd42260cabb8b07cea081ddcb9fc6e022e` |
| `scripts/performance/soakStability.mjs` | `fdbb5916fa17eb54f927e0c868f4da6d8e2199fb37fd9148b8945dfffed2877c` |
| `scripts/performance/cctvLifecycle.mjs` | `6af2b7c3fe8919fcaa0a15952054513b366e74af0d6821d17879e448f166c896` |
| `scripts/qa-mixed-use-soak.test.mjs` | `ce9db2e993d403d07ad1b2afc8d3cab13a75e0ae76d7befe1792ff8dab69387a` |

## Engineering behavior present

The diagnostic instrumentation is bounded and opt-in. `PerformanceSnapshot`
retains at most 120 named samples and 32 owner entries; it emits completed
frame intervals as wall-time samples, not GPU execution measurements. The
snapshot explicitly emits `gpuExecutionMs: null`. Renderer/vendor identity may
also be unavailable and is represented as null rather than fabricated. See
`src/performance/performanceSnapshot.js` and
`src/performance/performanceSnapshot.test.mjs`.

The overlay comparison has a separate disabled arm and checks source commit,
fixture digest, workload identity, frame/time boundaries, population identity,
and timing mode before calculating a ratio. It rejects mismatched fixture,
frame, and population mutations. Detection uses detection observation,
selection, and label-budget counts; world overlays use per-source painted
counts. Its metric is explicitly `synchronous-application-cpu` from a mock
canvas worker, not rendering or GPU time. See
`scripts/performance/overlayAttributionContract.mjs`,
`scripts/performance/overlayAttribution.test.mjs`, and
`scripts/run-unit-tests.mjs` (the focused harness suites are registered).

The ownership gauges now distinguish `entities` from `dataSources`. CCTV's
current report is versioned as v3, while v1/v2 remain explicitly legacy so
their historical `dataSources` alias is not silently reinterpreted.
Satellite-tracked entities are reported as entities, not data sources. Import
point counts are retained only with an allowed owner, `instances` units, and
the `owned-import-point-collection` coverage tag; unscoped/global counts are
discarded. The mixed-use soak checks declared ownership gauges for growth and
does not treat monotonic diagnostic counters as retained-resource gauges.
Relevant implementation/tests: commits `d430665c` (CCTV/satellite ownership),
`2652f5b6` (snapshot import diagnostics), `3a515bf9` (CCTV schema semantics),
`3d2d8ce7` (soak entity/point retention), and `7f72cb28` (strict coverage),
with tests in `scripts/performance/cctvLifecycle.test.mjs`,
`src/performance/performanceSnapshot.test.mjs`, and
`scripts/qa-mixed-use-soak.test.mjs`.

## Owner inventory at the reviewed source revision

The paths below are pinned to `9e0109f1d1720712fedb7e9249d9992d418198d4`.
This inventory records the implemented observation surface; it does not imply
that every engine object, browser listener, or rendered pass is counted.

| Production owner (source SHA-256 at `9e0109f1`) | Reported fields or hook | What that observation means | Boundary |
| --- | --- | --- | --- |
| World overlay, `src/overlays/worldOverlay.js` (`a938f3acdfb56ba7801e76c7449c934d2b5c232ae375590aef47c405b29f2582`) | `getWorldOverlayDiagnostics()`: candidate/projected/selected/fading/painted counts, `paintedBySource`, pool sizes; opt-in `overlay:frame`, `overlay:projection`, `overlay:placement`, and `overlay:paint` CPU spans | Work and synchronous stage time in the JavaScript overlay path | The matched comparison runs a deterministic mock-canvas worker; painted means the overlay code issued its paint path, not that the browser/GPU completed pixels. |
| Detection workload, read by `src/overlays/worldOverlayAllocation.worker.mjs` (`029241fc006be6f72bac1ca29695895c4408f91ea53e0ee3e71c5d80d8d60e60`) | Profile/density, observations, candidates, visible/selected counts, label budget, solve revision | Population and selection witnesses around the paired CPU arm | These are workload counters; there is no separate detection-only stage timer in this packet. |
| CCTV, `src/layers/cctv/controls.js` (`ed527cfd286100cabff0d9e22a082a20c26f5a0f564531e1978503734cb7768c`) and `src/layers/cctv/geometryQueue.js` (`a58bec28903c03aafcce4243d05e4ad09fa590fc787dca8b3238fba68132d446`) | `getPerformanceDiagnostics()`: listeners, timers, pending jobs, primitives, entities, cache entries; opt-in `cctv:geometry-prepare` span | Retained owner counts and synchronous per-record geometry preparation | Does not measure worker execution, GPU upload, or all page listeners. |
| Satellite layer, `src/layers/satellites/lifecycle.js` (`7b38cf5e6fbee4c5a90a0e8dff7005ba92ff3ad5b2ba07d2a3aad01b72729a75`) | `getPerformanceDiagnostics()`: listeners, pending jobs, primitives, tracked entities, cache entries | Retained layer-owned resources at a snapshot boundary | No satellite-specific CPU span is emitted here; ownership counts do not establish per-frame mutation cost. |
| Layer update dispatch, `src/data/lifecycle.js` (`22db1972b596076be89d8e0207e65b5419c8d96c7dac7a081337e489b02be42e`) | Opt-in `<layer-id>:update-sync` CPU span around synchronous `module.update()` | Synchronous duration of the update call only | Promise waiting and later asynchronous work are excluded. |
| Application snapshot, `src/app/tools.js` (`97facae56bc1c2fcede674f1f07a0ca6273ca00fb093eb2f6ba6ed231902e908`) and `src/performance/performanceSnapshot.js` (`13067eda7083cdb9e2f63c27bd7857fd42260cabb8b07cea081ddcb9fc6e022e`) | `applicationCpu`, overlay projection/placement/paint values; bounded resources and completed-frame interval samples | App-visible stage/resource snapshot and wall time between completed frames | `gpuExecutionMs` is explicitly null; frame intervals can include intentional demand-render idle time. |

The app snapshot assembles registered module diagnostics from the data-layer
map plus map/import owners. It is not a browser-wide listener census: shared
Cesium internals, unrelated DOM listeners, and engine/GPU allocations are not
claimed as counted resources.

## What the matched CPU report says

All four workloads have five pairs, 600 measured frames per arm, matching
frame/time endpoints, and equal start/end population witnesses within each
pair. Median enabled/disabled CPU ratios were:

| Workload | Entries | Median ratio | Individual-pair range |
| --- | ---: | ---: | ---: |
| Generic overlay | 250 | +2.89% | -8.49% to +43.94% |
| Local infrastructure | 320 | +7.08% | -10.63% to +35.12% |
| All-live radio | 864 | +1.28% | -6.26% to +5.20% |
| Dense detection | 5,000 | -2.77% | -21.30% to +32.02% |

This corrects the earlier unmatched run described in
`docs/performance-evidence/s48-overhead-audit-20261014/README.md`: that older
run advanced its route/time across arms, had unequal radio paint populations,
and used overlay counters for detection. The old raw failure remains useful as
a negative control, not as the current comparison.

The matched sample has wide within-workload variation, including both positive
and negative pair results. No workload median exceeds 10%, but this is one
capture and the spread means it cannot establish whether any regression is
repeatable or provide a dependable overhead percentage. It also does not measure
browser painting, WebGL work, driver time, GPU time, or end-to-end workload
latency. Do not call it a speedup, negligible overhead, or hardware result.

## Remaining S48 evidence

No new runtime implementation gap was found in the reviewed S48 diagnostics:
the bounded samples, declared metric scopes, disabled timing arm, mismatch
controls, owner coverage tags, resource growth gate, and unavailable GPU value
are present in source and focused tests.

The remaining gap is evidence, not a discovered runtime defect: the acceptance
row's “leading measured costs for each relevant workload” still needs a
production-browser diagnostic that attributes application CPU/render work for
the declared workloads while keeping latency captures separate. The current
report supplies a controlled CPU-instrumentation comparison only; it cannot
identify leading costs of rendered frames. GPU execution timing must remain
unavailable unless a supported measured source is introduced. The final
browser/hardware matrix and any repeated overhead conclusion remain pending.

This note does not close S48 or change any historical result. A reviewer should
decide whether the engineering row can close with this limitation explicitly
recorded, or whether the production-browser leading-cost diagnostic is a
prerequisite for that closure.
