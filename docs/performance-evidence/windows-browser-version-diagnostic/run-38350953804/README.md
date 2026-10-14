# Selected Chrome 155 recovery result

[Run 38350953804](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38350953804)
passes on exact candidate `2336337c8a1e8f76f7cbd0a900a41d1a284b19d0`, using
the free standard `windows-latest` runner and WebGL-only SwiftShader.

The installer verifies executable metadata as `155.0.8059.39`. Recovery
independently observes `Chrome/155.0.8059.39`, records the expected version and
confirms their match. All five recovery stages preserve settings, workspace
contents and the saved asset. Every browser exits naturally with code zero in
318-537 ms, inside the unchanged five-second gate. No process is forcibly
terminated. The checked source remains clean and unchanged throughout the run.

The [review](review.json) binds these observations to the [raw report](report.json):
14,750 bytes, SHA-256
`131898bc6772e7d0df406ee2899c5fbcf4d5e5858040f000d6e5cd2702d39b6c`.
The [terminal job result](ci-final.json) also confirms that the Windows
shutdown-control tests and exact-version installer passed before recovery.

This is one compatibility/recovery observation. The preceding Chrome 152 run
also passed all five stages, and historical 152 failures remain failures. These
runs do not establish that changing browser version fixes the intermittent
shutdown issue, isolate its cause, or provide physical GPU performance evidence.
The default browser version remains unchanged.
