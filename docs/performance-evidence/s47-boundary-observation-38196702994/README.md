# Dense boundary observation and diagnostic setup cost

[Run 38196702994](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38196702994)
fails at exact application and harness revision
`1b1fdb2648a18e13231617248cfb46b19d493f64`. The baseline build check passes;
the candidate capture fails at its first idle warmup boundary. No measurement
sample completes. This diagnostic does not supersede the earlier dense failure.

The complete [raw report](report.json) has SHA-256
`8b75f8f476d7cddbbfe6c66fc3f03f1ec35998d53957ee461d61da35ba7b3d64`.
The [independent review](review.json) retains the boundary events and cleanup
result. The new per-boundary exposed-function setup consumes 4,075.34 ms of the
unchanged 6,000 ms host window. The host receives page-entry acknowledgement at
4,088.97 ms; page-side listener registration and the render request complete
within 0.2 ms of probe entry. No completed-render acknowledgement or page result
arrives before the host deadline at 6,002.91 ms. These are host receipt times,
not one-way page-entry latency or GPU execution time.

Binding cleanup exceeds its separate 250 ms window and remains unconfirmed in
the report. The wrapper subsequently confirms owned child cleanup; this is not
proof that the binding or render listener was released before page disposal.
The fixture delivers all 2,500 aircraft with no reported page or interception
errors. The renderer is Linux SwiftShader, not physical Windows hardware.

This run exposes a diagnostic setup cost; it does not identify the original
render stall. Install and own the progress binding during document preparation
before warmup, report that setup separately, then observe each boundary without
extending its deadline. Keep the failed evidence and the harness integration
hold. No performance, visual-equivalence or hardware-soak acceptance is claimed.
