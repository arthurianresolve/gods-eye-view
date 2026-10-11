# Traffic fixture failures

These failed hosted runs are retained without converting them into passes.

- [38119550844](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38119550844), harness bbe6161: an undeclared cleanup callback masked the setup error. The outer renderer assertion then misreported the missing capture as unverified acceleration. No comparison completed.
- [38119931432](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38119931432), harness 81b1b08: corrected teardown and validation order preserve the actual error, Local fixture tiles did not settle. No traffic source call or capture occurred. The report does not contain sufficient tile readiness diagnostics to attribute that timeout.

Both runs confirmed browser, page, server and temporary-fixture cleanup. Both use baseline e6ab561 and hosted Apple paravirtual Metal; neither establishes traffic behavior, performance improvement, or physical Windows coverage. Raw reports and their SHA-256 digests are retained in manifest.json.

The subsequent harness revision adds bounded readiness diagnostics without relaxing the readiness gate or timeout. It also fixes the heatline-control parameter ordering and independently rejects residual heatline geometry, changed control clocks, and retained scene primitives. These are measurement integrity changes; runtime traffic acceptance remains pending.
