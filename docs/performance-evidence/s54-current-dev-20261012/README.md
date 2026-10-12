# S54 current-dev integration review

Candidate `bc892f7cb491c823bb8d7503cd036e5320f5c690` integrates the opt-in
infrastructure prototypes with `acc471e4afb4ff629244ec37caf2836b6aef89ef`.
Datacenters, dams and cable references retain Entity rendering by default.

The fresh [dam run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38186606842)
and [datacenter run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38186733917)
pass the exact-commit runtime report validators. Root independently decoded all
40 embedded PNGs, recomputed their RGBA hashes, and verified all 20 renderer
pairs byte for byte. The bundled payload hashes match this checkout. Native
point/stem picks, preserved geometry, population and evidence identities pass.
Both renderer lifetimes return to their warmed ownership baseline before the
viewer is destroyed.

Each layer has five correctness snapshots at the default pose and five at the
camera/LOD update pose. These are scoped component fixtures, not five alternating
latency trials or full-application visual coverage. Representative decoded
images are retained alongside each raw report and independent review.

The actual renderer is Apple paravirtual Metal on a standard GitHub-hosted Mac.
Physical Windows coverage, activation/heap benefit at this integrated commit,
mixed-layer behavior, motion p95 and long-run retention remain pending. The GPU
configuration export from the user's Windows machine does not satisfy these
acceptance requirements.

The [cable correctness run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38186850267)
fails in the existing Entity lifetime during the map-switch readiness witness,
before any collection sample or comparison. No page or fixture-interception
errors and no external requests were observed. The browser closes normally.
The raw failure and review are preserved in `cables-failed/`. That early wait
does not retain its readiness observations, so the exact unsatisfied condition
remains unresolved. This is not evidence of a collection-renderer regression
or an accepted cable result.

The [standard integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38186604801)
is still running. Its pending status is not a pass.
