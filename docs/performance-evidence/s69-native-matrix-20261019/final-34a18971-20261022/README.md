# Final available-hardware qualification — 22 October 2026

This directory records the final qualification and delivery evidence for
application and harness commit `34a1897150adf1c03eac72e04b9a9ec37fb09ba8`.
The working tree and harness were clean and unchanged throughout acquisition.

## Windows hardware result

The final Ampfing mixed-use soak passed on Chrome 155.0.8059.85 using the
physical Intel UHD 620 through ANGLE D3D11. It ran for 3,623,837 ms
(60m23.837s), after two warmup cycles, and completed 251 measured cycles plus
13 retained-resource checkpoints. The native viewport was 1,280 × 537 CSS
pixels at DPR 2, with a 2,560 × 1,074 drawing buffer, resolution scale 1 and
maximum screen-space error 1.

Stability passed. Final-window retained heap grew 2.425431%, below the 5%
limit. The first and last equivalent checkpoints each retained 9 documents,
664 event listeners, zero pending workers, zero render holds and zero scheduled
updates. Data-source, entity, primitive and imagery-layer counts also matched.
The browser and native-window helper exited normally without forced
termination. All 534 disk-guard checks passed; free space started at
7,471,124,480 bytes and never fell below 6,838,329,344 bytes.

The raw soak SHA-256 is
`ad65db4833177770172961b238dd48ca1342bd709fc9af649b1d46e94359e37b`.
[`summary.json`](summary.json) contains the bounded facts used above. The raw
acquisition is retained in the local qualification store and in the
hash-verified VM105 evidence bundle. The independent review confirms the
recorded outcome, renderer and stability values, but its generic scope text
calls the input historical; the raw acquisition is therefore the primary
evidence for this run.

The soak used the exact clean source build served from VM105 through an SSH
loopback forward so that Web Crypto remained available on a trustworthy
origin. It did not run from the later downloaded release archive. Release
provenance and deployment were verified separately rather than relabeling the
soak as signed-package evidence.

## Signed release and VM105 recovery

The release workflow produced merge commit
`64fd4ea80a31927e070cd696cef8b877a7f038c0`, whose Git tree
`1599f0d13d853549482d3e32a1d4cc6dca0bd860` exactly matches `34a18971`.
The downloaded archive SHA-256 is
`20e9352806096d3ef2e9529646cd6ab1ed9f3dc62b394b4428cbecbfe0255511`.
Its sidecar checksum, GitHub artifact attestation, repository, workflow and all
2,129 release-manifest hashes passed verification. The verified release is
deployed on VM105 from
`/opt/gods-eye-view-releases/64fd4ea80a31927e070cd696cef8b877a7f038c0-verified`.

Public HTTPS served the exact deployed `dist/index.html` hash
`a59795afefa75d50336145ee3202dca90f6832749bd7327085a61222e807d46c`.
The public workspace journey passed save, duplicate, open, reload, conflict,
command-palette, GeoJSON-import, synthetic-demo and cross-tab checks. The
allowed public Host returned 200 and an unapproved Host returned 403.
Mapillary and TomTom status requests return the documented 403 behind the
reverse proxy; FIRMS and wind status return 200. This preserves the cost-bearing
same-site guard rather than weakening it for deployment.

The recovery drill atomically activated the previous verified release, observed
its exact public index hash, restored the candidate, and observed the exact
candidate hash again. The post-restore public workspace journey passed. See
[`vm105-rollback-restore-receipt.json`](vm105-rollback-restore-receipt.json) and
[`delivery-summary.json`](delivery-summary.json).

## Qualification boundary

The warmed local-control protocol-v5 comparison remains applicable because the
only change from its exact candidate (`6eecee8f`) to `34a18971` is a one-line
test expectation. Candidate click-to-next-paint p95 was 64 ms against the
100 ms limit; accepted-intent p95 was 2 ms, full-ready p95 52.9 ms and
completed-render readiness p95 59 ms. Loaded replay completed-frame p95 was
72.6 ms against 250 ms, and sampled peak heap was 1.4466% below the control.

This evidence qualifies the available Windows UHD 620 and Linux VM105 release
scope. It does not establish the aspirational 20% dense-motion/tracking
objective, cold first-use performance, a fresh exhaustive five-run eight-row
matrix, current-candidate strict screenshot equivalence, physical macOS or
discrete-GPU rendering, or human accessibility/usability review. No claim is
made for those unavailable or intentionally uncommissioned scopes.
