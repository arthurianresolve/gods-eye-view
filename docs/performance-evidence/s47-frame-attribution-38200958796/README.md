# Dense frame attribution: audit race before measurement

[Run 38200958796](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38200958796)
tests application and harness `827223f5fafe71ec24db89096d0a3d0fe2ff812f`
with the new opt-in bounded scene-frame observer. The run **fails before that
observer is installed**, during preparation of the first idle document. It
provides no new motion attribution or performance acceptance.

The complete [raw report](report.json) is 36,399 bytes, SHA-256
`d08137cea2f4ec6f36eb7315f55837590271647e58cca50cd32a39e41c8e8d7f`.
[Independent assertions](review.json) verify the revision, failed phase,
population observations and restoration counts against the downloaded bytes.
[CI metadata](ci-run.json) binds the failure to the exact commit.

The frozen baseline build and inspection pass. The candidate supplies all
2,500 aircraft, 4,362 datacenters and 716 dams, but completes no timed samples.
Its worker audit validates 12 created script blobs, then observes 14 when
restoring its wrapper. Native `createObjectURL` restoration and an empty
registry are both confirmed, with zero overflow. No page or interception
errors are recorded. The embedded failure report is not truncated.

Source review finds that diagnostic mode reads metadata and asynchronous blob
bodies before a separate restoration call. Unlike the existing prewarm path,
these operations do not share one frozen snapshot. The count mismatch is
consistent with additional worker creation in that gap, and the guard correctly
rejects the inconsistent audit. It is not evidence of failed registry cleanup,
an application worker leak, or the cause of the physical Windows frame stall.

The next fix must reproduce this race and make the diagnostic snapshot and
restoration atomic while retaining body, byte-limit and worker validation.
An unchanged retry would not resolve it. The scene observer and post-cleanup
failure-report refresh pass focused tests; the latter is exercised in this run.
Renderer defaults, populations and deadlines remain unchanged.
