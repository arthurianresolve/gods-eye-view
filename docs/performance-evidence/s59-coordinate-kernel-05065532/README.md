# Coordinate-kernel experiment: repeat regression

Both ordered five-pair experiments test immutable commit
`05065532e1f6097546b00c3ac7961ccef2877184`. The scalar kernel is opt-in;
production retains Cesium conversion. No default change is accepted.

| Run | Combined load median change | Combined first usable | Polygon first usable | Gate |
| --- | --- | --- | --- | --- |
| [38176785594](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38176785594) | -35.58% | -6.53% | -3.68% | Pass |
| [38177035584](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38177035584) | -40.82% | +4.89% | +12.14% | Fail |

The unchanged gate limits regression to 10% for combined and per-shape load
and first-usable medians. Faster loading does not override the polygon
readiness regression. Both outcomes are retained; another blind rerun would
not resolve the observed variation.

[First raw report](report-38176785594.json) and [repeat raw report](report-38177035584.json)
preserve the full envelope, images, timing pairs, cleanup and failure outcome.
[Independent validation](independent-validation.json) records recomputed metrics
and original compact-JSON digests (excluding the final newline). Validation
decoded all 20 PNGs per report and verified RGBA digests, dimensions, fixed
fixture identities, native picks, foreground continuity and viewer cleanup.
Both browser processes exited naturally within five seconds.

The fixture contains a 50,000-coordinate line and polygon, fixed clock,
ellipsoid terrain and matched populations/settings. Frame capture/readback
is measured separately from load-to-native-pick readiness. The hosted macOS
ANGLE Apple Paravirtual Metal renderer is supplemental evidence; it is not
physical Windows GPU acceptance.

Next: attribute the polygon readiness variation and finish cooperative
large-feature preparation. The four-millisecond application batch target and
full S59/S60 acceptance remain unfinished.
