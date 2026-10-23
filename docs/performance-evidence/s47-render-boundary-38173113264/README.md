# S47 interception failure before frame diagnostics

[Original CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173113264). The original artifact bytes are preserved in performance-build-smoke.json.

The run fails before its first measured sample at fixture-delivery validation. Its error count was retained but the protocol cause was not, so no warmup-frame attribution can be inferred. Follow-up d081a114 retains bounded command, stage and capture-phase details. No deadline or fixture change is made.

This failed diagnostic is not performance acceptance.
