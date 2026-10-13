# Empty-fleet baseline reaches terminal ownership checks

[Run 38456481165](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38456481165)
tests clean immutable application/harness `ed825bd3e3945a672d0a5d8ae404c02b36f52369`
on hosted Linux SwiftShader. Both mixed-use and durable workspace journeys pass.
The new probe reaches its terminal predicate and remains **failed**.

It records **27 completed renders over ten foreground seconds**, with continuous
`flights`/`military` holds and zero records. The 189 map requests stay unchanged,
all are intercepted, no requests or tile work remain pending, and camera,
Manual settings, population/health and source identity stay matched. Separate
receipt-time validation passes. Simulated hide/resume stops the loop and produces
a new frame. Source-finish verification confirms no tracked changes during the run.

Teardown destroys the viewer and removes all layer owners, render holds,
scheduled wakes, production handles, credits and postRender listeners; there are
no reported teardown errors. **One canvas remains** (eight existed beforehand).
The current zero-total-canvas gate fails alongside the expected idle-frame
failure (27 > 2). The report does not identify that canvas, so its ownership is
unresolved here. Static CCTV host markup is a source-backed hypothesis requiring
an identity check, not permission to ignore arbitrary remaining canvases.

The raw failure projection also labels `tileContentReady` from Cesium's
`tilesLoaded` flag while content is deliberately blocked. The explicit
`contentReadiness: blocked-by-fixture` is authoritative: this run does not verify
imagery delivery, rendered visual equivalence, GPU speed or physical Windows.
The contradictory derived label needs correction in the harness.

Artifact **11843936150** has verified ZIP SHA-256
`05b8083a15a110163b75dbcab7267167121f6b8e4fcb136a5424f5f6bf1481ae`.
All six names were verified before extraction; [files.json](files.json) binds
the ten retained files. Earlier failed reports remain unchanged. The conditional
fleet-hold runtime is not included in this baseline.
