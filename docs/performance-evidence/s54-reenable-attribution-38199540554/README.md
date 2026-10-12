# Re-enable observation: failure moves to the collection lifetime

[Run 38199540554](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38199540554)
tests exact application/harness commit `161b8896c830942ae1da948cffc3da97399ec02e`
using the opt-in `cable-reenable-attribution` mode. It remains **failed** on
both exact-image and lifecycle gates. The owned observer adds no render
requests and leaves the 12-second scene-stability deadline unchanged.

The complete [raw report](report.json) is 5,433,424 bytes, SHA-256
`82846ec74b48ba61b6fbc3b5f12834f8eaa3a365ea6535e39f407e94dc65e37e`.
[CI metadata](ci-run.json) binds it to the tested revision. Independent decoding
of all twenty PNGs and comparison of the retained coordinate rows produced the
[review](review.json):

- All five default-view image pairs match exactly. All five camera-change
  pairs differ by 162 pixels, with matching camera, style, source identity and
  picking hashes. The geometry hashes differ.
- The full witnesses contain 2,629 unique references on each side. Independent
  comparison confirms 287 references have different point and stem positions;
  all are hidden in both snapshots. The 35 visible references are unchanged,
  and there are no source-identity or visibility changes. Source-geometry
  hashes also match. This establishes coordinate drift, but does not prove it
  causes the image differences.
- The sample-0 pixel differences form 13 small connected regions, mostly around
  ground/stem anchors. [Pixel coordinates and color transitions](pixel-difference-locations.json)
  are retained without changing images or introducing a tolerance or mask.
- The Entity renderer completes both lifecycle cycles and teardown. The observer
  covers its first re-enable cycle: 26 snapshots over 7,879 ms, a maximum timer
  receipt gap of 2,128 ms, continued default rendering, no observed render errors,
  and ready scene owners at the end. Observer setup and cleanup are confirmed.
  No context-loss event is observed; the initial context-loss state remains
  explicitly unknown.
- The collection renderer captures all ten images, then times out at
  `reenable-scene-stability`, cycle 0. Its layer teardown assertions are not
  reached, although its owned viewer destruction is confirmed. That failing
  cycle is outside the Entity-only observer's coverage. A successful observed
  Entity cycle cannot diagnose or exonerate the failed collection cycle.

The environment is hosted Apple paravirtual Metal, not physical Windows.
There are no recorded page/interception errors or external requests. The raw
report records browser and viewer cleanup separately from lifecycle success.

The next investigation must cover both renderer lifetimes and their re-enable
cycles, then attribute the coordinate and pixel differences. CPU profiling
remains a separate diagnostic option if the bounded observations cannot locate
the stall. This result is not a renderer promotion, repeatability pass, speedup,
retention plateau or physical hardware acceptance.
