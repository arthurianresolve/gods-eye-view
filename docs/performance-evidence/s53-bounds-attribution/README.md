# Point collection split: image difference attributed to command bounds

The mixed-versus-partitioned comparison remains **failed**. No collection split,
private command override, Cesium upgrade or visual-setting change is accepted in
production. The existing single collection and accepted scratch/write reuse stay
in place.

The diagnostic at [`4d39fed`](https://github.com/arthurianresolve/gods-eye-view/commit/4d39fedd3d3da6f54c5c9dcfaeb823d1a8c30e7b)
reproduces exactly the earlier 24 changed pixels. Independent PNG decoding finds
both images byte-identical to the historical `9dacb7c` pair. All 10,840 positions
and the projected point neighborhoods match. Order-independent translucency
(OIT) is **active** in both captures; a fallback sorting explanation is therefore
unsupported. [Raw report](command-report.json), [independent review](command-review.json),
[run 38107644255](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38107644255).

The next isolated diagnostic at [`c5889ef`](https://github.com/arthurianresolve/gods-eye-view/commit/c5889ef0046f8ca05e2f2cd0321e2038a58d7f74)
changes only the split collections' emitted command bounds, **after** timing and
submission measurement. It uses the original mixed collection's measured bounds
for one completed-frame capture, then restores natural bounds for another.
The original unmodified comparison still fails its exact-image gate.

| Capture | Fitted near / far planes | Difference from reference |
| --- | --- | --- |
| Mixed, natural bounds | 42919.376669 / 126464.149663 | Reference image |
| Split, natural bounds | 44410.056221 / 124958.563316 | 24 pixels; maximum channel difference 36 |
| Split, original mixed bounds | 42919.376669 / 126464.149663 | Zero pixels versus mixed |
| Split, restored natural bounds | 44410.056221 / 124958.563316 | Zero pixels versus original split |

[Independent decoding of all four PNGs](bounds-review.json), reproducible with
[the read-only verifier](verify-bounds-report.mjs), verifies those results.
OIT remains active, positions and projected neighborhoods match, and
all command metadata belongs to the exact copied render frame. Resolution scale
1, MSAA 4, antialiasing, 640×360 drawing buffer, colors, point populations and
framebuffer preservation remain unchanged.
[Raw report](bounds-report.json), [run metadata](bounds-run.json),
[run 38108076172](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38108076172).

This establishes the command-bound/frustum dependency for this fixed fixture.
It does not identify the exact GPU arithmetic instruction or establish an engine
defect. Cesium 1.138 derives fitted frustum planes from visible command bounds in
`View.createPotentiallyVisibleSet`; changing collection boundaries changes those
bounds. The experiment demonstrates why the proposed split cannot currently
pass the agreed visual gate. Overriding Cesium's internal command bounds is a
diagnostic control, not a supported application fix. No failing pixels are masked
and no comparison tolerance is relaxed. Further work should evaluate a different
representation or an explicitly supported engine contract, rather than repeatedly
retrying this unchanged split.

Both runs use the free standard hosted Mac job, Chrome 152 and Apple paravirtual
Metal. They are supplemental accelerated-rendering evidence, not physical Windows
or Mac desktop coverage. Both jobs exit failed because the original comparison
fails; capture/import prechecks pass and owned browsers close normally. No full
application speedup, GPU execution time or S53 completion is claimed.

The fixture also fixes diagnostic ownership: command metadata is captured in
the same `postRender` as the image and bounded while collected. Its canvas,
listeners and timers are released when metadata fails, capture returns no frame,
or rendering times out. [Four focused controls](capture-behavior.json) run the
actual capture function; [the verifier](verify-capture-behavior.mjs) accepts the
fixture source path as its argument. These are mocked lifecycle tests, not GPU
evidence. Reproducible fixture source remains on the isolated QA branch.

[Artifact hashes](artifact-hashes.json) bind the reports, reviews, tests and
byte-preserved job logs. `command-job.log.gz` and `bounds-job.log.gz` are lossless
gzip copies; the manifest records both compressed and decoded hashes.

**Disposition:** reject the current natural-bounds collection split as a runtime
optimization. S53 remains partial: scratch/write reuse is implemented; other
membership, tracked-object and upload opportunities still require evidence.
