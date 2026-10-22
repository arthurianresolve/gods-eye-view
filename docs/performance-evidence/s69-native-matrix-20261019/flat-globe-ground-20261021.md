# Flat-globe ground-sampling experiment — 21 October 2026

This patch avoids synchronous `scene.sampleHeight` depth reads for bundled
infrastructure only when the viewer uses loaded ellipsoid terrain and the
scene contains no other visible height-bearing owner. It uses the already
loaded globe height, and invalidates the result if another owner appears.
Normal terrain, visible previews, 3D Tiles and unrecognized scene ownership
retain the original depth-sampling path. The guard and its transition have a
focused unit test.

The comparison below is **diagnostic, not performance acceptance**. Both
production builds report application commit `e43d3ed`, but the experimental
build additionally contains uncommitted source changes captured by
`qa-artifacts/flat-globe-ground-20261021.patch` (SHA-256
`9a092ad9f63589c21007fdf6e508b01e111b0f14912bb315b5702430205a0ff2`).
Its artifact has no exact-commit attestation. Both runs used Chrome
155.0.8059.85 on Intel UHD 620 D3D11, the intercepted eight-feature fixture,
and sequential headed browsers with confirmed cleanup.

| Diagnostic                                                        | Unpatched | Experimental patch |
| ----------------------------------------------------------------- | --------: | -----------------: |
| Ground depth reads per enabled action                             |         8 |                  0 |
| Warmed enabled-action post-render p95, baseline-first (9 actions) |   50.8 ms |             9.6 ms |
| Warmed enabled-action post-render p95, patch-first (9 actions)    |   66.3 ms |             9.9 ms |
| Native-click p95 across 20 alternating actions, baseline-first    |    192 ms |             280 ms |
| Native-click p95 across 20 alternating actions, patch-first       |    208 ms |             128 ms |

The native-click results are order-sensitive and do not satisfy the full
interaction gate. The enabled-frame improvement is repeatable in both orders,
but these short runs have diagnostic observers and do not replace the matched
five-run acquisition. The intended preview entities were present but hidden;
the first experimental build's stricter guard correctly stayed on the original
path until hidden entities were explicitly distinguished from visible ones.

At the same fixed camera, eight feature identities, viewport, 2560×1074
drawing buffer, resolution scale 1 and MSAA 4 matched. The largest difference
in a feature's ground Cartesian position was 0.0175 m. Early screenshots were
captured before the slower build completed its first stem render and are not
comparable. Settled screenshots show the same stem and label layout, with
cross-build RGB differences no greater than 2/255 per channel. More than a
million globe-gradient pixels differ by one or two channel values; this is
**not** a strict pixel-equivalence pass. Unpaused visual qualification on an
exact committed build remains required. The existing overall S69/S60/S70
acceptance and final Ampfing soak remain pending.

## Follow-up correction — 22 October 2026

The first implementation invalidated flat-globe samples when a competing
height owner appeared, but did not rebase a successful depth sample when that
owner later disappeared. A stem could retain a sampled roof height over an
otherwise flat ellipsoid. The lifecycle test reproduces that floating stem
against the original code. The correction rebases active stems through loaded
globe height on the return transition and allows that path even when scene
depth sampling is unavailable. Both ownership transitions are checked on the
next eligible 500 ms visibility walk without an extra depth read on return.
The corrected source passes 148 focused infrastructure and lifecycle tests,
formatting, package-boundary checks and a production build.

This is a correctness fix, not a fresh hardware-performance or visual pass.
The earlier diagnostic numbers above remain tied to their original runtime;
S69/S60/S70 acceptance and the final Ampfing soak remain pending.
