# Delayed-start WebGL frame diagnostic

This fixture adds an optional ten-second preparation wait before its existing
five-second WebGL2 or plain-RAF observation. Immediate start remains the
default. The WebGL workload stays at 5,000 points on the 640×360 canvas, with
the existing antialiasing, context attributes, native timers, and preservation
choice unchanged.

The report records the requested delay separately from the monotonic elapsed
delay, separately measured context-setup duration, plus focus, visibility, and viewport snapshots and whether those
conditions changed during preparation. A single owned timer and temporary
listeners are removed on elapsed wait, Cancel, or page hide. No countdown work
runs in the DOM during the wait.

This is a diagnostic control for checking whether immediate post-click browser
interaction overlaps the measurement window. It has no results yet and makes
no GPU-speed, hardware-acceptance, or application-performance claim. The
preparation observations also cannot verify desktop occlusion.

Focused validation:

```text
node --test scripts/performance/webglFrameDelivery.test.mjs scripts/performance/webglStartDelay.test.mjs
```
