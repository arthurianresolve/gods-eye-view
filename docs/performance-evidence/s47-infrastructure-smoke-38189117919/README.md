# Infrastructure smoke: outer audit validation failure

[Run 38189117919](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38189117919) tested `f8469919a8e82460dc6774afc6e3ed4e336c564b`. The frozen-clock fix passes the previous fixture setup failure and the capture CLI completes four samples. The outer smoke validator then fails its minimum of six worker-blob audit records. The infrastructure workload has a different document topology from the dense fixture; its audit contract requires review rather than an unexplained lower threshold.

The current failure envelope preserves only a summary when a completed capture report fails outer validation. It discarded the raw capture report, so the actual audit count and samples cannot be independently checked here. Preserve bounded completed reports on this failure path as part of the repair. This remains a failed software-rendered smoke with no performance acceptance.
