# Retired map-comparison observer - 12 October 2026

At `0c221261d78b7a4fc235b026ee5c37ce8c4f1a37`, the rendered fixture and its
unchanged report validator **pass**. Root independently replayed the raw report
through `validateTerrainPickingLifecycleReport`. The [workflow](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38226108308)
is nevertheless **failed**: the subsequent log printer refuses reports over its
existing 2 MiB limit. Artifact upload succeeds. This distinction is retained;
the failed workflow is not relabeled successful.

The comparison contains ten measured switches in five counterbalanced pairs and
four setup switches. Its current-update observer records 14 generations and 870
completed frames, unchanged collection ownership and matching collection
identities at retirement. All three re-enable native picks, stale-provider
replacement, late-provider disposal and owned cleanup pass. The browser exits
naturally; no external requests or page errors occur. Root's focused suite passes
46 checks, including an actual observer publisher feeding the report validator.

The source fix preserves the observation epoch at first disposal. Later selection
tests intentionally replace collections, but final cleanup no longer substitutes
that later state for the already-retired comparison. A failure before disposal
remains recorded as a failure. The original
[producer-defect report](../s57-stream-comparison-38225231367/README.md) stays intact.

The separate CI correction at `14f903cb640fca11d30ba87da9210f33a7a0ba9e`
prints only the raw artifact's path, byte count and incremental SHA-256. It leaves
the full artifact upload and the existing payload log limit unchanged. Its output
explicitly carries no inferred validation status. Forty-seven focused tests pass,
including a large failed report, bounded identity output, unchanged source bytes
and continued rejection by the default payload logger. A fresh exact-commit
workflow check follows; it does not rerun unchanged failing code.

This is local imagery/heightmap ownership evidence on hosted Apple paravirtual
Metal, not physical Windows, streamed 3D Tiles or full S57 acceptance.

- [Raw rendered report](report.json): 3,246,168 bytes, SHA-256
  `a5efadcdfc50565dc9d8be6dd838782470ef2ce92581322817c4300f53a38244`.
- [Terminal workflow metadata](ci-run.json), including the failed log step.
