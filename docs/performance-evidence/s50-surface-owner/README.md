# S50 rendered-surface ownership correction

QA commits bacc54a8 and 0258bdf2 key mesh-floor samples by actual tileset identity, suspend mesh reads through switching, and propagate settled owners for silent activation and failed recovery. CCTV invalidates mesh-derived values while preserving independent Re:Earth DEM and shipped footprint data. Pending obstruction probes wait for ready tiles and are cancelled by deactivation or manual range changes. Production promotion is pending integrated standard CI.

Local focused validation covers same-owner reuse, different-owner invalidation, stale asynchronous footprints, hidden/replaced tilesets, silent switches, error recovery, polling during switching, and manual/deactivation ownership. The initial suite passes 133 checks; the follow-up passes 58. Package boundaries and formatting pass.

At exact clean application/harness `0258bdf203f5c57d2771b6197dabd0743d1c7b87`:

- [CCTV lifecycle run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173642436) passes five cycles, direct reinitialization and rapid geometry revisions. Each enabled checkpoint retains 6 listeners, 2 timers, and zero jobs; each disabled checkpoint retains 5 listeners, zero timers/jobs. Geometry submissions remain 10 across all five unchanged toggles. Browser shutdown is natural in 72.2 ms. Original report: [cctv-lifecycle.json](cctv/cctv-lifecycle.json).
- [Terrain/picking run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173646675) passes five cycles, 162 local terrain tile requests, 171 completed of 171 submitted transition workers, and three selection re-enable picks. Browser shutdown is natural in 715.5 ms. Original report: [terrain-picking-lifecycle.json](terrain/terrain-picking-lifecycle.json).

Both original reports were independently revalidated using their exact-revision validators and expected fixture identities. These are software-rendered lifecycle checks. They do not establish physical GPU performance, a live photoreal-provider visual comparison, or completion of every S50 criterion.
