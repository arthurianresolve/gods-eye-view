# Empty fleets no longer hold continuous rendering

The matched application diagnostic observes **18 completed frames before and
one after** over ten foreground seconds. The candidate passes the unchanged
maximum of two; the baseline remains failed evidence. This is a functional
comparison plus a same-candidate repeat on hosted Linux SwiftShader, not a motion-p95 or physical GPU claim.

| Run | Exact application/harness revision | Result |
| --- | --- | --- |
| [BEFORE 38458160500](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38458160500) | `6786f8ddb146636c08631eeb36cf75c42942a87f` | 18 frames; idle gate fails |
| [AFTER 38458245470](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38458245470) | `106918ee94666545e8727cc938d09599f59e0a20` | 1 frame; diagnostic passes |
| [Tracking 38458251714](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38458251714) | `106918ee94666545e8727cc938d09599f59e0a20` | 111 passed, zero failed/skipped |

The harness, workflow and lockfile are byte-identical across the comparison.
[Root review](review.json) records their hashes and the fifteen changed paths.
The actual app identities match clean checked-out sources. Both use the same
Chromium-reported version, SwiftShader renderer, 1440 x 1000 viewport/drawing
buffer, camera, fixture hashes and reported Manual settings (75% density,
resolution 1, MSAA 4, antialiasing and framebuffer preservation enabled).
Both layers are enabled with zero records. Completed source polls still wake the
idle renderer; populated/tracked fleets retain continuous demand.

Both runs hold 185 intercepted map requests unchanged during observation, with
zero pending requests or tile queues. **OSM content is deliberately blocked.**
Quiescent demand does not establish delivered imagery or visual equivalence.
The corrected failure projection now explicitly reports content not ready.
The candidate's simulated document-hidden control stops the loop and produces
a new frame on resume; this does not test OS/browser tab occlusion.

The before/after inventories identify the one remaining canvas as the same
hidden 300 x 150 CCTV template element, with unchanged dimensions and placement.
Viewer and world-overlay canvases are removed; application owners, scheduled
wakes and postRender listeners are released. This classifies the canvas in these
new runs only; the older count-only report remains unresolved historical data.
Separate receipt validation accepts the normal military poll advance while
requiring civil fixture time to stay fixed.

Mixed-use and durable workspace journeys pass on both revisions. The separate
tracking run serves eighteen bundled imagery tiles, passes all 111 existing
checks, and exits its browser normally without forced termination. It does not
supply motion-p95, long-task or hardware measurements.

Root also passes 79 affected runtime/camera tests on `106918ee`, package
boundaries and formatting (1,654 scoped files). The later test-only satellite
lifecycle addition at `67912ed1` passes 27 satellite/vessel/governor checks at
`73a2cb7d`. These exercise the real scheduler and lifecycle with a simulated
scene callback; they do not measure SGP4 or populated-layer rendered cadence.

The original artifacts were downloaded through GitHub REST and their ZIP
SHA-256 digests verified before selecting exact known filenames:

- BEFORE artifact 11844238650: `d327810a298ac3431dd4f59a67425646226a06c55a8a705152115973a5a1d1b1`.
- AFTER artifact 11844656873: `aec11e3e50a6b5e6c04381d25f6ea41998f75bc66947543188906dbf4630676c`.
- Tracking artifact 11844982756: `a7c33e74f815ba1177311630cf0d4e374ba349f241a8ddd937cc4c76dd6207ff`.

[files.json](files.json) binds retained reports, raw logs and run metadata.
The baseline is the harness's bounded failure projection; fields absent from
that projection are not independently revalidated. The successful raw candidate
report is retained. The independent same-candidate repeat
[38459358679](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38459358679)
passes with **zero** completed frames in ten seconds. Its source, browser,
renderer, settings, camera and fixture identities match the first candidate;
visibility resume and identified-canvas teardown pass again. Artifact
11845875144 has verified ZIP SHA-256
`d55351ca0b87b0aafb4875ac8686e8ad7fd3a2a05cf98bc2d6d63a7ad1af81b0`.

This accepts the narrow enabled-empty fleet ownership change. S51 remains
partial: a separate source audit found that the earlier one-second satellite
scheduler can throttle the dense catalog's per-frame round-robin updates.
The lifecycle test above covers scheduler ownership, not that real dense
producer. A producer-path regression/fix is in progress. Full candidate
qualification and physical Windows coverage remain pending.
