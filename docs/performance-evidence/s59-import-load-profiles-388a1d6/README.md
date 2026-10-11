# S59 isolated import loading profiles

Both diagnostics passed at `388a1d69bde81ef1865cf7c237cebe55e26bed8a`:
[CPU run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38151772176)
and [sampled-allocation run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38151912129).
Each warms the fixture, loads 5,000 points once, stops profiling, then captures
and tears down. Both retain the complete population, pass the 12 capture-matrix
checks, produce the same final pixel digest, report no page errors and close
the owned browser naturally. Root recomputed the CPU summary from its retained
normalized profile and checked both report contracts and exact source commits.

The CPU profile spans 639.765 ms, including control clicks and polling around a
212.8 ms load. It has only 54 samples. `(program)`, garbage collection and idle
stacks have approximately 386.1, 100.5 and 63.7 ms of sample weight respectively;
these are statistical weights across the entire profile window, not execution
times attributable solely to loading. `createEvidenceEnvelope` is the highest
sampled application callsite (six samples, about 30.7 ms of weight). Cesium event,
entity, graphics and geometry-updater construction also appear.

The separate heap profile reports approximately 96.4 MB of sampled allocation
estimates across 5,779 samples. Leading grouped callsites include `Map` (27.6 MB),
`GeometryUpdater` (11.4 MB), `Event.raiseEvent` (8.7 MB), `Set` (7.9 MB) and
`GeometryUpdaterSet` (7.8 MB). `createEvidenceEnvelope` accounts for about
2.9 MB. These allocations include collected objects; they are not retained heap,
GPU memory or exact byte totals. Only the top 30 of 111 heap callsite groups are
retained, so that summary cannot reconstruct the omitted source tree.

This evidence prioritizes investigation of entity and updater construction over
assuming that small envelope-array savings solve the import stalls. It does not
prove a particular engine defect or establish any speedup. All profiler output
is explicitly ineligible for performance acceptance. Windows hardware validation,
the four-millisecond batch target, interaction targets and a retained-memory
plateau remain open. Hosted Apple paravirtual Metal is supplemental evidence.

The raw reports and run metadata are preserved here. [review.json](review.json)
contains the exact artifact hashes, verification scope and remaining limits.
