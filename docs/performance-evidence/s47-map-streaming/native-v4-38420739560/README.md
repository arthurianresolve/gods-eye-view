# Merged candidate passes native map delivery and capture validation

[Run 38420739560](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38420739560)
passes with candidate/harness `4b60f45391561246b891ffd8783c7acc142a227b` and frozen
baseline `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. It uses the free standard
hosted macOS diagnostic backend. The observed renderer is ANGLE Metal on an
Apple Paravirtual device; this is supplemental native integration evidence,
not physical Windows qualification or paired performance acceptance.

Both revisions complete the production photoreal -> Esri imagery -> OSM ->
photoreal route, with every transition ready. Each journey acknowledges 237 of
237 fixture requests, with no missing paths, pending requests or delivery errors
and confirmed cleanup. The corpus remains synthetic v4, selected through
`austin-map-streaming-v1`, with manifest SHA-256
`0d739d9e4830faff2751d40945870eb7b56b9b76dc65e8cd64cb7deb5cb9b033`.

The candidate's additional full capture CLI completes its four samples and now
passes outer ownership validation. Its two owned documents acknowledge 23 startup
requests and 237 main-document requests (260 total), with no pending or missing
requests. This validates the reviewed shared-document topology correction.
The [preceding run](../native-v4-38416400160/README.md) remains failed; a new run
at a corrected revision provides this pass.

Manual density remains 75%, resolution scale 1, antialiasing enabled and MSAA 4.
No map detail, drawing-buffer preservation or cache limits were reduced. Fault
and recovery controls, repeated-switch retention, matched Windows measurements
and the complete hardware soak still require their own evidence. No S47/S57
engineering or hardware closure is inferred from this healthy-route smoke.

Artifact 11827376312 contains the original reports; their bytes are preserved:

| Artifact                                                                                |  Bytes | SHA-256                                                            |
| --------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Outer report](performance-build-smoke.json)                                            | 356736 | `d3bb37cc6a03890083655a769c52cb23e33271964491cd63bc5d1e92127f5146` |
| [Candidate CLI sidecar](performance-build-smoke.json.capture-cli-report-candidate.json) | 392529 | `5a80ba6d7e464e52f83138295becdc264af2cfb15d5b91d7f8b2e7cfd1dfd8a6` |
| [Run summary](run-summary.json)                                                         |   7024 | `f707c45ab9eb78bb5e570e819fc0112da5e85bcfcb55e737ea68897551912055` |
