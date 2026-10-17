# Rendered viewshed retention passes after metadata fix

[Run 38439815077](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38439815077)
passes at application/harness `fa0e8a492286cd2dc032d28220400f0f98c88a52`.
Root replays the strict report validator and independently counts all 31 bounded
construction events: fourteen startup volumes, two cohort handoffs, one hidden
pose edit and exactly fourteen full-layer rebuild-control volumes. Unchanged
mode/disable/enable cycles construct none. No events are omitted; the live cohort
never exceeds fourteen and no duplicate camera owners occur.

The in-page comparison reports zero changed pixels and matching retained/rebuilt
RGBA SHA-256 `cb686830b11cc58975ca042a2c65db6131e577e6240fa557ab6178ab2c86f729`.
Viewshed visibility changes 73,796 pixels versus the wireframe control. These are
the fixture's exact pixel comparison and reported hashes; successful raw PNGs are
not retained for independent decoding. Effective pose, clock, 1200 by 800 buffer,
four-sample MSAA, antialiasing and preservation remain matched.

Ready and pre-ready tint checks pass. Cleanup records 31 created, 31 removed,
31 destroyed and zero live volumes, with layer-only post-render listeners back
at three. Overlay/governor retirement reduces that count to two before viewer
destruction. The observer is restored. There are no page/interception errors or
external requests. [The review](review.json) preserves the independently checked
counts and the evidence boundary.

The metadata-only fix is production commit `641cdd3f`; bounded diagnostic
signatures are `fa0e8a49`. The [previous failed run](../native-38437691743/README.md)
remains failed and is not retrospectively attributed to a specific camera.
This passing hosted Apple Paravirtual Metal component result does not establish
physical Windows performance or a long-run retention plateau.

Artifact `11835085716`: [original report](hosted-native-renderer.json), 47,266 bytes,
SHA-256 `5a8af98f3d10f69791239587495ee59a6efbcf646fb5e847717a289717b9b60c`.
