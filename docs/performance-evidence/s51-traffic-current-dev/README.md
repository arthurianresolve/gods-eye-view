# Traffic render demand on the current development baseline

Candidate `bda6146d2c7f978e682421bd29a7c7f087b5a491` combines the traffic
render-demand change with development baseline
`4dfea32b4e63c0d28d22cd031e61e290e81f6f2a`, including the accepted Cesium
terrain-collision transform correction. Both sides use identical patched Cesium
1.138.0 source trees and distributions. No fleet scheduler change is included.

The [five-pair rendered comparison](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38123646848)
passes. Baseline enabled-empty rendering produced 237, 297, 240, 233 and 236 frames
over each ten-second observation; the candidate produced zero in all five.
Populated, retained fading dots, jam heatlines, high-altitude clear and renewed
arrival have identical pixels and controlled state across both sides and all
pairs. The disabled-heatline controls independently show 12,464 changed pixels
while preserving dot state. Images, raw reports and an independent verification
manifest are included here. All 60 PNGs were decoded and hashed independently;
the comparisons and heatline differences were recomputed after download.

The fixture normalizes only traffic-owned randomness at Vite serve time. It
records the original and served source hashes and uses the same adapter on both
sides. It does not mutate production or engine checkout files. This comparison
measures empty-state render demand and controlled visual correctness, not motion
latency. Renderer: Chrome 152, Apple paravirtual Metal on a hosted macOS runner.
This is supplemental accelerated evidence; physical Windows validation is pending.

The [tracking regression](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38123689950)
passes **111 checks, zero failures, zero skips**. The raw log confirms normal
browser shutdown in 647 ms without forced process termination. Exact revision
and job metadata are preserved with the log.

[Full integration run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38123641479)
passes all seven selected jobs at the same candidate: Node 24/26 suites and
production builds, Windows onboarding, real installation/profile recovery on
Windows/macOS/Linux, and the complete browser journey job. Exact step results are
in `run-38123641479.json`. The traffic component is accepted on this evidence.
PR-only published layer-token checks, full-application idle, motion targets and
full S51/S60 acceptance remain unproved by this component comparison.

The subsequent remote `dev` revision `8bf4d272761273b70e1709b2632d5ac1febf3ae2`
also passes all seven ordinary integration jobs in
[run 38124796369](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38124796369).
The complete [step results](dev-8bf4d27-ci.json) are preserved. This revision adds
the evidence record without changing runtime, harness, workflow or package files
from the tested implementation above. PR-only and optional diagnostic jobs remain
skipped; this does not replace the outstanding physical hardware or soak evidence.
