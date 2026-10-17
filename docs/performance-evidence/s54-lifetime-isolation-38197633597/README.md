# Cable lifetime isolation: matching images, failed lifecycle

[Run 38197633597](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38197633597)
tests application and harness commit
`dc1f416c6bf9fd61333de7caefb477c36fe2311e`. The result is **failed**:
the Entity renderer times out at `reenable-scene-stability`, cycle 0.
The diagnostic now destroys each owned viewer before testing the next renderer,
so that failure no longer prevents observation of the collection candidate.
No rendering defaults or readiness deadlines changed.

The complete [raw report](report.json) is 1,406,975 bytes, SHA-256
`8e7204e345493954af70a02884fade86e16439672338428e6e285ecf44b1d377`.
[CI metadata](ci-run.json) binds it to the tested commit. The independent
[review](review.json) records the following results:

- All twenty embedded PNGs decode successfully, including CRC validation.
  Independently calculated RGBA hashes match the recorded hashes. All ten
  Entity/collection pairs are byte-identical: five default and five camera-change
  pairs, each 960 by 640 pixels. Representative images are retained here.
- Geometry, style, identity and native picking hashes match within this run.
  The coordinate witness reports 2,629 equal references, 35 visible and 2,594
  hidden. Full coordinate rows were discarded by the fixture after comparison;
  those coordinate counts and hashes cannot be independently recomputed from
  this artifact.
- After its ten captures, the Entity renderer delivers four observed re-enable
  frames, the last at 452.7 ms, then reaches the unchanged 12-second deadline.
  Pending owners include two primitives and a 1,913-instance ground-polyline
  build. This identifies the failed phase, not the cause of the stall.
  Layer teardown assertions are not reached. Owned viewer destruction is
  separately confirmed.
- The collection renderer completes its ten captures, both re-enable cycles,
  and cleanup assertions: zero remaining listeners, data sources and collections.
  Its owned viewer destruction is also confirmed.
- There are no recorded page or interception errors and no external requests.
  The browser closes naturally in 1,748 ms without forced process termination.

The runner is hosted macOS 26 / Darwin 25.6.0, Apple M1 (Virtual), three logical
CPUs and approximately 7 GiB RAM, using Apple paravirtual Metal. Acceleration is
verified; physical Windows or desktop macOS coverage is not established.

The earlier 114-pixel mismatch remains unexplained. These matching images do
not establish repeatability, performance benefit, a retention plateau, or a
passing lifecycle gate. Entity defaults remain in place. The next diagnostic
must attribute the re-enable stall and cross-run visual differences without
extending the deadline or treating a retry as remediation.
