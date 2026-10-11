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

Next: run identified WebGL and plain-RAF controls with the full canvas visible,
then the existing Cesium/wind frame and capture controls. Keep failed reports.
The short configuration and scheduling checks do not replace the required
matched performance runs or sixty-minute retention soak.
