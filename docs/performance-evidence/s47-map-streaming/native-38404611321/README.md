# Corrected camera route exposes missing imagery coverage

[Run 38404611321](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38404611321)
is **failed** at exact candidate/harness
`af821c5ce9080ce726e258248135105d3a510945`, with the frozen baseline
`eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. The baseline completes its native map
journey but fails the subsequent interception audit. The candidate never runs.

The supported invocation uses `austin-map-streaming-v1`, diagnostic worker audit
and `macos-native-diagnostic`. The observed renderer is Apple paravirtual Metal
on the standard GitHub macOS runner. This is supplemental hosted evidence, not
physical Windows coverage or performance acceptance.

The [unmodified raw report](performance-build-smoke.json) is 109,490 bytes,
SHA-256 `3ee84cf2bbb6ef3eb5910a5192f77d1c62b29fce1427a19d33b9481e947977f0`.

The reviewed startup preparation passes its first native application control:

- Preparation takes 511.1 ms, followed by explicit flight cancellation.
- The initial camera is at the declared longitude/latitude and 6,000 m height.
- The 60-second route completes in 60,088.6 ms with a final completed render.
- All four map states reach readiness: photoreal, Esri, OSM, photoreal.
- All 2,543 observed frusta stay within the declared route bounds.
- Manual 75% density, DENSE mode, resolution, antialiasing, effects and detail
  settings remain unchanged before and after the journey.

Strict journey validation completes. The later page-health audit fails with
83 distinct missing-asset observations. The bounded report retains eight paths
and explicitly records 75 omitted paths. All eight retained paths are imagery
at zoom 15 (`x=7492/7493`, `y=13489..13492`). The fixture generator includes only
imagery levels 0 through 12. No page errors are recorded. The 77 owned requests
that match the manifest all receive fulfillment acknowledgements, but fixture
delivery remains failed and `cleanupConfirmed` remains false because of the
missing assets. Context retirement and probe cleanup are separately confirmed.

This establishes an imagery coverage gap exposed by native rendering. It does
not identify all 75 omitted paths or justify replacing errors with successful
fallbacks. The next fixture change must preserve 256 x 256 texture resolution,
the route, visual settings and strict delivery validation. Cover the requested
levels within an explicit measured resource budget; do not lower image detail
or screen-space-error targets to avoid requests.

The v1 fixture manifest is the previous macOS value
`798411accb8f7f52c8f58562ec6263f1bebd48cdbcda97527b57c1a4ef5fe0d4`.
Its cross-platform byte differences are a separate reproducibility issue.
The full native baseline/candidate gate, physical Windows validation and S47/S60
acceptance remain pending. This failed run is not retried unchanged.
