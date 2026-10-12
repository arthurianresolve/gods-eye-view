# Cable terminal-settle repair: rendered validation still failed

[Run 38190313885](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38190313885) tested application/harness `392d2ebc1ab454476a55f0c656b07c080e9a713a`, including the exact terminal stem update and bounded follow-up frame. Twenty-one local cable tests pass, but this rendered run stops before collecting samples, at map-stack-terrain-restore. The final-pose repair has no successful rendered validation yet.

The read-only Cesium 1.138.0 diagnostic observes 1,913 geometry instances: CREATING at the first frame, COMBINING through 9,746.5 ms, then ready at 12,204.5 ms. The last checkpoint is after the existing 12-second deadline and has no stable-frame evidence. It remains a failure. The transition proves work progressed in this run; it does not establish a permanently stuck worker or listener. Earlier readiness failures retain their own more limited observations.

There are 232 observations with the first/latest eight retained. Browser close completes normally in 812 ms without forced termination. The next investigation should attribute classification-change geometry rebuild cost; do not extend the deadline or rerun unchanged code to obtain a pass. This hosted Apple paravirtual Metal result is not Windows hardware or performance acceptance.
