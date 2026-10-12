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
Physical Windows coverage, mixed-layer behavior, motion p95 and long-run
retention remain pending. Datacenter activation/heap results at the subsequent
diagnostic-only revision are recorded below; dam and cable benefit acceptance
remain open. The GPU
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

The changed [readiness diagnostic run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38187344922)
at `d05e5415c3fc9d299a16349ba66355ddbcdb92cf` also fails. It retains 239
observations (a bounded eight-record first/latest trace) during
`map-stack-photoreal`. Frames progress from 27 to 265; DataSourceDisplay and
globe readiness remain true. One hidden `GroundPolylinePrimitive` remains
unready at every retained checkpoint through 11,997 ms. The original 12-second
deadline and the requirement to finish hidden replacement geometry are intact.
The underlying build/worker cause remains unresolved. Raw evidence and the
independently checked predicate summary are in `cables-readiness-failed/`.
Twenty-three focused diagnostic/camera/deadline/report checks and package
boundaries pass for this diagnostic change; this is not a cable acceptance pass.

The [standard integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38186604801)
passes all seven jobs at `bc892f7c`: Node 24/26 suites and production builds,
Windows onboarding, install/update recovery on Windows/macOS/Linux, and the
browser journeys. The saved `s54-ci-bc892f7c.json` retains step outcomes.
Optional diagnostics/soak and PR-only published layer-token checks were skipped.
This success does not override the separately failed cable probe, and does not
claim full integration validation of the later diagnostics-only `d05e5415`.

The [datacenter benefit run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38187703722)
passes at `d05e5415`. Five alternating latency pairs use fresh viewers without
forced GC. Five separate memory pairs use forced-GC JavaScript heap samples.
Root reran the exact-commit report validator, checked all 27 recorded source
files against Git bytes, and independently decoded all 40 PNGs. Their dimensions,
file and RGBA hashes match; all 20 renderer image pairs are identical.
The full artifact and review are preserved in `datacenters-benefit/`.

| Metric (median of five runs per mode) | Entities | Collections | Change |
| --- | ---: | ---: | ---: |
| Source ready | 333.7 ms | 297.5 ms | -10.85% |
| First usable frame after source ready | 3,277.9 ms | 2,339.4 ms | -28.63% |
| Enabled post-GC JS heap increase | 163,935,120 bytes | 137,603,476 bytes | -16.06% |

All five latency pairs improve first-usable delivery. The heap result is a
JavaScript heap proxy, excluding GPU, native Cesium and browser-process memory.
Layer/viewer cleanup passes the recorded ownership checks, but these fresh-viewer
samples do not establish a long-run retained-heap plateau. The renderer remains
hosted Apple paravirtual Metal; there is no physical Windows performance claim.
Entity rendering remains the default and S54 remains partial.

The automatic [dev push CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38187169259)
also passes all seven standard jobs at `bbca229f`. Its full job/step outcomes
are retained in `dev-push-ci-bbca229f.json`; optional hardware/soak and PR-only
published layer-token checks remain skipped.
