# Detached CCTV thumbnail ownership

The completed private 16-cycle heap diagnostic found 18 retired image nodes
reachable through `HTMLDocument → blink::MediaQueryMatcher →
blink::HTMLImageElement::ViewportChangeListener → IMG`. Only the latest
`Rendered soak 17` import remained; this snapshot did not show older imported
records accumulating. These are reachability paths, not retained-size or
dominator measurements.

A separate reproduction on native Windows Chrome 155.0.8059.84 created 24
decoded images per cleanup strategy. After three bounded drain/forced-GC
checkpoints, `removeAttribute('src')` retained all 24 images. Leaving the source
unchanged, assigning an empty source, assigning the data-image source, and
removing an image from a temporary fragment each left zero live WeakRefs.
The deliberately strong control retained all 24. The private browser closed
normally. The original result is
`detached-image-reproduction-1792405257381.json`; it is diagnostic evidence,
not a full soak or latency pass.

The two camera-card cancellation paths now clear their callbacks and assign an
empty source. They no longer remove the attribute from disconnected Image
objects. An ownership guard also rejects already queued callbacks after
cancellation, and duplicate settlement cannot mutate a later attempt. Fresh
successes and errors still update the original frame/retry policy. Projection,
image quality, provider refresh cadence and visible card populations are unchanged.
The 33 focused card, rendering, presentation and workspace-restore tests pass.
`scripts/qa-cctv-image-src-release.mjs` provides a bounded browser reproduction;
it does not force a browser that has fixed this issue to reproduce the leak.

This finding is consistent with Chromium's
[image source selection and viewport-listener ownership](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/html/html_image_element.cc).
The local reproduction establishes the behavior on the recorded browser; the
moving upstream source link is explanatory, not proof of the installed binary.
The intervention in the complete application and the final 60-minute soak are
still required. The earlier 6.32% heap-growth failure remains failed; this fix
does not yet establish that all retained-heap growth is resolved.

Private snapshot hashes:

- Raw: `56c183f90e2b7a987fb28ee5b30c346d76601e67a9142901279515da0202d168`
- Compressed: `fe6ce30d2048510639834bcf3b9b7dae49dddbc33e4591888a08bd34ca08374c`

The 728,943,920-byte snapshot is stored compressed on VM105. No raw heap,
provider contents, URLs or image pixels are published with this report.
