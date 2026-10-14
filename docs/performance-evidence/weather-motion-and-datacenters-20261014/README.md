# Weather motion diagnosis and current datacenter correctness

The [weather diagnostic at `4700e9a5`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38518348758)
identifies a benchmark-condition mismatch: all three weather sources have their
three expected history frames, but the timeline maximum is zero and the browser
reports reduced motion. The production weather clock deliberately suspends these
products under reduced motion. The failed report remains failed.

Fix `3cd3e677` pins only ephemeral weather benchmark documents to
`prefers-reduced-motion: no-preference` before navigation. That condition enters
the fixture digest, with observed values at preflight and both sample boundaries.
Follow-up `02edd041` rejects missing, wrong or downgraded observations for the new
fixture identity. Only the exact historical fixture digest can use the older
shape. Production accessibility, visual settings and deadlines are unchanged.
All 81 focused fixture/comparison/CLI checks and 60-file capture lint pass.
Fresh hosted validation of this fix is pending.

The [datacenter run at `954b08f9`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38518566412)
passes the ordinary runtime validator with no diagnostic permissions. Root also
decodes all twenty PNGs, checks their RGBA hashes and verifies ten byte-identical
Entity/collection pairs. Identities, geometry, style, native point/stem picking
and all 4,362 surfaces match. Both lifetimes remove their data sources and
renderer owners, restore observers, and destroy the final viewer. Chrome closes
naturally. The current implementation's five reviewed files remain byte-identical
to the earlier integration; 97 focused infrastructure checks pass.

This is hosted Apple paravirtual Metal correctness evidence. The single activation
diagnostic measures 585.2 ms for Entities and 777.3 ms for collections; it is not an
alternating performance comparison and establishes neither benefit nor a repeatable
regression. The earlier five-pair benefit report retains its original revision and
limitations. Entity defaults remain. Mixed-layer and physical Windows qualification
remain pending; the earlier navigation failure's underlying cause is unresolved.

At `b52c8abb`, [one PR CI matrix passes](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38517121797)
and [the other fails one Node 24 test](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38517119079).
The failure occurs in native `fs.cpSync` while constructing a fresh Cesium source
fixture, before collision assertions. The ordinary suite records 7,937 passes,
one failure and five skips. Both release verification workflows pass. These
outcomes do not establish a complete both-base pass at that revision.

Fix `0533d337` makes that test use Node's JavaScript copy traversal with an
all-accepting filter. It still copies every entry and treats filesystem errors as
fatal, without retries. The focused collision check passes across all five Cesium
distributions. This avoids the observed failing native path; it does not prove the
underlying intermittent filesystem cause. Fresh Node 24/26 CI remains required.

The raw reports and logs retain their original bytes. Downloaded ZIP digests match
GitHub artifact metadata; individual stored files are bound by [SHA-256](sha256.json).
No physical Windows performance, retention or final qualification pass is claimed.
