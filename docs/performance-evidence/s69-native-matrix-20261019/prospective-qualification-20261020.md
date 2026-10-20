# Prospective qualification corrections — 20 October 2026

Application candidate: `190c5ab64c8ffa26da5e0eede9d2e9eea3eb1841`.
These changes affect qualification tooling. They do not lower resolution,
populations, effects, geometry detail, or any other application quality setting.
Historical failures retain their original results.

## Startup inputs

Infrastructure startup documents did not install their declared fixture clock
before navigation. The existing clock installer now applies to an explicitly
declared default-boot confirmation. English is pinned, and the initial URL,
clock, camera, map, empty layer population, and native visual settings are
recorded at both existing readiness observations.

The default Austin camera flight remains unchanged. A shared-view URL would add
its own restoration waits and is therefore excluded. The viewer, controls, and
camera source blobs must match between builds. Provider responses remain live;
this is not a deterministic offline network benchmark.

The original ten-slot order and 10% regression limit remain. The previous
28.53% viewer-ready and 26.46% loader-hidden regressions remain failures. Future
corrected captures cannot be mixed with the previous measurement protocol.

## Local controls

Trusted click is the activation boundary for the layer button. Pointer-down,
pointer-up, their delivery times, and press duration remain in the evidence.
The immediate acknowledgement requirement is separated from full preparation:

- Click to accepted visibility intent: p95 at most 100 ms.
- Click to visibly acknowledged state: p95 at most 100 ms, corroborated by two
  distinct natural animation frames. ARIA mutation alone is insufficient.
- Full active-LOD state and a matching completed Cesium render remain separately
  measured. Neither may regress more than 10% against the matched control.

An accepted transition may still be loading. It must not be presented as finished
geometry. The previous 625.4 ms full-readiness result is retained; it is not a
100 ms response-time pass.

## Static idle

Idle acceptance counts actual completed renders, including the first frame.
Every rolling, half-open ten-second window must contain at most two renders.
All five 60-second samples on each build must qualify.

Public tile-progress and scene-update events must demonstrate at least two
seconds of settlement before measurement and unchanged camera, loaded tiles,
and request-render mode throughout it. Unsettled windows remain unavailable;
frame bursts fail. Zero rendered frames do not manufacture a frame-interval
percentile. The previous one-pair cable diagnostic is not sufficient evidence.

## Visual controls

A plan fixed before acquisition requires three fresh documents per build, four
states per document, and all 24 original PNGs. No image may be discarded.
Each whole image must have an independently observed counterpart in the other
build, in both directions, with matching semantic and paint inputs.

The small residual allowance remains at most ten pixels and ten RGB levels,
with unchanged alpha. Each residual pixel value must also occur independently
in both builds. Large raster variants require whole-image support in both
builds; neither coordinate masks nor a larger noise allowance are introduced.
Actual `.title-logo` pseudo-elements and SVG paint inputs are recorded.

## Status

Code and focused automated checks precede fresh native captures. None of these
changes, by itself, closes a hardware acceptance gate. The existing passing
Ampfing soak remains evidence for the unchanged application candidate.
