# S47 probe disposal and warmup render boundary

[Original CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38172276737). Original artifact bytes are preserved in [performance-build-smoke.json](performance-build-smoke.json); SHA-256: `00c96d37b85838adc0d829c9eca1ba4f03d53ff821c0b6bf7a65531bcc18be2f`.

The original run failed before its first measured sample: the host did not observe a completed warmup render within the existing 5-second page deadline (6-second host envelope). Both probe pages were destroyed successfully and the early-probe cleanup rows are true. Worker audit read/restore and validation complete; this is no longer a probe-cleanup or worker-count failure. Startup observer reads took 1.3 ms; early renderer identification took 3.6 ms. These are diagnostic costs, not a scene-performance pass.

Follow-up abb5c3d5 adds opt-in bounded entry/update/preRender/completion events to distinguish queued evaluation from a blocked scene update or draw. The 5-second render deadline, 180-second child limit, 7,578-object workload and visual settings are unchanged. Forty-nine focused checks pass. Exact-revision run 38173113264 is pending.

This diagnostic is not full S47/S59/S60 acceptance or physical Windows evidence. Failed reports remain failed.
