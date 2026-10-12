# Datacenter picking: all selection-order controls miss the stem

[Run 38208241120](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38208241120)
fails at exact application/harness revision `8ae0a4dd4518bd33811e6bf2d0c73e2f6542be9a`.
It adds an opt-in fixture diagnostic; production rendering and the eight-second
sample gate remain unchanged. Fifty-two independent focused tests, formatting,
syntax and package boundaries pass before this rendered run.

On completed-render revision 22, both visible candidate records receive all
three controls: point then stem before selection, point selection then stem,
and stem only. The ten calls yield four owned point hits and six stem misses.
Capture/start/end render revision, camera position and clock agree, and selection
is restored between controls and afterward. These observations do not support
selection order as the explanation for this failed attempt.

The [last frame](last-frame.png) has a point but no visible stem. Independent
RGBA decoding confirms background color `[0, 0, 127, 255]` at the stem probe
`(480, 300)`. The [prior failed run](../s54-datacenter-layer-id-38205435137/README.md)
eventually captured a visible stem with cyan at the same coordinate. Their
images differ at 236 pixels within `x=478..482, y=278..325`; see the
[pixel comparison](pixel-review.json). This is a diagnostic cross-run comparison,
not a matched visual or performance acceptance pair.

This run completes 18 captures and reports three stable frames, ready geometry
and ready data sources, but the source flags and stable image do not establish
visible stem materialization. The ordinary pick gate still fails after one
attempt. No subsequent-frame diagnostic control completes before its deadline.
The extra native picks also perform internal Cesium work, so their overhead must
not be interpreted as ordinary latency. A later-frame observation and the
actual primitive/worker readiness need attribution; raising the sample deadline
or using these diagnostic calls to satisfy acceptance is not a fix.

Only the Entity control is reached: zero paired samples and zero collection
lifetimes complete. The diagnostic observer is removed, the layer is destroyed,
its data source is removed, the viewer is destroyed and Chrome exits naturally
within 684.1 ms. Renderer: hosted Apple Paravirtual Metal, Chrome 152,
960x640 drawing buffer in a 1200x960 viewport. No physical Windows or final
performance acceptance follows.

The [raw report](report.json) is 68,586 bytes, SHA-256
`3db4cbf1351af02b47c5175a6c1458e245306d720e7dc24a68f219df909ae34f`. The [independent review](review.json)
validates the bounded partial envelope, observed controls, source revision,
image hash and cleanup. [CI metadata](ci-run.json) preserves the failed result.

Separately, all seven [standard dev jobs](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38207294034)
pass at `98a403f28442fcc485435facf7d9980eb01a58ce`;
[their metadata](standard-ci-dev-38207294034.json) is preserved. This dev revision
contains the reviewed recovery/evidence updates and does not include the
isolated datacenter candidate or this new pick diagnostic. Its passing checks
do not validate the candidate or override the failed rendered report.
