# ADR 001: Keep observation evidence separate from presentation and storage

- **Status:** accepted for S00–S07 implementation
- **Date:** 2026-10-08
- **Baseline:** `3f73b92dc61d582afad70a39b14f30bea1a0ab95` on `dev`

## Decision

Represent source observations with a versioned, plain-data evidence envelope.
Keep provider observation time, browser receipt time, display time, and forecast
valid/issue times separate. Missing source times stay null. Rendering may use a
receipt-time fallback to animate a record, but that fallback is never evidence
of when the source observed it.

Feed health remains a derived state from `layerFeedState`; it is not copied into
the observation method. `partial` and fallback are explicit states. Query
results carry a compact reference plus bounded count and coverage scope.

S00–S07 add no recording or persistence. Evidence metadata is in-memory and
read-only; local retention and transactional storage require their later
dedicated slices and per-source policy review.

## Consequences

- Existing record and layer identifiers remain stable.
- Source links are HTTPS-only and have credentials, query strings and fragments
  removed before display.
- Unknown source accuracy is displayed as unknown; no confidence value is
  inferred.
- Interpolated/dead-reckoned display positions point back to the source fixes.
- Performance captures must include the browser, renderer, viewport, device
  pixel ratio, visibility, workload duration, and live object counts. Software
  rendering cannot establish hardware budgets.

## Rejected for this milestone

- Replacing Cesium's clock with a shared investigation clock.
- Persisting observations before retention and storage boundaries are defined.
- Conflating a current cached response receipt with provider observation time.
