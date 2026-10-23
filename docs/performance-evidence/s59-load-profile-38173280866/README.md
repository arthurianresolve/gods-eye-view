# S59 explicit trace mark rounding failure

[Original CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38173280866). The original artifact bytes are preserved in report.json.

The run retains a complete heap profile but reports incomplete attribution under its then-exact numeric comparison. The explicit page start 3101.5999999999767 ms and trace start 3101.599999999977 ms differ by one floating-point unit. Follow-up 552d1144 permits only two relative machine-epsilon units, capped at the declared 0.001 ms trace serialization bound, with negative controls for larger differences and missing timestamps.

The original report remains failed; its raw profile is not relabeled as accepted.
