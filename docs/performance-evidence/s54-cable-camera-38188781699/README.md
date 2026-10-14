# Cable camera convergence failure

[Run 38188781699](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38188781699) tested application and harness commit `eea44e5768bd75e9f6f5b1d35251cafeb4551a30`. Both rendered lifetimes completed readiness, selection, disable/re-enable and teardown. This does not resolve the earlier intermittent map-stack readiness failure.

Independent PNG decoding verified all 20 recorded RGBA hashes at 960 by 640. All five default-style pairs match exactly. All five camera-change pairs differ by 50 pixels; final camera, style and source identities match, but geometry and overlay hashes differ. The gate correctly failed. Full raw images remain embedded in report.json; representative decoded images are included for review.

The source-level investigation reproduces threshold-dependent final stem positions after different camera paths. A correction and new rendered comparison are required before accepting the candidate. Entity rendering remains the default.

The renderer is GitHub's hosted Apple paravirtual Metal device. These results establish neither physical Windows coverage nor a performance benefit or retention-soak pass.
