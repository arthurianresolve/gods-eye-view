# Cable reference collection experiment

This isolated S54 prototype moves only the 2,629 reference point/stem pairs into owned Cesium collections when the caller explicitly selects `referenceRenderer: collections`. The production default remains Entity rendering. All 1,913 clamped ground cable segments and 1,917 landing pin billboards retain their existing GeoJSON renderers and source picking. Metadata Entities, labels, source IDs and per-kind appearance remain.

[Focused test evidence](review.json) includes complete bundled-source ingestion, native pick mappings, camera sweeps, teardown/re-enable and partial-attachment failures. Collections are explicitly destroyed when removal does not destroy them. These are actual-Cesium Node checks, not rendered, GPU, or performance evidence. Visual equivalence, map-stack/terrain checks and matched activation/retained-memory comparisons are still required before accepting this optimization.
