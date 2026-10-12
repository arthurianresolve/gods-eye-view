# S57 streamed tiles: ownership publication and hosted gate pass

The [exact-commit run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38236552746)
passes at `e1a6f5e4bc58aeb30b69ed611deebf221f7695c9`. Root independently
replayed the unchanged validator against the downloaded report, verified fixture
asset hashes and source identity, and checked all ten measured switch records.
The checkout is clean at both observation boundaries.

GPT-6 Luna's correction publishes the active controller ID in each generic
scene-readiness sample. It preserves the existing strict owner predicate. All
eight flat readiness records now identify `qa-terrain-flat` during their own
observation, with loaded terrain and zero pending workers. Producer-backed tests
cover owner changes and missing owners; root added absent/incorrect owner
rejection cases and removed the displaced unused signature helper. Twenty-two
focused checks, full formatting (1,562 files), package boundaries, and the three
changed-path follow-up checks pass. The previous missing-field report remains
[failed historical evidence](../s57-tiles-cancellation-recovery-38235132582/README.md).

The complete fixture also passes five terrain cycles, three native selection and
re-enable checks, and five counterbalanced streamed-tile pairs. The first content
request is canceled with `ERR_ABORTED` and `canceled: true` after flat terrain
takes ownership; it never reaches the server. Reactivation successfully delivers
the GLB. Browser and server observations agree on one manifest and one successful
content response, with no additional deliveries during warmed switching.

All ten measured switches retain seven controller cache entries, one owned
tileset, seven total provider loads, zero pending jobs and zero provider failures.
The fixture preserves maximum screen-space error 16 and dynamic screen-space
error. Cesium reports a stable 108 bytes of tile content memory for the tiny GLB;
this is not total GPU or process memory. All four tile observers are removed.
Controller destruction releases the tileset and leaves zero owned map primitives,
imagery layers or cache entries. The viewer, network/server observers and server
are released; Chrome exits naturally in 441.868 ms without forced termination.

- [Original report](report.json): 3,896,343 bytes, SHA-256
  `6b6291c5feaf5c86eda6ef3832a304d31effba03c3914938660e2fa583e3ad0d`.
- [Independent review](review.json) and [terminal workflow metadata](ci-run.json).
- Environment: free hosted macOS 26 / virtual Apple M1, Chrome 152.0.7977.75,
  Node 24.14.0, verified Apple paravirtual Metal.

This closes the local HTTP streamed-tile lifecycle component. It does not establish
physical Windows performance, a matched route-time improvement, whole-application
retention, or full S57/S60 acceptance. The source and dependency defaults are
unchanged; this packet adds validation infrastructure and fixes its reporting.

Integrated on `dev` at `48329a9f33ce0e2d8586da90540f7e2331434b8f`. All seven
[standard CI jobs](standard-ci-dev-38237151400.json) pass, including Node 24/26
suites/builds, Windows onboarding, all three real-profile recovery jobs and the
complete browser journey gate. The integration retains the exact tested scripts,
fixture assets and source of the isolated S57 packet; only documentation differs.
