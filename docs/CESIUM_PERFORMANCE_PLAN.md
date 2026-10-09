# Cesium performance plan

This document tracks S47-S60. It is separate from the historical S32-S46
acceptance ledger: an implementation can be complete while hardware or manual
validation remains pending.

| Slice | Code implemented | Automatically validated | Hardware validated |
| --- | --- | --- | --- |
| S47 baseline and comparable capture | implemented | harness syntax and full suite pass; live matched captures pending | pending |
| S48 attribution and resource diagnostics | implemented | snapshot/monitor tests pass; full suite and build pass | pending |
| S49 worker/lifecycle retention | implemented for application-owned GeoJSON and cable races | lifecycle/CCTV tests and full suite pass; 60-minute retention soak pending | pending |
| S50 geometry coalescing | implemented for CCTV queue cursor and latest-result ownership | CCTV cursor/queue tests and full suite pass | pending |
| S51 render demand scheduling | implemented | governor tests pass | pending |
| S52 overlay invalidation | pending | pending | pending |
| S53 collection uploads | implemented for satellite position scratch reuse and unchanged-write suppression | satellite catalog/tracking tests and full suite pass | pending |
| S54 infrastructure batching | pending | pending | pending |
| S55 tracking updates | existing cached-frame path retained; no new camera ownership change | satellite tracking tests and full suite pass | pending |
| S56 fresh-frame capture | implemented | fresh-frame/listener cleanup tests and full suite pass | pending |
| S57 map-resource lifetime | pending | pending | pending |
| S58 weather/effects | pending | pending | pending |
| S59 cooperative ingestion | pending | pending | pending |
| S60 final candidate | pending | pending | pending |

The visual default remains Manual. Resolution, MSAA, label density, source
populations, tracking behavior, effects, and visual fidelity are not reduced as
a performance shortcut. Auto quality remains opt-in.

## Measurement contract

Performance reports include the application and harness revisions, fixture
identity, camera path, browser and renderer, viewport and drawing-buffer sizes,
device pixel ratio, effective visual settings, layer populations, warmup, and
the measurement window. A report with mismatched fixture, settings, renderer,
or camera path is not a baseline comparison.

The long soak is accepted only when application-owned listeners, pending jobs,
scene resources, and post-GC retained heap return to their warmed baseline at
equivalent checkpoints. Forced-GC and allocation tracing are diagnostic runs,
not latency measurements. Missing Windows/macOS GPU evidence remains pending.

The current code milestone covers the measurement and ownership foundations:
elapsed-time capture routes, settings/population guards, bounded performance
snapshots, renderer and drawing-buffer metadata, scheduled render updates,
application-owned stale-load cleanup, cursor-based CCTV preparation, and
post-render frame copies with `preserveDrawingBuffer: false`. No visual default
was reduced. The remaining slices are gated on measured costs; they are not
marked implemented by inference from this foundation.

## Current evidence

The previous Intel UHD 620 rendered soak completed its operations but retained
listeners grew from 732 to 11,982 and heap grew from 67.8 to 153.2 MB. The heap
snapshot contains worker message listeners retaining promises, primitives,
entities, and old GeoJSON data sources. This is the first remediation target;
the report does not yet prove whether the origin is application cleanup, fixture
interception, or an engine task that never settles.
