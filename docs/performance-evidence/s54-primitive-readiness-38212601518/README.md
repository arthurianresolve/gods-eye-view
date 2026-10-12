# Current primitive diagnostic and comparator repair

[Run 38212601518](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38212601518)
tests exact application/harness `7a169618e5036a14b56b861bba2640e6ff2bff72`.
The opt-in diagnostic has 48 independently passing focused tests. It inspects
bounded public primitive ownership only after a failed sample gate, can attempt
one ordinary 400 ms completed-frame capture afterward, and cannot rescue the
failed gate. The production capture API and eight-second sample gate are
unchanged. Unsupported owners remain unknown; no private Cesium indexes are read.

The hosted run **fails**, but this time both renderer lifetimes complete all ten
samples with native point/stem ownership and successful teardown. The earlier
readiness failure does not recur. Both diagnostic lifetimes are `not-triggered`:
there are no current-primitive snapshots and no post-failure frame observations.
This result does not explain the earlier readiness failure.

The first reported failure, `default-style pair 1 baseline/candidate evidence
differs`, exposes a fixture defect. Its local comparator compared the entire pick
record, including `Primitive` / `PolylineColorAppearance` in the Entity renderer
and `Polyline` / null in the collection renderer. The existing shared validator
already compares datacenter picks by stable feature identity, screen position,
layer, kind and verified native ownership. Different renderer implementation
metadata should not reject an otherwise equivalent pair.

Repair [`24bebb1b`](https://github.com/arthurianresolve/gods-eye-view/commit/24bebb1b3598e590e5c3529fca5e1f58ef170130)
removes the duplicate comparison and uses that shared validator. Fifteen focused
tests pass independently. Replaying this raw report through the shared comparator
still **fails at camera-lod-update pair 1**, because a real image difference remains.
No hosted rerun or performance acceptance is claimed for the repair.

Independent Sharp decoding checks all twenty PNGs and verifies their RGBA hashes:

| Captures | Image comparison | Other recorded inputs |
| --- | --- | --- |
| Five default-style pairs | All five byte-identical | Matching identity, geometry, style, camera, clock and picked feature identities |
| Camera/LOD pair 0 | 16 different pixels, bounding box x=478..482, y=277..280 | The same recorded inputs match |
| Camera/LOD pairs 1-4 | All four byte-identical | The same recorded inputs match |

In the differing area just below the point, the Entity image contains background
pixels where the collection image contains cyan stem pixels. Delayed replacement
of Entity stem geometry is a hypothesis, not an established cause. A subsequent
diagnostic should distinguish currently materialized geometry at the first camera
sample from the latched display-ready flag, without adding updates or weakening
pixel equality. The exact comparison continues to reject this difference.

All four source/harness dirty/changed flags are false. Both data sources and
renderer owners are removed; the viewer is destroyed. Chrome exits naturally
with code 0 in 386.7 ms. The environment is hosted Apple Paravirtual Metal,
Chrome 152, viewport 1200x960 at DPR 1, drawing buffer 960x640. It supplies no
physical Windows, motion-performance or full-soak acceptance.

The complete [raw report](report.json) is 546,151 bytes, SHA-256
`31728367ecf7397a76d237d9a8cd892c7057c92ed8c130930c9b30f3591549bf`.
[Pair review](pair-review.json), [independent review](review.json), and
[CI metadata](ci-run.json) preserve the failed outcome and its limits.
