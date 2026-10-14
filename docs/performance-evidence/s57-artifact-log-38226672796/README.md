# Map-switch component validation - 12 October 2026

The exact-commit [workflow](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38226672796)
**passes** at `14f903cb640fca11d30ba87da9210f33a7a0ba9e`. The rendered fixture,
unchanged validator, bounded log output and full artifact upload all succeed.
Root independently replayed the downloaded report through the validator, checked
the application revision, recomputed all ten switch timing bounds, and verified
provider-load/cache and pending-job observations. The log's SHA-256 and byte count
match the downloaded file. No earlier failed workflow is relabeled.

The fixture completes five counterbalanced pairs, four separate setup switches,
three native selection/re-enable cycles, stale-provider replacement, late-provider
disposal and natural browser shutdown. Four provider cache entries remain stable
through every measured ready checkpoint, with unchanged factory-load totals and
zero pending map/worker jobs. Fourteen current-update generations and 854 completed
frames preserve collection identities and ownership revisions until observer
retirement. Cleanup restores the wrapped method and releases its listeners.

Instrumented median switch-to-settled times are 1,850.4 ms for flat and 3,223.5 ms
for relief. These include the stable-scene window and diagnostic snapshots; they
are not isolated activation latency, an A/B improvement, or hardware acceptance.
The host is Apple M1 (Virtual) with Apple paravirtual Metal, not physical macOS.
Actual streamed 3D Tiles, matched application measurements and physical Windows
remain outstanding. S57 stays partial.

The component is integrated into `dev` through `7192a52e`, `7b4952aa` and
`68ccdb92`; their production and harness bytes are checked against the tested
candidate separately. The following standard integration workflow is a separate
gate and must not inherit this isolated check's result.

- [Raw report](report.json): 3,344,990 bytes, SHA-256
  `59d4c47e061fbb26e560448275e0915b3add3fa075ab7ed69316ce72e5665676`.
- [Independent recomputation](review.json).
- [Terminal workflow metadata](ci-run.json).
- Preserved earlier [report-boundary failure](../s57-stream-comparison-38225231367/README.md)
  and [log-size failure after a passing fixture](../s57-observer-epoch-38226108308/README.md).
