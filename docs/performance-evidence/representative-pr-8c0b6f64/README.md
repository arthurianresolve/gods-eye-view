# Both-base validation of 8c0b6f64

Frozen QA source `8c0b6f64ed4a0225e67eeb9344dfb967921d1ca2` passes standard CI
and release verification against both current bases. The [source binding](source-binding.json)
confirms that both synthetic merge trees equal the source tree.

| Target                                                                    | Tested merge                               | Standard CI                                                                                                             | Release verification                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [PR #3 to dev](https://github.com/arthurianresolve/gods-eye-view/pull/3)  | `80c37853a690489ef3246ece4f3158d02b3f0182` | [38448473770](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38448473770): all seven selected jobs pass | [38448473956](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38448473956): passes |
| [PR #4 to main](https://github.com/arthurianresolve/gods-eye-view/pull/4) | `b14c0e4f8cf424fa9d7ef81b7a1b4718819a8143` | [38448478872](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38448478872): all seven selected jobs pass | [38448478930](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38448478930): passes |

PR #4 is validation-only. Neither run publishes a stable release. Remote dev
and VM105 remain unchanged. These runs precede the S49 stale rollback fix at
`673349bc` and its corrected UI regression at `7c9f65dd`; they do not validate
those later commits or grant final S46/S60 acceptance.

## Functional and recovery results

Both Node 24/26 suites, production builds, Windows onboarding and Street Level
browser journeys pass. The retained Node 26 logs bind each checkout to its PR
merge revision and `BASE_REF`. Each published-token check reports 29 published
tokens and zero new allocations.

All six OS recovery jobs pass. The [independent review](recovery-review.json)
checks all 30 persistence records: settings and workspace bundles match, no
application pages remain before browser close, and close completes without
forced termination. Reports retain Chrome 152.0.7977.75 and their exact candidate
commits. Unspecified expected-browser fields remain null. These are hosted
software-rendering functional results, not physical GPU qualification. Earlier
Windows timeouts remain historical failures with unresolved causes.

## Direct artifact download

The direct REST correction now passes in both PR contexts, including the
distinction between the source head and synthetic merge revision. Candidate
artifacts **11838619773** (dev) and **11839163092** (main) are downloaded by
immutable ID. Metadata, ZIP digest, inner archive checksum, release manifest,
repository, workflow and signed source attestation all pass their workflow gates.

Evidence artifacts **11840196451** and **11838888358** contain only
`gods-eye-view/gods-eye-view/downloaded-release/artifact-rest-metadata.json` and
`gods-eye-view/gods-eye-view/downloaded-release/attestation-verification.txt`.
Their unchanged bytes are retained here with the evidence artifact ID as a
filename prefix. Empty attestation stdout is not proof by itself; the raw job
logs and successful verification step establish the result. No stable tag or
publication is performed. The [earlier discovery failure](../representative-pr-d6a97e46/README.md)
remains failed historical evidence.

## Reconciliation and retained evidence

A fresh fetch confirms fork/main and upstream/main at
`9beadbda6333b83f79aa03047e2d851830f01f6b`, already contained in reviewed QA merge
`8b84a2e0`. Remote dev `e8ccc268608fbece8b6d87a0b6db86e1800ddf90` remains fourteen
commits behind main. No further merge or rebase is needed on QA; promotion of
the reviewed work to dev remains separate.

[files.json](files.json) records byte counts and SHA-256 digests for raw metadata,
unchanged compressed job logs, extracted recovery reports and review records.
Historical evidence is preserved rather than relabeled as current validation.
