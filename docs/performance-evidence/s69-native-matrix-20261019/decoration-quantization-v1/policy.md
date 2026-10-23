# Prospective decoration quantization contract

This is an explicit quality-equivalence amendment, not a claim of random noise
or a retrospective pass. The complete `c373d91b` / `3cd4d528` 24-image cohort
failed `repeated-full-image-controls-v1`; its raw files, 60 comparisons and
failure remain unchanged. Earlier single-pair and capture failures also remain.
No new cohort has qualified this policy.

The opt-in policy is `source-bound-decoration-quantization-v1`. A new plan must
name it before any browser starts, bind the committed calibration bytes and
source closure, retain all 24 images, and compare every unordered pair of the
six images in each state: 15 pairs per state, 60 overall. All pairs must pass.
There is no nearest-image/value fallback, selected control, pixel-count budget,
discarded image, synthetic accepted image or ignored pixel.

## Pixel contract

- Alpha is exact over the entire image.
- All RGB channels outside the two source-defined supports are exact.
- The title logo's source 12 CSS-pixel drop shadow uses a conservative three
  standard-deviation paint extent around its measured SVG viewport. With the
  fixed 1440 × 900 CSS viewport and DPR 2, the clipped device-pixel half-open
  support is `[0,248) × [0,206)`. RGB differences are bounded by 2 within this
  support, except the original opaque inner-eye interior, which remains exact.
- The opaque interior is derived from the original SVG cubic path and its
  `viewBox` / `xMidYMid meet` transform, with at most 0.01 device-pixel curve
  flattening error and a conservative 1.01 device-pixel boundary guard.
  It protects 2,026 pixels, including the globe/land interior. This is a source
  geometry construction, not a union of observed changed pixels.
- The logo support overlaps transparent spaces and glyph antialiasing in title
  text line boxes. The rule explicitly permits bounded filtered-composite
  differences there; it does **not** assert bit-exact glyph rasterization.
  Raw text nodes, every DOMRange line box, text styles, font availability and
  actual platform font usage must instead be complete and identical.
- CCTV badge RGB differences are bounded by 7 only in its measured mathematical
  rounded-border support. The source pill has a 1 CSS-pixel border and 999px
  radii, reduced according to the CSS corner-overlap rule. The support comprises
  the border plus one device pixel of antialiasing on either edge. Badge text
  line boxes expanded by one device pixel are excluded and remain exact, as
  does the badge interior.

The Chromium source paint-bound model used for the logo support maps a blur
standard deviation to three times that value and unions a drop shadow with its
original paint. See the pinned [Chromium filter implementation](https://chromium.googlesource.com/chromium/src.git/+/refs/tags/138.0.7204.191/cc/paint/filter_operation.cc).
This is a conservative source geometry model, not proof of the Chrome 155 GPU
shader's internal precision.

## Independent calibration and limits of attribution

`calibration.json` binds the original e7 baseline, original header paint digest,
source files, support geometry and raw image hashes. All 66 pairs of 12 earlier
unchanged-baseline images establish maximum RGB delta 2 in the halo outside the
SVG viewport and its antialiasing guard. The earlier core delta 103 is explicitly
excluded from calibration: its gaze history was not normalized.

Only baseline images from the later complete cohort calibrate the badge bound:
the unchanged baseline itself exhibits the eight rounded-border pixels at
maximum channel delta 7. Candidate extrema do not determine these bounds.

The later complete cohort also contains 13 HUD-visible and 22 HUD-restored
pixels that are stable within each build but differ between builds by one RGB
level. These are reported as bounded shifts, not relabeled random noise.
Source, semantic and normalized gaze-history equality support a bounded
decoration equivalence rule; they do not prove all raster differences random.

## Mandatory capture proof

The original complete header paint signature is pinned. The source closure
includes the SVG, gaze implementation, header and panel templates, font-bearing
HTML, foundation/CCTV styles and badge updater. Source bytes must match the
original baseline in both clean application checkouts.

At both screenshot boundaries, read-only evidence records the raw title/badge
text nodes and line boxes; complete computed text styles; root attributes;
measured badge rectangle; radii, borders, background, color, opacity and
filters; all ancestor rectangles/styles/pseudo styles; document font-face
statuses; and font availability for the actual strings. An owned post-navigation
CDP session queries actual platform-font family, PostScript name, custom-font
flag and glyph counts for every text parent immediately before and after the
paused screenshot. Node IDs are not comparison inputs. Missing, unsupported,
truncated, changing or unequal proof fails qualification.

Proof before and after each screenshot must match, must belong to the retained
attempt, and must match all six controls for that state. All existing native
profile, foreground, fixture, renderer, camera, HUD, phase, cleanup, source,
full-extent pointer-sweep and canonical mutation-history checks remain required.
The ordinary single-pair consumer cannot accept this policy.

Negative controls cover a delta of 3 in logo support, 8 in badge support, 1 in
exact exterior/opaque regions, alpha changes, changed path/geometry/text/font/
opacity/color/filter, missing proof, unsupported fonts and cleanup failure.
The all-pairs rule prevents an intermediate shared value from hiding a larger
baseline-to-candidate difference.
