# Imported point representation: failed ownership evidence

[Run 38155141281](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38155141281)
tests exact QA revision `b0c09ce85105717fba47c68129101fcf3d0a09e0`.
The comparison failed. This opt-in prototype is not accepted for dev.

Both browser fixtures completed, including twelve fresh-frame capture checks
per renderer and mixed point/line/polygon native picking. Independent decoding
of all 22 embedded PNGs verifies their recorded RGBA hashes: ten dense captures
and one mixed capture match exactly between representations. The mixed image
was also inspected visually. Its three native picks resolve the intended Entity
IDs; geometry rows and their hashes match. Mixed readiness took 3,413 ms for
Entities and 998.2 ms for the point collection, both within the unchanged
ten-second setup deadline. These are correctness observations, not paired
performance measurements.

The strict comparison correctly rejects two fixture defects:

- Every dense point-state snapshot reports `layer is not defined`. The helper
  reads a layer variable outside its lexical scope, leaving identity, draw order
  and native-pick evidence unavailable.
- The Entity resource census reports zero point primitives because it does not
  inspect the collection owned by EntityCluster. The candidate census finds its
  directly owned 5,000 points. Feature counts cannot substitute for the missing
  primitive count.

[Raw Entity report](import-point-entity.json),
[raw collection report](import-point-collection.json),
[failed comparison](import-point-representation-comparison.json), and
[independent review](review.json) preserve this result. PNG witnesses remain
embedded in the raw reports; decoded copies are in `decoded/`.

Chrome 152 used hosted Apple paravirtual Metal at a 640 by 360 drawing buffer,
with antialiasing, MSAA and framebuffer preservation unchanged. Renderer order
was Entity followed by collection, with five internal sync/cooperative pairs
each. This is neither five alternating renderer pairs nor physical Windows
evidence. No speedup, retained-heap plateau, production acceptance or completion
of S59 follows from this failed gate. Later corrected runs must keep this result
separate.
