# Aircraft fleet audit root review

Clean source `510334331a5c2c6b40694beb5808ad7b2395d262` passes 15 focused
snapshot/fleet/recession tests and the 34-file capture no-undef check. The
[report](audit.json) binds the complete fixture, ten source files, lockfile and
installed Cesium 1.138.0 package. All source hashes were verified after execution.
The fixture SHA-256 is `dad71af75e22b686aacbf87425dd463e5fb8afa5d98bbcc5a714455371798eac`.

Both real fleet producers retain all six billboard identities across five
stages with seven records: initial due tick, 40 ms skip, 80 ms due tick,
equivalent warmed repeat and a changed moving input. The skipped stage makes no
setter calls and no dead-reckoning call. Warmed unchanged stages make zero
position/color/scale/rotation/image assignments. Existing show assignments remain,
including the billboard/model handoff; changing them has no established measured
benefit. A 10 m changed input produces one position write. Each layer passes one
scratch result object to twenty calls of the deterministic motion collaborator.
That is an argument-identity observation, not a general allocation count.

The equal-cardinality removal/re-add control changes identity and is detected.
Owned collections are emptied/destroyed after success and injected setup failure;
the receipt clock is restored. Root correction binds cold-stage witnesses to the
saved cold observation and resets setup time independently for each layer.

There is no WebGL context, real model loading or production focus transition in
this fixture. GPU uploads, timing, general allocations and rendered equivalence
remain unavailable. The [S53 engineering review](../../closure-audit-20261013/s53-review.json)
combines this audit with the separately retained satellite measurements and
rejected split experiment; final physical qualification remains pending.
