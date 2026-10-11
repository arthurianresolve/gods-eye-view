# Windows framebuffer control

Exact fixture commit: `9c482cac36eaa0726e7d90dc6037db63de21c53a`.
Three sequential five-second observations on Windows Chrome 154, Intel UHD
620/D3D11. Reports are serialized from the visible browser fixture results.

| Control | Delivered callbacks | Maximum callback gap |
| --- | ---: | ---: |
| [WebGL, buffer preserved](webgl2.json) | 48 | 1,016 ms |
| [WebGL, buffer not preserved](webgl2-unpreserved.json) | 10 | 1,056 ms |
| [Plain animation, no WebGL](plain-raf.json) | 286 | 66 ms |

The WebGL controls use the same 5,000 static points, 640 by 360 drawing buffer,
antialiasing, depth, stencil and power preference. Actual context attributes
confirm the requested buffer-preservation difference. All three report visible,
focused documents throughout; no context loss or visibility events occurred.
Desktop occlusion remains unverified and only 74.5% of the canvas intersects
the viewport. Timer jitter and single short samples prevent a performance claim.

Disabling framebuffer preservation does not remove the observed long gaps.
This rejects it as an established fix for the remaining Windows frame failure;
it does not measure the option's general performance or capture correctness.
The production default and 400 ms capture deadline remain unchanged. The
separate mixed-Cesium dependency failure has its own before/after evidence.

A subsequent [1,200 by 1,000 viewport control](webgl2-full-viewport.json)
places the entire unchanged 640 by 360 canvas inside the viewport. It still
delivers only 59 callbacks, with a 999.7 ms maximum gap. This corroborates the
historical full-viewport control already recorded in the performance plan;
viewport clipping alone does not explain the stall. The viewport override was
then reset. Desktop foreground/occlusion still requires a manual observation.
