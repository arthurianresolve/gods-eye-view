# Standard datacenter correctness gate

[Hosted run 38218238754](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38218238754)
passes at application and harness commit
`5ba9a9408017771a2c91cb4b1f93610a6c73a1d6`, using the ordinary
`infrastructure-datacenters` workflow option, with no diagnostic flag.

The runtime fixture now requires the successful current-update witness proven
by the [preceding diagnostic](../s54-current-update-readiness-38216619573/README.md).
Unavailable observation fails closed. The eight-second settling and 400-ms
capture deadlines remain unchanged. Detailed readiness records are still opt-in;
the older explicit pick-path and primitive diagnostics retain their metadata.
This is a fixture correction, with no production rendering change.

Root independently passes 70 focused tests. The complete hosted report passes
the ordinary runtime validator without diagnostic permissions. All ten paired
PNG files are byte-identical, and every pair has matching source identity,
geometry, style, camera and clock, with verified native point and stem owners.
Both modes preserve all 4,362 datacenter surfaces.

Both layer lifetimes remove their renderer owners and data sources and restore
the observer. The viewer is destroyed. Chrome exits naturally with code zero
after 310.8 ms; browser close completes after 348.3 ms without forced termination.
The environment is Apple paravirtual Metal and HeadlessChrome 152, at 1200 by 960
viewport, DPR 1 and 960 by 640 drawing buffer.

This closes the current hosted component correctness gate. The datacenter
candidate remains isolated pending the broader rollout requirements; it does not
establish physical Windows performance, a mixed-layer comparison or final retention.
Production still uses Entity rendering by default.

The [raw report](report.json) is 547,243 bytes, SHA-256
`b05caa877a3ea667a5da8377aa409ef2b05d89debd89e9f6d93c0da30c13c7d1`.
[Independent review](review.json) and [CI metadata](ci-run.json) preserve the result.
