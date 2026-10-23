# Release artifact handoff failure diagnostics

[Release run 38522620108](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38522620108)
passes source verification and uploads the candidate, then fails requesting its
REST metadata. The previous handler merged request and JSON parsing failures into
one generic message. The log cannot distinguish an HTTP failure, process failure
or malformed response, so the original cause remains unresolved.

A later read can retrieve that exact artifact ID and its expected run, head SHA
and upload digest. This is a read-only availability check, not a completed release
verification or proof of an earlier transient error. The original workflow stays
failed. The other representative release run passes.

The correction distinguishes request failures from invalid JSON and retains only
HTTP status, process exit code and allowlisted process-error names. Credentials,
response bodies and raw stderr remain absent. It neither retries requests nor
weakens artifact identity, checksum, archive-content or attestation requirements.
Focused release tests pass, including injected HTTP/process/malformed-body failures
and exact metadata/ZIP rejection checks. [Review and hashes](review.json) preserve
the failed step and later observation. A subsequent hosted failure should now
provide the information needed for a specific fix.
