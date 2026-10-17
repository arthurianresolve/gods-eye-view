# All seven standard integration jobs pass

[Run 38440035842](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38440035842)
passes at `fa0e8a492286cd2dc032d28220400f0f98c88a52`: Node 24/26 suites and
production builds, Windows onboarding, Windows/macOS/Linux recovery, and the
Street Level/application browser gate including rendered mixed-use smoke.
[Run metadata](run.json) preserves each step's result.

Root checks all fifteen retained profile-recovery records: settings and workspace
bundles match, pages are closed before browser shutdown, and browser closes
complete without forced termination. All use Chrome 152.0.7977.75 and software
rendering. An unspecified expected browser override remains null in
[the review](review.json). These are functional checks, not hardware performance.

The reviewed main merge, map recovery corrections and S50 metadata/retention fix
are present in this revision. Historical failed Windows prerequisites remain
failed with their cause unresolved; they are not failures of this new run.
The later S56 sampler cleanup requires its own affected validation and is not
covered retrospectively by this result. PR-only layer-token checks and the final
hardware matrix/sixty-minute soak are not established by this dispatch.

Original recovery artifacts are retained with their hashes in the review:
[Windows](windows-profile-recovery.json), [macOS](macos-profile-recovery.json),
[Linux](linux-profile-recovery.json).
