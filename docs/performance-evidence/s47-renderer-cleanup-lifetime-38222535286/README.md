# Renderer probe registration lifetime - 12 October 2026

The isolated correction at `3faa0afb894d862f0f8c8c1fdb5254a9feb4d338`
retires the future-document probe registration immediately after its required
navigation. The current document's hook and context-loss listeners remain live
until final cleanup. Repeated removal shares the same pending acknowledgement;
a new installation invalidates an old registration acknowledgement. Late results
remain attached to the original failed record and do not turn it into a pass.
No application runtime, rendering quality, or timeout was changed.

Root independently passed 88 focused tests covering probe ownership, failure
reports, observer identity, comparison contracts, and the capture child process.
The executor also passed the adopted formatter (1,566 files), package boundaries,
import directions, syntax and whitespace checks.

The exact-commit [hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38222535286)
**fails** in baseline cleanup after 66,068 ms. Candidate and harness are both
`3faa0afb`; the baseline application remains `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`.

| Observed phase | Result |
| --- | --- |
| Future-document registration removal after navigation | Confirmed in 889.862 ms; current document untouched |
| Final document cleanup | One-second deadline exceeded (999.598 ms recorded); later completion acknowledged as confirmed |
| Final registration stage | Not reached because document cleanup did not settle within its deadline; the earlier confirmed removal is preserved separately |
| Page errors / interception errors | Both empty |
| Candidate measurements / CPU profiles | Not reached |

This resolves neither the complete cleanup gate nor the dense capture gate. It
shows that the future registration was removed at its intended lifetime boundary,
while the final document operation can itself exceed its deadline. The late
acknowledgement does not include a full late document record; its hook/listener
fields remain unknown, not inferred from earlier runs. The report cannot separate
browser command scheduling delay from cleanup execution cost. That distinction
must be observed before choosing the next ownership correction. Do not relax the
deadline, claim a GPU/driver cause, or promote this result as a performance pass.

The [previous diagnostic](../s47-renderer-cleanup-evidence-38221367337/README.md)
attributed its failure to late registration removal after successful document
cleanup. Both failed results are preserved; this run is not a reclassification
of either earlier failure. The change remains isolated from `dev`.

- [Raw report](report.json): 3,940 bytes, SHA-256
  `52a37e95baeed73eea6de1eda98f52206645bb57974e14fd17206f4d29aa719c`.
- [Terminal workflow metadata](ci-run.json).
- Free hosted SwiftShader integration diagnostic only; no physical Windows or
  matched performance acceptance.
