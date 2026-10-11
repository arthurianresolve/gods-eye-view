# Conditional paint-cache trial: rejected

The conditional shared-canvas paint cache was not promoted to `dev`.
The frozen candidate passes 72 focused overlay checks but fails one of the
13 unchanged allocation gates. Its mixed infrastructure, FIRMS, ambient-vessel
and tracked-readout workload measures **72,201 bytes/frame**, or **160.1 bytes
per candidate/frame**, against the existing **154-byte** limit. The workload
contains 451 candidates and paints 304. The other twelve gates pass.

Production commit `38f8d70ce087939fa6d4b57a5c8257c5d6b84293` retains the accepted
projection, layout and placement improvements. Neither the paint-cache runtime
nor its keyhole tuning API changes were installed in production.

All seven ordinary integration jobs pass on that unchanged production commit
([GitHub run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38106226841),
[archived job results](production-dev-38f8d70-ci.json)): Node 24/26, Windows
onboarding, Windows/Linux/macOS recovery and the browser journeys. This validates
production, not the rejected candidate. PR-only layer-token checks and optional
soak/diagnostic jobs were skipped and are not counted as passes.

## Evidence

- [Independent review](review.json) checks source and dependency hashes,
  all ten paired worker logs, reported populations, alternating order,
  allocation summaries and nonempty TAP counts.
- [Full allocation result](allocation.tap.txt): 12 pass, one fail, zero skips.
- [Focused behavior result](focused.tap.txt): 72 pass, zero failures or skips.
- [Five paired rocket controls](rocket-pairs.json) compare two unpublished
  prototypes. Median allocation changes from 6,009.67 to 5,992.67 bytes/frame.
  The median paired change is -0.283%; one pair regresses 6.859% because its
  reference result is lower. This marginal threshold result is not a repeatable
  production performance improvement and does not override the full-suite failure.
- [Artifact hashes](artifact-hashes.json) bind byte-preserved raw logs, derived
  UTF-8 TAP files, both runtime/helper snapshots, the test/worker sources and
  comparison runner. Raw files with a UTF-16LE BOM are retained separately from
  their explicitly decoded copies.

The candidate renderer hash is
`00db6febc8dcde6e0c886f3d73a96223a41817d98eba19a90f8d283e6049ff2e`;
its keyhole helper hash is
`604138eaff77a3b5de9738e9279bfbb5afd68b0e1eb1d0836faa78d51adaff23`.
These are Node 24.16.0 allocation and behavior measurements on Windows. They
are not native pixel comparisons, frame-latency measurements, GPU evidence or
full-scene acceptance. No budget was relaxed and no failing result was discarded.

Further permutations of this cache design are stopped. This follows the plan's
requirement to record rejected experiments without adding unnecessary runtime
changes. S52's full-scene and hardware requirements remain open.
