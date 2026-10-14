# Map-switch comparison report failure - 12 October 2026

Candidate `3453fab5a414030681d33682ae6594c002ef159f` extends the existing
terrain/picking fixture with five counterbalanced switch pairs, four separately
reported setup transitions, stage timings, provider/request counters and a
current-frame DataSourceDisplay update witness. The witness uses the update
Cesium already performs; it adds no extra update call. Root passed 43 focused
checks before the [exact-commit hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38225231367).

The run **fails report validation** with `Counterbalanced map-switch evidence is
incomplete`. Its raw observations contain all ten measured transitions, all four
setup transitions, three successful native re-enable picks, stale-provider
rejection and successful owned cleanup. The accepted report gate still fails;
these reached stages do not convert the run into a pass.

Source review identifies two producer defects:

1. The report omits the top-level `ownershipChanged` and
   `entityCollectionsMatch` values required by the validator.
2. After the comparison observer is disposed, later selection cases intentionally
   replace data-source collections. The fixture's final cleanup overwrites the
   comparison snapshot by querying these later collections. The retired
   observer's final report therefore says `entityCollectionsMatch: false` even
   though all recorded comparison frames have unchanged ownership revisions.

The repair at `0c221261d78b7a4fc235b026ee5c37ce8c4f1a37` freezes the observer's
snapshot at first disposal and uses one publisher for both report boundaries.
It publishes the required ownership fields. Tests cover subsequent intentional
replacement, a real ownership failure before disposal, mutation of returned
snapshots, and the actual publisher feeding the unchanged report validator.
All 46 focused tests, the 1,557-file formatter and package boundaries pass.
A new rendered run is required; this failed artifact stays unchanged.

The failed run's switch observations show four cached providers and four factory
loads throughout the measured pairs, with zero pending map or worker jobs after
each ready boundary. Whole-switch times include the one-second stable window and
diagnostic snapshots: 1,874.8-1,964.7 ms for flat and 2,612.8-3,081.4 ms for relief.
They are instrumented component observations, not activation-performance claims.
Map/cable-owned counts return to zero, and Chrome exits naturally.

The renderer is hosted Apple paravirtual Metal. This fixture uses same-origin
imagery and a custom heightmap; it does not load streamed 3D Tiles. Streamed tile
memory remains explicitly unavailable. Physical Windows, live-provider and full
S57 acceptance remain outstanding.

- [Unmodified raw report](report.json): 3,245,716 bytes, SHA-256
  `a3581a42bea0be72718e03bd866882fd844b42a3a010722d964668027e2f847e`.
- [Terminal workflow metadata](ci-run.json).
