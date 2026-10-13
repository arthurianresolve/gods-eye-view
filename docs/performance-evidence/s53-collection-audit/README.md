# Satellite collection mutation audit

The existing scratch change reduces returned Cartesian objects and attempted
setter calls. It does **not** establish fewer GPU uploads. Root compared the
actual production core/dense propagation factories before `d8ce27b1` (`510ed8d4`)
with QA `75cf32fe`, using actual Cesium 1.138 point primitives and deterministic
position inputs. Final coordinate hashes match in all four cases.

| Case                       | Population / passes | Distinct returned Cartesians, before → after | Position setter calls, before → after | Cesium dirty notifications, before → after |
| -------------------------- | ------------------- | -------------------------------------------- | ------------------------------------- | ------------------------------------------ |
| Core, unchanged positions  | 840 / 10            | 8,400 → 1                                    | 8,400 → 0                             | 0 → 0                                      |
| Core, moving positions     | 840 / 10            | 8,400 → 1                                    | 8,400 → 8,400                         | 8,400 → 8,400                              |
| Dense, unchanged positions | 10,000 / 300        | 10,200 → 1                                   | 10,200 → 0                            | 0 → 0                                      |
| Dense, moving positions    | 10,000 / 300        | 10,200 → 1                                   | 10,200 → 10,200                       | 10,200 → 10,200                            |

The dense round-robin processes 34 positions per pass. Cesium's own position
setter already rejects equal Cartesians before marking the collection dirty.
The application comparison avoids entering that setter; its scratch object avoids
returning a new Cartesian for each conversion. No WebGL context was created,
so actual upload counts/bytes and latency remain unavailable. This is a component
identity/mutation audit, not the S47 baseline comparison, allocation-byte profile
or physical Windows evidence. Source hashes, engine source hash and all counters
are retained in [the original report](report.json).
Its SHA-256 is `62805e4cad664a180d34c3700376f2ecc362b10035784716020521cbaaff3017`.

The current collection also mixes opaque core colors, 0.9-alpha dense points,
the ISS's 0.3-alpha outline and dynamic focus fades. An opaque-only specialization
cannot be assumed compatible. The existing mixed blend mode stays in place;
neither this source audit nor the rejected [collection split](../s53-bounds-attribution/README.md)
supplies a passing blend-specialization experiment.

S53 remains partial. Remaining work includes the aircraft and membership paths,
the bounded allocation/upload comparison and a supported blending disposition.
This audit makes the retained scratch optimization's claim precise and supplies
an unchanged-coordinate control for further work. It changes no application code.

Reproduce from the repository root:

```sh
node docs/performance-evidence/s53-collection-audit/reproduce.mjs
```

The script reads both immutable production modules from Git and uses current
dependency modules for the narrow propagation paths. It does not execute source
fetches or alter tracked runtime files. A new run reports its actual current SHA.
