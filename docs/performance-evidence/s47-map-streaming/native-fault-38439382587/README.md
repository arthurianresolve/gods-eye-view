# Native map journeys and fault recovery pass

[Run 38439382587](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38439382587)
passes at application/harness `e0710bd5cf3ba7c5d0d5383189b82fd8475ec087`,
against original baseline `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`.
Both healthy production map journeys and the candidate capture CLI complete.
All three candidate fault documents pass: missing metadata, corrupt metadata,
and a held valid response released after superseding its requested map.

Root reran the strict journey, delivery and complete fault-set validators against
the downloaded report and independently regenerated fixture manifest. Build
receipts, fixture identity, actual renderer, worker source and document cleanup
remain bound to the tested revisions. Each fault is injected once; the held
response is released and acknowledged once. Every fault document has zero pending
requests, zero missing fixture paths and confirmed interception/context cleanup.
[The review](review.json) records these checks. Counts, settings, paths and
deadlines were not relaxed. Earlier failed reports retain their original outcomes.

This is supplemental hosted Apple Paravirtual Metal integration evidence, with
performance acceptance explicitly disabled. It does not establish physical
Windows qualification, five paired latency trials or the sixty-minute soak.

Artifact `11834293058`, retained without rewriting:

| File                                                                            |  Bytes | SHA-256                                                            |
| ------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Outer report](performance-build-smoke.json)                                    | 714769 | `df2bfe6b9daa34b552d7e786b4f136a8f288c0cd3634f15a1766532b5d8dbb2f` |
| [Candidate CLI](performance-build-smoke.json.capture-cli-report-candidate.json) | 383296 | `0ac8daa36a203530d64852c1eebd3ddd3eeca7cc15b1d016db31a44eae194997` |
