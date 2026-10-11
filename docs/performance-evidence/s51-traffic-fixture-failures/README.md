# Traffic fixture failures

These failed hosted runs are retained without converting them into passes.

- [38119550844](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38119550844), harness bbe6161: an undeclared cleanup callback masked the setup error. The outer renderer assertion then misreported the missing capture as unverified acceleration. No comparison completed.
- [38119931432](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38119931432), harness 81b1b08: corrected teardown and validation order preserve the actual error, Local fixture tiles did not settle. No traffic source call or capture occurred. The report does not contain sufficient tile readiness diagnostics to attribute that timeout.

Both runs confirmed browser, page, server and temporary-fixture cleanup. Both use baseline e6ab561 and hosted Apple paravirtual Metal; neither establishes traffic behavior, performance improvement, or physical Windows coverage. Raw reports and their SHA-256 digests are retained in manifest.json.

The subsequent harness revision adds bounded readiness diagnostics without relaxing the readiness gate or timeout. It also fixes the heatline-control parameter ordering and independently rejects residual heatline geometry, changed control clocks, and retained scene primitives. These are measurement integrity changes; runtime traffic acceptance remains pending.

The diagnostic run [38120492292](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38120492292) at da493e8 also failed, now with both readiness getters true, 26 completed renders, no selected tile content, and no load/render failures. Source inspection identifies the fixture error: the top-level tileset geometricError was zero. Cesium 1.138 BaseTraversal compares the root's parent screen-space error (derived from the tileset's top-level value) to the allowed error and skips the entire tree at zero. The corrected fixture declares the missing 5.2 km plane's extent as the top-level error and keeps the full-detail leaf error at zero. The renderer's error threshold and timeout are unchanged. A focused test exercises the actual Cesium screen-space-error calculation; a subsequent rendered result is still required.
