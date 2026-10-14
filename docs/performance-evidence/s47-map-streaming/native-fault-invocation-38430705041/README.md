# Rejected map diagnostic invocation

[Run 38430705041](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38430705041)
tested setup at `c7c47245f96e4839312983e8bcbba1da57948b4e` and failed before a
browser or application build was started. Root supplied `receipt-only` worker
auditing with `austin-map-streaming-v1`. The existing CLI restricts that audit
mode to the Austin operating fixture and correctly rejected the combination.

This is an invocation error, not a rendered map or application failure. It
remains failed. The original uploaded [setup report](performance-build-smoke.json)
is preserved byte-for-byte (SHA-256
`54dbef102dad4e3a55f7e383a7f06d0bb0eb7c9861376e2737cf5167a4e4a1e4`)
from artifact `11830806374`.

Root checked the preceding successful map run's actual inputs: its audit mode
was `diagnostic`. [Corrected run 38430980703](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38430980703)
uses that mode on the same immutable candidate, with no source or gate change.
Its outcome must be assessed separately. The independent standard CI run is
[38430700214](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38430700214).
