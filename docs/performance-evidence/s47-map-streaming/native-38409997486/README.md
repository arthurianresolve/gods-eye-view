# Native v3 map journey exposes lower-level coverage gaps

[Run 38409997486](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38409997486)
fails at exact candidate/harness `88420e2372c68268f6aa0b8cd39d081759571c37`.
The baseline `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7` completes its native
journey but fails the subsequent strict interception audit. The candidate
does not run. The observed renderer is Apple paravirtual Metal; this is
supplemental hosted evidence, not physical Windows validation.

The [unaltered raw report](performance-build-smoke.json) is 166,581 bytes,
SHA-256 `7f828e2fceaac964c092b2570a3ef588eb9ea0c94c7603e39b27e4f6f1925761`.
It identifies v3 manifest
`fdd277b9107d59a8efd96a151b5f9770e646bbe6598f73ef862b6c5a50cbd6ac`,
matching the reviewed local corpus.

The 60-second route finishes in 60,115.3 ms after separately recorded 507.8 ms
startup preparation and flight cancellation. All four map states reach readiness
(photoreal, Esri, OSM, photoreal), and the final completed render is observed.
All 1,940 sampled frusta stay within the declared route. Terrain observations
use the actual CesiumTerrainProvider and contain nonflat heights from 331.80 to
368.10 metres. Manual 75% density, DENSE mode, resolution, antialiasing, effects,
detail settings and cache limits remain unchanged.

The audit records 217 matched requests with 217 fulfillment acknowledgements,
zero pending requests and no page errors. Eleven additional requests reference
undeclared imagery assets. The bounded evidence retains eight paths:

- `imagery/1/0/1.png`
- `imagery/8/58/104.png`
- `imagery/8/58/106.png`
- `imagery/2/0/0.png`
- `imagery/3/1/2.png`
- `imagery/10/234/420.png`
- `imagery/7/29/53.png`
- `imagery/4/3/5.png`

Three paths are explicitly omitted. These retained paths are lower-level
coverage gaps; their purpose must be traced through Cesium's native imagery
and terrain selection rather than inferred from the route rectangle alone.
The report does not identify the three omitted paths.

The owning context closes, interception drains completely and renderer probe
cleanup is confirmed. Fixture delivery's stricter `cleanupConfirmed` remains
false because it includes the delivery errors; the report stays failed. Do not
repeat it unchanged, hide the requests, lower detail, or convert this completed
route into a native acceptance pass. Establish a finite native imagery coverage
inventory before the next run. M3, matched comparisons and S47/S57/S60 acceptance
remain incomplete.
