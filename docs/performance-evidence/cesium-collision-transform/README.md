# Cesium camera collision transform correction

Accepted component at f26f4dd738a518c6cefa96b5f809c5d9c53afa83, based on e6ab561. The change avoids world/local camera transform round trips when a tracked 3D camera requires no terrain correction. A needed height correction continues through the original path. Scene modes, terrain detail, camera ownership and visual settings are preserved. This branch contains no fleet scheduling experiment.

The actual controller regression covers all five distributed implementations. Eight stationary updates make 16 transform switches in the old code and zero in the corrected code; stationary pose remains exact. Real terrain correction, minimum distance, height smoothing, manual movement, 2D and Columbus View controls remain exact. The version/hash-bound applier, installation recovery and staged releases carry the same patch.

[Full CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38119958881) passes all seven ordinary jobs: Node 24/26 suites and builds, Windows onboarding, Windows/macOS/Linux recovery, and browser journeys. [Tracking](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38119960860) passes 111/111 at the same clean source revision, with no console or HTTP 5xx errors and normal browser shutdown. Raw results, log and source identity are preserved here with hashes in acceptance.json.

This accepts the isolated correctness fix. It does not establish a physical Windows frame-delivery fix, a performance target, full-scene pixel equivalence, or completed S47-S60 acceptance. Skipped PR-only layer-token checks and optional soaks remain unvalidated.
