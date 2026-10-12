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

## Framebuffer preservation control

Fixture-only commit `b48c2e301fe2ab364cfbb9f270f4c99968f844b8` adds an explicit
preservation selector, retaining true as its default. The hardware runs use
the same Chrome instance in A/B/B/A order (A=true, B=false). Independent
inspection verifies identical start/end canvas bounds and 894x585 viewport,
full intersection, 640x360 drawing buffer, 5,000 points, antialiasing and all
other context attributes. Every run reports uninterrupted visible/focused
state and no context loss. No local builds or tests ran during this sequence.

| Ordered control | Frames in five seconds | Maximum RAF gap |
| --- | --- | --- |
| [A1: preservation true](preserve-a1-true.json) | 36 | 1,000.3 ms |
| [B1: preservation false](preserve-b1-false.json) | 64 | 783.5 ms |
| [B2: preservation false](preserve-b2-false.json) | 54 | 983.2 ms |
| [A2: preservation true](preserve-a2-true.json) | 37 | 999.6 ms |
| [Plain RAF, same fixture revision](preserve-plain-raf.json) | 285 | 266.3 ms |

Disabling preservation does not eliminate the scheduling stall. These short
controls establish neither a performance gain nor application capture correctness;
the production default stays unchanged. The intentionally released WebGL context
can leave a context-loss icon after the run; cleanup happens after the recorded
observation window and does not change its `contextLost` result.

## Cesium and wind controls

Four diagnostic runs at `acc471e4` distinguish completed-frame waiting from
pixel-copy/readback. All use the existing 400 ms per-frame deadline, three
requests maximum, and a fresh viewer. All report a ready scene and cleaned-up
listeners/viewer. These are individual observations, not matched latency samples.

| Control | Observation |
| --- | --- |
| [Globe only, no copy](wind-globe-no-copy.json) | Three completed frames; 84.4, 145.4 and 15.8 ms waits. |
| [Globe only, copy](wind-globe-copy.json) | Three copies/readbacks; 21.3, 238.0 and 92.0 ms frame-and-copy waits. |
| [Paused wind, no copy](wind-paused-no-copy.json) | First request fails at 409.7 ms; the probe stops as designed. |
| [Paused wind, copy](wind-paused-copy.json) | Three copies/readbacks; 24.5, 30.3 and 32.7 ms frame-and-copy waits. |

Package-boundary checks overlapped the wind diagnostic period, so its differing
outcomes cannot isolate wind or copying as the cause. The successful copy reports
retain pixel hashes but no images; they do not prove image equivalence or a
non-black capture. The failed request remains failed.

Desktop occlusion remains unavailable. Next work must attribute the remaining
minimal-WebGL scheduling stall separately from the hosted HUD depth-read cost.
These diagnostics do not replace matched performance runs or the sixty-minute
retention soak.

## Delayed-start diagnostic: initial arm

Fixture commit `6087231ae1482ff953b3b75bc0e91f722547809e` adds an optional
ten-second delay before canvas/context/program setup. The observation itself
remains five seconds. Preparation conditions, delay and context-setup time are
reported separately; ten focused tests, formatting and package boundaries pass.

The [immediate A1 report](delay-a1-immediate.json), downloaded unchanged, has
SHA-256 `80c27c787aebe487d2afd4ebfa8c38780020c28761d1161089c3307d2d952d9b`.
At 2026-10-12T01:16:43.357Z it records 40 frames over 5,002.1 ms, a 1,000 ms
maximum RAF gap, and 250 heartbeat ticks with a 22.7 ms maximum timer gap.
The renderer remains Intel UHD 620 / ANGLE D3D11, with a 640x360 buffer,
5,000 points, antialiasing and preservation enabled. The full canvas is inside
the 894x585 viewport at both endpoints; focus and visibility stay unchanged,
with no context loss. Context setup takes 12.1 ms. No local builds or tests
overlap this measurement.

The run uses a coordinate click followed immediately by the required browser
state observation, then no browser calls during the remaining measurement.
The planned delayed arm tests whether that immediate observation overlaps
frame delivery; this is a hypothesis, not an established cause. The report
download succeeded, but the browser-control connection subsequently became
unattached before the delayed arm could run. A1 is retained; the comparison,
physical foreground/occlusion verification, capture acceptance and hardware
soak remain pending. This short diagnostic does not justify a runtime change.

## Delayed-start diagnostic: completed controls

A fresh tab in the same authorized Chrome instance restored control. The
immediate/delayed pair was restarted there, keeping the earlier A1 above as a
separate observation. The ordered A/B/B/A sequence uses A=immediate and
B=ten-second preparation, followed by delayed plain RAF. No local test, build
or formatting process ran during the sequence. Each run used a coordinate
click and an immediate state observation; no further browser calls occurred
until the observation period finished. In delayed runs that initial browser
call completed during preparation, before WebGL setup and measurement.

| Control | Frames / five seconds | Maximum RAF gap | Maximum 20 ms timer gap |
| --- | --- | --- | --- |
| [A1 immediate](delay-fresh-a1-immediate.json) | 68 | 600.6 ms | 22.3 ms |
| [B1 delayed](delay-fresh-b1-ten-seconds.json) | 36 | 850.0 ms | 21.5 ms |
| [B2 delayed](delay-fresh-b2-ten-seconds.json) | 45 | 849.7 ms | 21.1 ms |
| [A2 immediate](delay-fresh-a2-immediate.json) | 65 | 683.3 ms | 23.5 ms |
| [Delayed plain RAF](delay-fresh-plain-raf.json) | 301 | 23.9 ms | 22.1 ms |

[Independent file review](delay-control-review.json) records raw hashes,
timestamps, actual preparation durations and context-setup times. All five
reports identify exact fixture commit `6087231a`. All four WebGL reports have
identical context attributes, 5,000 points, 640x360 buffers, 894x585 viewports,
full canvas intersection, unchanged start/end bounds, and the Intel hardware
renderer. Focus/visibility remain true/visible; preparation has no recorded
changes. No run loses its context during observation. Plain RAF creates no
WebGL context. The delayed WebGL waits are 10,015.2 and 10,015.1 ms; the plain
RAF wait is 10,003.7 ms.

Delaying setup does not eliminate the WebGL frame gap, so initial automation
overlap alone does not explain these observations. This is not a GPU timing
measurement and does not establish a driver defect. Desktop occlusion remains
unavailable; capture correctness and the physical hardware soak remain open.

The minimal WebGL fixture currently draws identical pixels each frame. A
separate animated-pixel control and compositor attribution are useful next
diagnostics. Chromium's [published compositor implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/master/components/viz/service/frame_sinks/compositor_frame_sink_support.cc)
contains throttling paths for unresponsive clients and excessive undrawn
frames; this is a hypothesis source, not proof that either path ran here.
The exact Chrome build's source was not available through the web reader.
Production rendering, preservation, antialiasing, browser flags and drivers
remain unchanged.
