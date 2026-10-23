# Both-base validation of d6a97e46

The frozen QA source is `d6a97e46e80ebb3bd5fe20f7f43ed9f5825a84c1`.
The [source binding](source-binding.json) verifies that its tree and both tested
synthetic merge trees equal `2c0a342081b1d85be3fcbd8e2f85fab8d727e7ea`.

| Target                                                                    | Tested merge                               | Standard CI                                                                                                             | Release verification                                                                                                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PR #3 to dev](https://github.com/arthurianresolve/gods-eye-view/pull/3)  | `568dfa489a94cf09d559c7a87622975118bb3ae5` | [38444882847](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38444882847): all seven selected jobs pass | [38444882907](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38444882907): passes downloaded archive, checksum, source and attestation verification |
| [PR #4 to main](https://github.com/arthurianresolve/gods-eye-view/pull/4) | `655c9029c98142414ce2449a0330242a54dc9f09` | [38444888569](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38444888569): all seven selected jobs pass | [38444888716](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38444888716): fails artifact discovery after successful upload                         |

PR #4 remains validation-only. Neither workflow publishes a stable release.
Remote dev and VM105 have not changed. A fresh fetch still finds fork/upstream
main at `9beadbda6333b83f79aa03047e2d851830f01f6b`, already contained in QA.
Dev `e8ccc268608fbece8b6d87a0b6db86e1800ddf90` is fourteen commits behind main;
its eventual promotion will include the reviewed merge. No extra rebase or
history discard is needed.

## Current functional evidence

Both Node 24/26 suites pass against both bases. The retained Node 26 logs show
the actual pull-request merge checkout and `BASE_REF`; each token gate reports
29 published tokens and zero new allocations. All six OS recovery jobs pass.
The [independent recovery review](recovery-review.json) checks all 30 persistence
records: settings and workspace contents match, no application pages remain,
and browser close completes without forced termination. Original extracted
reports retain Chrome 152.0.7977.75 and exact source identities. Expected-browser
fields remain null where not supplied. These are hosted/software functional
results, not physical GPU qualification.

Both Windows prerequisite runs pass at this revision with unchanged deadlines.
The earlier readiness timeout remains a historical failure with an unresolved
cause; a later passing run does not prove its cause or retroactively pass it.

## Artifact ID filtering still failed

The ID-mode correction did not solve discovery. PR #4's upload finalized
artifact **11837328637** at 18:16:46.102 UTC. The pinned downloader received that
ID, then reported zero artifacts at 18:16:46.413 UTC. Its implementation lists
artifacts before filtering by ID; it is not a direct REST download. The service
cause is unknown. PR #3 passed the same code path with artifact 11837723938.

A later independent authenticated REST request downloaded artifact 11837328637
by ID. The [diagnostic review](rest-download-review.json) records exact ZIP size
and digest, inner archive checksum, expected manifest commit, and successful
attestation verification. The [structured verification](rest-attestation-verification.json)
binds repository, workflow, source commit and GitHub-hosted runner. This later
request used the local authenticated CLI; it does not prove the immediate workflow
handoff or change the failed run's result.

Reviewed corrections `8ba383ea` and `6dc93009` fetch metadata and ZIP directly by
immutable ID. They validate the artifact/run/repository/source, expiry, name,
size and upload/REST/ZIP digests, then accept only the two expected flat archive
entries. The upload action emits raw SHA-256 hex; REST metadata uses a `sha256:`
prefix. The validators preserve those distinct contracts. The existing inner
checksum, signed attestation and release-manifest verification remain mandatory.
Twelve focused root tests, adopted formatting and diff checks pass.

[Fresh workflow verification](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38447239483)
passes on immutable `6dc93009`; stable publication was disabled. Its
[retained result](../release-rest-6dc93009/README.md) is separate from the d6a97e46 PR runs.

## Evidence

Raw job logs are compressed without content changes; extracted JSON reports and
GitHub metadata retain tested identities. [files.json](files.json) records byte counts and
SHA-256 digests for the retained raw evidence. Earlier packets remain historical.
This is scoped S32/S34/S45 evidence, not final S46/S60 acceptance.
