# S59 large-geometry CPU profile: incomplete trace

Frozen application/harness a6ff8485df2ffb997b8cc854ffa3c745ff29e194. The original report is preserved byte-for-byte in report.json.

The 50,000-position LineString load, matching known geometry identity, native pick and fresh capture complete. Page, browser and Vite shutdown are confirmed; browser closure is natural. The diagnostic fails because its trace collector observes two flow events (one start, one end) but does not retain their identities. The trace has 56 relevant records, zero omitted duration/marker records and low buffer use, but this does not establish complete flow accounting. Keep the original trace incomplete.

Instrumented load wall time is 59.7 ms and coordinate conversion records 28.8 ms. CPU sampling includes program/idle and control time; these observations are diagnostic hypotheses, not unprofiled latency or a regression comparison. GC overlap in the rejected report must not be used as complete causal attribution.

A separate producer/consumer bug checked a nonexistent top-level pixel digest; d6131adf changes validation to the emitted capture.pixelSha256 and adds a rejecting control for a forged top-level digest. Flow retention is under repair before another diagnostic. No chunking optimization is accepted.

[Hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38168887546).

Original report SHA-256: 6eb55b61c955c1d6bd6463e485d94534f71ed2b705a06c45aedfb8fc1c6ed5b0
