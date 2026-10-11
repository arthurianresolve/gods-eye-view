# Windows hardware configuration and frame retry

The user supplied a Chrome GPU report exported at 2026-10-11T23:03:55.475Z.
[The configuration summary](configuration.json) retains its SHA-256, browser,
OS, driver and renderer identities. The original text remains in the user's
Downloads directory; private local paths and command-line details are omitted.

- Chrome 154.0.8037.98 on Windows 10 build 19045.7725.
- Intel UHD Graphics 620, driver 30.0.101.1338, ANGLE D3D11.
- WebGL and compositing report hardware acceleration; software rendering says No.
- GPU-process crash count is zero. The report includes three unsupported-version
  context-creation messages and says the information-collection GPU process
  exited normally. These messages and applied driver workarounds do not prove
  the cause of the application's frame-delivery failure.

The [initial minimal WebGL report](webgl-initial-unidentified.json) was downloaded
from the local diagnostic page without editing its contents. It draws 5,000
points and contains no Cesium scene. During 5,001.9 ms it receives 54 RAF
callbacks, including a one-second bucket with zero callbacks and a maximum
1,016.3 ms frame gap. Its 20 ms heartbeat delivers 250 ticks with a 21.4 ms
maximum gap. The page reports visible/focused throughout and no context loss.

This first attempt has two limitations: the server was started without
GEV_APP_COMMIT (both identities remain null), and only 89.95% of the canvas is
inside the viewport. Desktop occlusion is unavailable. It is not a performance,
capture-correctness or hardware-soak pass, and its missing identity is not
retrospectively filled in. The server setup has since been corrected to clean
dev commit `acc471e4afb4ff629244ec37caf2836b6aef89ef`.

The identified follow-up retains both the first, partially visible pair and a
fully visible pair at exact app/harness `acc471e4`:

| Control | Frames in five seconds | Maximum RAF gap | Maximum 20 ms timer gap |
| --- | --- | --- | --- |
| [WebGL, 89.95% viewport intersection](webgl-identified-partially-visible.json) | 53 | 966.5 ms | 33.1 ms |
| [Plain RAF, 89.95% viewport intersection](plain-raf-identified-partially-visible.json) | 282 | 166.5 ms | 117.5 ms |
| [WebGL, full viewport intersection](webgl-identified-fully-visible.json) | 60 | 849.9 ms | 22.6 ms |
| [Plain RAF, full viewport intersection](plain-raf-identified-fully-visible.json) | 286 | 200.3 ms | 83.9 ms |

The full pair has matching canvas/viewport geometry, build identity and
five-second duration, no focus/visibility events, and no context loss. WebGL
uses the reported Intel D3D11 hardware renderer, 5,000 points, a 640x360 buffer,
antialiasing and framebuffer preservation. Plain RAF creates no WebGL context.
The same large scheduling gap occurs without Cesium; these observations do not
identify a driver defect or rule out desktop/window effects.

The same application revision passed all seven standard jobs in
[CI run 38183006552](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38183006552):
Node 24/26 tests and builds, Windows onboarding, Windows/macOS/Linux installation
and recovery, and the browser journey gate. [The retained job record](standard-ci-38183006552.json)
includes individual step outcomes. Optional jobs, including the sixty-minute
soak and published layer-token checks on this push, were skipped; a green
standard run does not satisfy those checks or resolve the hardware frame stall.

The locator click initially scrolled the Run button into the center and moved
the canvas partly outside the viewport. The full pair uses a screenshot-grounded
coordinate click after scrolling, preserving the recorded complete intersection.
This setup correction does not erase the earlier results. A fresh browser tab
also restored control after a stale debugger connection.

Next: compare framebuffer preservation in a separate minimal control while
keeping antialiasing, buffer dimensions and point count unchanged, then rerun
the existing Cesium/wind frame and capture controls. Desktop occlusion is still
unavailable. These short diagnostics do not replace the required matched
performance runs or sixty-minute retention soak.
