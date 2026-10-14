# Windows frame delivery in the current Chrome window - 12 October 2026

A fresh tab in the user's current Chrome window restored screenshot delivery.
The older fixture tab reported an 83 CSS-pixel document width and its screenshot
failed with a zero-width error. The GitHub tab captured normally. The fresh
fixture reported 894 x 529 CSS pixels and its complete canvas was inside the
viewport. No viewport override, browser flag, driver, VM or production setting
was changed. This resolves the immediate observation problem for the fresh tab;
it does not identify why the old tab had different geometry.

Two five-second diagnostics used the existing standalone fixture at
`a92c69217e95c3a61d74d81c9e8f4274b14c7f1d`, without Cesium or the application.
These reports are not a current-dev benchmark, fresh-frame capture test, or soak.

| Observation | WebGL2, 5,000 static points | Plain RAF, no WebGL |
| --- | ---: | ---: |
| Start (UTC) | 08:26:44.706 | 08:29:40.858 |
| Actual window | 5,003 ms | 5,001.5 ms |
| Frame callbacks | 13 | 300 |
| Maximum frame gap | 1,016.8 ms | 24.7 ms |
| 20-ms timer ticks | 250 | 250 |
| Maximum timer gap | 29.7 ms | 21.7 ms |

Both reports show Chrome 154 on Windows, unchanged focus/visibility/viewport,
and full canvas/viewport intersection. WebGL reports Intel UHD 620 through ANGLE
D3D11, no context loss, and identical start/end context attributes with antialiasing and
framebuffer preservation enabled. Renderer metadata was read after the window.

This reproduces sparse WebGL frame delivery in a tab with a usable viewport,
while the no-WebGL control and ordinary timers continue normally. It does not
prove a driver defect, browser occlusion policy, application regression, or
upstream-versus-dev origin. Desktop occlusion remains explicitly unverified;
this was one sequential diagnostic pair with no system-load isolation or
counterbalanced repetitions. A later pass must not overwrite either report.
Hardware acceptance and the full Windows soak remain pending.

The next environment experiment needs an independently verified uncovered Chrome
window and a bounded frame/compositor trace; repeating the same diagnostic or
changing application quality would not distinguish these remaining causes.

- [WebGL report](webgl2.json): 4,814 bytes; SHA-256
  `109fe950791c904f79bc9bae844723d06b71dcedc75f4df6888fb51b88ee8202`.
- [No-WebGL control](plain-raf.json): 3,611 bytes; SHA-256
  `6778b3109547d424334522036fb2bf7a632807e9fe28761afb14d5525dcc6023`.

The download-event observer timed out after the WebGL download completed. The
file on disk was read and verified against the displayed report; the diagnostic
was not rerun because of that tooling timeout.
