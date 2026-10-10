# Idle font invalidation fixture

This correctness check uses a real Cesium request-render scene and the browser's
FontFaceSet. It first requires a naturally settled scene and an 800 ms interval
with no frames or render requests. A local font load must wake the current
overlay, update its static layout and hit bounds, and change nonempty Canvas2D
pixels. A second load checks listener ownership after replacing the overlay host.
Queued callbacks from an earlier font readiness promise are covered separately
by the Node tests; the native replacement case covers current event ownership.

The hosted runner compares two alternating pairs at immutable commits. The
baseline must demonstrate a real changed font width with no overlay wake; the
candidate must pass every correctness check. Software WebGL is explicit and
does not count as hardware or performance acceptance. The runner records all
outcomes, source hashes, browser details and cleanup in its job log. Local
interactive Chrome must be controlled through the Chrome extension.

The test-only family alias `JetBrains Mono` refers to **Roboto Variable**, not
the production font. The unchanged font and license come from
[google/fonts at 6183fc0](https://github.com/google/fonts/tree/6183fc0d26361f6ddfd6f6b7a736e1467c6d8a43/ofl/roboto),
files `Roboto[wdth,wght].ttf` and `OFL.txt`. The SIL Open Font License is included
alongside the fixture. No font download occurs at test time.

- Font SHA-256: `d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134`
- License SHA-256: `061402327a96aadb0bfb694a960ed289ecd38d383e396243831ab81feb109c41`
