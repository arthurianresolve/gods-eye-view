# S57 streamed cancellation/recovery: missing readiness owner field

The [exact-commit run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38235132582)
at `ae477251bede61945992030cd9d43bf7a6e70a0c` **fails final report validation**.
The browser fixture completes five terrain cycles, native selection/recovery,
and all five counterbalanced streamed-tile pairs. Its local component status
is `passed`; the overall report and workflow remain failed.

This run establishes actual cancellation and subsequent delivery. Chrome records
`ERR_ABORTED` with `canceled: true` for the first GLB request while flat terrain
owns the scene and the cached tileset is hidden. That request never reaches the
HTTP server. Reactivation issues a second request and both browser and server
confirm one successful content delivery. One manifest is fetched. No additional
requests occur during the warmed switches. The manifest and GLB hashes agree
with the frozen fixture assets.

Root traced the validator failure to its flat-readiness owner check. The generic
terrain readiness producer does not publish `final.activeStackId`; the streamed
tiles readiness producer does. The validator requires that field for both, while
its synthetic unit data supplied the absent field. All eight flat readiness
records have loaded terrain and zero pending workers, and their separate
after-switch observations identify `qa-terrain-flat`. Those observations do not
retroactively fill the missing required field or make this report pass.

The correction must publish the actual owner during readiness observation and
test the real producer/consumer contract, preserving the existing owner check.
This is a QA contract defect, not an observed map-controller failure. The
previous failure and this run remain immutable; a corrected revision needs its
own complete hosted gate.

Across the streamed portion, the controller retains seven provider-cache entries
and one owned tileset, with seven total provider loads and no provider failures
or pending jobs at ready checkpoints. Cesium reports 108 bytes of tile content
memory for the tiny local GLB; that is not process or total GPU memory. Effective
detail settings remain unchanged. All four tile-event observers are removed;
network/server observers, the tileset, browser and server are cleaned up. Chrome
exits naturally in 418.722 ms.

- [Original report](report.json): 4,122,886 bytes, SHA-256
  `9f2e7d78a64b31c4a9afcee61a31f2c906b2feb7fcdf3174372c54e38cd6d69c`.
- [Independent review and missing-field inventory](review.json).
- [Terminal workflow metadata](ci-run.json).

The 21 focused tests passed before dispatch, including the corrected real
network observer publication. They did not cover the generic terrain readiness
publisher's missing field. Hosted Apple paravirtual Metal is supplemental;
physical Windows, matched route timings, and full S57 acceptance remain pending.
