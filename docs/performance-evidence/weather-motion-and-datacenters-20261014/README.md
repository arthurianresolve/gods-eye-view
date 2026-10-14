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

## Follow-up at 6263fb70 and 1fef88b3

The [first motion-fix run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38519947619)
fails before timeline validation: the new diagnostic writes to a cleared
`failureProgress.current` record. Both Node versions also expose four failures
because the shared paired-report test producer still emits the old weather-clock
shape with the new fixture identity. These are introduced harness/test defects;
the strict evidence validator correctly rejects the incomplete synthetic reports.
The Cesium copy-path check passes on both Node versions in this run.

Correction `1fef88b3` records diagnostics only when a sample is owned and updates
the shared paired-report producer to the complete current format. The null-state
regression and all affected comparison/candidate consumers pass: 150 focused tests,
zero failures, plus 60-file capture lint. The next
[weather run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38520776837)
tests this exact source. It completes both 60-second captures but fails the outer
validator on its outdated preflight timestamp sequence; the failed originals stay failed.

A fresh remote read still finds fork main `9beadbda`, fork dev `e8ccc268` and
upstream main `132b9e96`, already contained in QA. No new reconciliation is needed.

## Completed captures and current correction

The second weather run records all three history frames for all three sources,
verified build identity before and after both samples, 248 fixture fulfillments,
and no routing errors. Its actual timeline journey is latest startup, all three
history phases in order, then latest reset. The wrapper incorrectly expected the
older four-observation journey. Correction `ea1692e8` requires the actual five
observations and rejects missing, reordered and wrong-source observations.

[Independent replay](weather-1fef88b3-replay.json) passes the saved CLI report
through that corrected validator and rejects three corrupted controls. The replay
uses the receipt digest recorded in the capture; receipt bytes were not separately
downloaded. It remains comparison-ineligible diagnostic evidence. The original
hosted workflow remains failed; a new end-to-end hosted pass is required.
All 150 affected fixture, CLI, paired-report and candidate-consumer tests pass,
along with capture lint. Raw producer and wrapper reports are preserved here.

Both PR matrices at `6263fb70` finish with the same four shared weather test-fixture
failures on Node 24 and 26. Each ordinary suite records 7,942 passes, four failures
and five skips. The other five jobs on each base pass: Windows onboarding,
Windows/Linux/macOS recovery, and the Street Level browser gate. Both release
verification runs stop at source verification on those same four tests, before
artifact attestation or downloaded-release validation. The correction in `1fef88b3`
updates the shared fixture instead of weakening the validator. Final job records
are preserved, and fresh both-base integration is required.

Workspace changes `533cdf3f`, `af1895df` and `7947e0c5` coalesce refreshes, preserve
only same-workspace valid selections, suppress unchanged option writes, and reject
stale completions. The broader import/workspace integration suite passes all 68
checks, including same-ID cross-workspace races, obsolete failures and disposal.
These behavior checks are not a browser responsiveness or throughput claim.
