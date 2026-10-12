# Datacenter captures bound to current display updates

[Hosted run 38216619573](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38216619573)
passes at application and harness commit
`d94bfa16e807f9ba7fb1cff7e4d2f2b40a87488d`. This is an isolated correctness
diagnostic on Apple paravirtual Metal, not physical Windows or performance
acceptance. Production Entity defaults remain unchanged.

The installed Cesium 1.138.0 dependency retains an earlier success in
`DataSourceDisplay.ready` (`this._ready = this._ready || result`), while the
return value of `update()` describes the current update. Static geometry can
retain its old primitive while a replacement is being prepared. The previous
fixture's latched-ready check therefore did not establish current materialization.

The opt-in observer records the return from Cesium's existing update calls,
without calling update again. A qualifying captured frame requires a successful
current update, the same sample generation, and unchanged public collection
revisions through the update and completed render. Cleanup restores the exact
owned update descriptor and removes the three owned listeners. The eight-second
settling and 400-ms capture deadlines remain unchanged. Root independently
passes 69 focused tests; formatting, package boundaries and syntax checks pass.

The hosted result includes 15 qualifying observations per renderer: five default
views, five camera-change baselines and five camera-change results. Both observer
lifetimes restore ownership successfully. Both renderers preserve all 4,362
surface identities, and native point/stem picks identify the correct owners.

Root independently decoded all twenty retained PNGs using Python's standard
library, verified PNG chunk CRCs, and compared every decoded pixel. All ten pairs
have **zero different pixels** at 960 by 640, with matching identity, geometry,
style, camera and clock records. This includes the camera-change pair that differed
by 16 pixels in the earlier run. That earlier failed report remains unchanged;
the new result supports the corrected readiness requirement but does not prove
the cause of every historical intermittent failure.

Layer teardown leaves zero layer renderer owners and zero data sources. The
viewer is destroyed. Chrome exits naturally with code zero after 656.1 ms;
the close operation completes after 704.3 ms, without forced termination.
The environment is HeadlessChrome 152, viewport 1200 by 960, DPR 1, and Apple
paravirtual Metal. No latency improvement or physical hardware coverage follows
from this instrumented correctness run.

The [raw report](report.json) is 619,671 bytes, SHA-256
`38491a58dbde43c472d9152c2bddf5ecb7952336c1ae165208448cc47f0e1bca`.
[Independent review](review.json) and [terminal CI metadata](ci-run.json)
preserve the result.

The earlier [benefit comparison](../s54-datacenter-benefit-38205683313/README.md)
still reports a 36.99% slower source-ready phase alongside 22.12% faster complete
activation. Source-ready is measured when `layer.enable()` returns; collection
construction occurs before that return, while Entity visualizers defer more native
primitive work until later updates. This establishes different phase boundaries,
not the exact cost of each operation. The complete first-usable-frame metric is
the comparable user-visible activation measure. The phase regression remains
recorded; its detailed attribution and broader rollout checks remain open.

Separately, all seven standard jobs pass on dev commit
`63b2d8527d3d4be3816d55d69e9ac57c2376f7b0`, including Node 24/26, Windows
onboarding, three-OS recovery and browser journeys. Their
[terminal metadata](standard-ci-dev-38215303033.json) is preserved. That dev
commit does not include this isolated diagnostic.
