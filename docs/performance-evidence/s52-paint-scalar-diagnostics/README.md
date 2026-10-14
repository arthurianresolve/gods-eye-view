# Conditional-paint scalar diagnostics

These unpublished experiments follow the rejected paint allocation trials.
The scalar-buffer version is rejected for both allocation regression and a
reproduced correctness failure. Production `worldOverlay.js` is unchanged.

`review.json` independently verifies all raw worker outputs, recomputes the
reported heap-delta summaries, compares 296 source files per variant, and
records 88 passing focused checks with the new low-opacity regression test.
Raw bytes and source snapshots are included; these are Node diagnostics,
not browser painting, GPU, full-scene latency or performance acceptance.

| Control | Median bytes per frame |
| --- | --- |
| Cable reference, reuse forced off | 21,198.67 |
| Same reference, scalar snapshot group omitted | 17,846 |
| Complete named-field reference, cable | 21,398.67 |
| Complete scalar-buffer prototype, cable | 21,792 |
| Complete named-field reference, infrastructure | 43,984 |
| Complete scalar-buffer prototype, infrastructure | 44,548 |

All omission controls force shared-canvas reuse off identically, so an earlier
cache comparison exit cannot explain their differences. They retain 160 cable
candidates and 96 painted entries. Omitting snapshot inputs is diagnostic only;
it is not a proposed implementation. The paired infrastructure controls retain
320 candidates and 192 painted entries. Allocation measurements use 3,000
warmup frames, six stabilization chunks and ten 48-frame measurement chunks.

A narrower follow-up isolates the contribution to the keyhole-opacity call and
stored result: omitting that one assignment reduces the median to 17,846 bytes,
while omitting the other seven numeric writes or the key/lane/selection/corner
writes leaves it at 21,198.67 bytes. Four interleaved full references have the
same median. `keyhole-review.json` reconstructs every omission source exactly and
independently verifies the raw results. This identifies the expensive path;
it does not establish a JavaScript engine mechanism or justify removing opacity.

The scalar-buffer prototype moves keyhole opacity into a numeric buffer but
leaves cached hit publication reading the removed object field. Its resulting
`NaN` bypasses the paint threshold. The failure control reproduces an invisible
entry becoming actionable on the second stable frame: the named-field reference
passes, while the scalar-buffer prototype fails. The checked-in regression also
covers visible recovery and returning to low opacity.

To reproduce the failure control, use Node 24.16.0 and a disposable checkout of
`698752adcd27b59040affc0d0a1a9bd643025833` with locked dependencies. Copy either
`reference-worldOverlay.js.txt` or `rejected-scalar-worldOverlay.js.txt` to
`src/overlays/worldOverlay.js`, and copy `low-alpha-full-test.mjs.txt` to
`src/overlays/worldOverlay.test.mjs`. Run:

```text
node --test --test-reporter=tap --test-name-pattern="root cached-paint low-alpha" src/overlays/worldOverlay.test.mjs
```

The raw logs and exact hashes are in `low-alpha-review.json`. The diagnostic
runners are also preserved as text with their original paths and input hashes.
Their omission variants must never replace application source on a deployment.
