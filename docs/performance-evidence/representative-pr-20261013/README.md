# Representative integration PRs against dev and main

The two draft PRs test QA source head `44c6532d58c4c5c1bef9339d31c6d7de74422a72`.
Their checked-out revisions are GitHub's synthetic merge commits, not that head.
The retained [source binding](source-binding.json) verifies that all three Git
trees are identical (`beeb275ac50d58aab66e9225eb92e5df04a78d56`). The different
outcomes below therefore do not establish a conflict with either base.

| Target | PR and tested revision | CI | Release artifact verification |
| --- | --- | --- | --- |
| dev `e8ccc268` | [PR #3](https://github.com/arthurianresolve/gods-eye-view/pull/3), `9f71970d042bce935986a97366ca49677f423530` | [38442178437](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38442178437): six selected jobs pass; Windows recovery prerequisite fails | [38442178374](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38442178374): upload succeeds, artifact lookup by name fails |
| main `9beadbda` | [PR #4](https://github.com/arthurianresolve/gods-eye-view/pull/4), `59e2267beabd3120b6360303d5eb9792646b8be4` | [38442186908](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38442186908): all seven selected jobs pass | [38442186905](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38442186905): staged and downloaded archive, checksum, source commit and attestation checks pass |

PR #4 is validation-only; this packet does not authorize merging development into
main. Neither PR publishes a stable release. Dev and VM105 have not been promoted.

## Published layer tokens and recovery

Both Node 24 and Node 26 jobs pass for each base. The preserved Node 26 job logs
bind their checkout to `refs/remotes/pull/3/merge` or `/4/merge` and show the actual
`BASE_REF`. Each reports **29 published layer tokens, zero new allocations**
against `origin/dev` or `origin/main`, respectively. These are representative
PR-only checks, beyond the earlier dispatch runs that skipped this step.

The [recovery review](recovery-review.json) rechecks all 25 successful persistence
records across the five completed OS jobs: settings and workspace bundles match,
no application pages remain before browser close, and browser shutdown completes
without forced termination. The raw extracted reports retain their original
candidate commits and Chrome 152.0.7977.75 identity. Expected browser version and
its match field remain null where the runner did not supply them. These are
hosted/software functional checks, not physical GPU qualification.

The dev-targeted Windows job fails **before browser setup**, with 76 of 77
prerequisite tests passing. The first native PowerShell case reaches its unchanged
five-second readiness deadline without receiving the ready marker:

- synchronous spawn: 6.5021 ms; spawn-event delay: 0.2760 ms;
- readiness timeout: 5000.5188 ms; timer lateness: 0.4872 ms;
- script execution: unavailable, because the script was not sent before readiness;
- owned-process closure confirmed after 12.8298 ms of cleanup.

The second native PowerShell case passes. The main-targeted job passes both native
cases (first startup 2045.3763 ms), then all five browser recovery stages. This
distinguishes the failed readiness boundary from browser execution and a delayed
Node timer, but does not establish whether PowerShell initialization or marker
delivery caused the timeout. The failed run remains failed; it is not replaced
with the other run's success. No timeout was extended and no unchanged rerun was
requested.

## Release artifact handoff

The failed release job finalized artifact **11837355842** at 17:58:37.223 UTC;
its subsequent name lookup failed at 17:58:37.518 UTC. Retained REST metadata
confirms the artifact exists, has not expired, and belongs to that run. This is
evidence of a handoff/discovery failure, not evidence that packaging failed.
The service-side cause remains unknown.

Reviewed changes `18f9f1f8` and `524f0146` pass the upload's immutable artifact ID
to the pinned downloader, reject a missing/nonpositive ID, and explicitly retain
the flat extraction path required by checksum verification. Root passes all nine
release tests. The pinned downloader still lists artifacts before filtering by
ID; this is not a claim of direct ID retrieval or a proven backend repair.
Fresh workflow validation is required. Checksum, attestation, expected repository,
workflow and source-commit checks remain mandatory; stable publication is unchanged.

The [pinned downloader implementation](https://github.com/actions/download-artifact/blob/d3f86a106a0bac45b974a628896c90dbdf5c8093/src/download-artifact.ts)
defines both the ID selection and extraction-path behavior reviewed here.

## Retained evidence

[files.json](files.json) lists byte counts and SHA-256 digests for the raw compressed
job logs, terminal run metadata, source binding, artifact metadata and extracted
recovery reports. Compressed logs also have decompressed digests. No historical
report or result was relabeled. This packet supplies S32's current representative
PR evidence and scoped S34/S45 checks; it is not final S46/S60 acceptance.
