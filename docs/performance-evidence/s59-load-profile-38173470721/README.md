# S59 complete heap and GC diagnostic

[Original CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173470721). The original artifact bytes are preserved in report.json. SHA-256: `adba009a25b8c4ebff9d50a7b4761848560120fab5299d086a409e5e381a27d4`. [Independent review](review.json) and its [reproduction script](review.mjs) verify the profile, trace and cleanup; run with the exact `552d1144` harness checkout as the script argument.

The exact clean application/harness 552d1144 diagnostic passes. It retains 167 nodes and 463 allocation samples for the 50,000-position LineString. Summed node selfSize is 7,825,824 estimated bytes; sample sizes independently sum to 7,828,108 bytes. These are distinct sampling observations, not an exact allocation count or retained heap. The instrumented load takes 24 ms, including 17.8 ms coordinate conversion. Allocation callsites concentrate in application position and Cesium Cartesian conversion.

The explicit-start User Timing mark agrees across page and trace within the declared serialization bound. Same-thread GC overlap is 5.601 ms and other-thread overlap is 3.133 ms; these are correlations, not additive execution times or causal proof. The trace has 182 normalized timing records and 26 flow records, completes without data loss, and has no omissions. Buffer telemetry remains unavailable.

Fresh capture, known geometry hash, native picking and source identities validate. Pages return to zero, browser exits naturally in 975.8 ms, and the server exits. This is hosted Apple paravirtual Metal evidence. It is not physical Windows, a speedup comparison, or a retention pass. No rejected geometry runtime prototype is promoted by this evidence.
