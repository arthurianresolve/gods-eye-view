# Expanded paint fixture baseline control

[Hosted run 38105611121](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38105611121)
passes five alternating pairs at exact application and harness commit
`61606d0fcc1ea1ff47e761aa610424149b4b5449`. Both sides use the same production
renderer; this validates fixture repeatability, not an optimization.

All **44 cases and 880 PNGs** were independently checked. The review decodes
every PNG, verifies drawing-buffer dimensions, pixel hashes and alpha totals,
and compares the full recorded conditions, picks and accessible actions within
and across all five pairs. Source, lockfile, harness and fixture hashes match
the immutable commit. Cleanup completes without source changes.

Six new cases cover consecutive low-opacity frames, visible recovery, a stable
visible frame, returning to low opacity and another stable invisible frame.
Only the registered source's opacity callback changes; the source population is
retained. Existing font, DPR, resize, occlusion, selection, fade and custom
painter cases remain. The font test preserves its measured 283-to-299 px change.

`report.json` contains the raw report; `review.json` records independent checks;
`run.json` records terminal job status. [images.zip](images.zip) contains all
880 original PNG files. `artifact-hashes.json` binds these artifacts.

This is Canvas2D component evidence with a mock Cesium viewer on hosted Linux.
It establishes no Windows GPU, full-scene, latency or retention result.
