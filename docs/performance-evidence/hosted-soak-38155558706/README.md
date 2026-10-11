# Historical accelerated retention run

[Run 38155558706](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38155558706)
tested `26f383edc0a960a58db94e7abcbb24c795fe8a83` for 3,606,918 ms.
The [original report](raw.json), [workflow record](ci-run.json), and
[independent review](review.json) are preserved without adding missing provenance.

All 252 mixed-use cycles complete: 1,008 source toggles; 252 replay seeks,
imports, archive failures and camera recoveries; and 504 workspace openings.
Thirteen post-GC checkpoints retain the same 40 application-resource gauges,
with no gauge above its warmed baseline. Initial/final browser listener counts
are both 629. The Performance-domain listener census ranges from 629 to 637;
the separately sampled DOM counter ranges from 629 to 646. Final worker pending is
zero, and no checkpoint has a worker task aged ten seconds or more.

Retained heap starts at 72.00 MiB and ends at 78.56 MiB. The conservative final
window starts at the checkpoint preceding the last 30 minutes (1,518,405 ms);
its maximum growth is 1.568%, within the unchanged 5% limit. Forced-GC retention
measurements do not establish latency or GPU execution performance.

This is Chrome 152 on the free hosted Apple M1 Virtual/Apple paravirtual Metal
runner. It is supplemental accelerated evidence, not physical Windows or desktop
macOS coverage. Its commit predates imported-point collection integration.
The raw report also lacks harnessCommit and source-cleanliness fields required
by the final candidate reader. The workflow identifies the source externally,
but this archive does not invent those missing measurements. Current-candidate
acceptance remains pending; future captures now check and record provenance.
