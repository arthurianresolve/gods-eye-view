# S47 atomic worker audit: late target observation

[Run 38202268223](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38202268223)
tests application and harness `6ca6373ed5b37e728bd197955b2b36dbc7bfa312`.
The baseline build/inspection passes, but the candidate fails during preparation
of its first idle document, before any timed sample or frame observer is installed.
The diagnostic mode and dense fixture are unchanged from the previous failure.

The atomic read/restoration repair resolves the inconsistent counters observed
in [run 38200958796](../s47-frame-attribution-38200958796/README.md): both the
frozen snapshot and restoration count fourteen blobs. Native `createObjectURL`
restoration succeeds, the registry is empty, and neither inventory overflows.

The new guard instead fails because one worker target becomes observable after
the frozen boundary; no additional blob request is observed. The artifact's
`validatedCreatedScriptBlobCount` is **null**, because execution stops before
body validation completes. Consistent counters are not proof that executable
code validation passed.

This failure needs a narrower test of target publication order. A delayed target
may reference an already-frozen wrapper, whereas a newly created, unrecorded
wrapper must fail. The current count-only failure artifact does not distinguish
those cases. A correction must validate exact target URLs against frozen,
byte-validated wrapper records, while retaining failures for unknown targets,
body/hash/source mismatches, overflow and incomplete cleanup. No deadline or
visual setting was changed and this run was not retried unchanged.

The full raw artifact is [report.json](report.json), 36,713 bytes, SHA-256
`27abcacd562a13f82edc3537b7be7400c30b03b8d8e8ee3737cc746b17876019`.
[Independent review](review.json) and [job metadata](ci-run.json) retain the
failure. This is hosted SwiftShader diagnostic evidence, not physical Windows
GPU evidence, a rendering root-cause finding or a performance acceptance pass.
