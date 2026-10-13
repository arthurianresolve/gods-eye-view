# Current main reconciliation

## Reviewed merge prepared

Merge `8b84a2e0de1393d183c54e50d28d468468fa53f9` now combines reviewed QA
`f50565a094d583820a661849d9b888c5a65b0ae8` with upstream/fork main
`9beadbda6333b83f79aa03047e2d851830f01f6b`. The QA working branch has advanced
to this merge; `dev` and the deployed VM have not been changed. A fresh remote
fetch still finds both main refs at `9beadbda` and local/remote dev at `e8ccc268`.

Root compared the resolved merge tree with Git's automatic merge tree: only
`src/data/scenePick.test.mjs` differs from the automatic result. The resolution
retains both the QA attribution tests and upstream ground/surface picking tests.
Root independently passes 485 focused Street Level, picking, layer-state, key,
markup, build and UI checks. Luna also passes package boundaries (1,015 modules,
80 entries), adopted changed-file formatting and its 347 focused checks. Root
passes published layer-token checks against both `fork/main` and `fork/dev`:
29 published tokens, no new allocations. These local checks do not substitute
for representative pull-request workflow evidence.

The [preceding exact QA revision passes all seven standard CI jobs](../integration-f50565a0/README.md).
The merged revision still needs its own Node 24/26, build, onboarding/recovery and
browser integration run. The [separate native diagnostic failure](../s47-map-streaming/native-v4-38416400160/README.md)
is a capture-report topology mismatch and remains failed. It is not caused by
the Street View merge, which that run predates. Promotion to dev follows review
and merged-candidate validation; no rebase or history discard is needed.

## Original assessment before the merge

A fresh fetch on 13 October 2026 finds:

| Ref                    | Revision                                   | Relationship                                  |
| ---------------------- | ------------------------------------------ | --------------------------------------------- |
| Upstream `origin/main` | `9beadbda6333b83f79aa03047e2d851830f01f6b` | Fourteen commits beyond the common base       |
| Fork `fork/main`       | `9beadbda6333b83f79aa03047e2d851830f01f6b` | Matches upstream on the final recheck         |
| Local and remote `dev` | `e8ccc268608fbece8b6d87a0b6db86e1800ddf90` | Identical; 697 ahead of main, fourteen behind |
| Reviewed QA head       | `e5ff5303ae9d85f528017fc6e6d90fbcbe5802d6` | 807 ahead of main, fourteen behind            |
| Common base            | `8b8ccc9a81379e8b40d4be67610570ee5b159512` | Previously fetched main revision              |

The new upstream merge is [Google Street View support, PR #966](https://github.com/bilawalsidhu/gods-eye-view/pull/966).
It changes 58 files, including provider selection, shared ground picking,
Street Level UI, browser CSP, tests and package-boundary declarations. Sixteen
paths overlap dev changes. The package change adds a provider export; no
package-lock or Cesium dependency change is present in this range. Street View
is optional and key-gated; it is not a remedy for the current native fixture
coverage failure or evidence of a Cesium performance improvement.

`git merge-tree --write-tree fork/dev origin/main` performs a rehearsal without
changing either branch or the working tree. It reports one content conflict in
`src/data/scenePick.test.mjs`. The production `scenePick.js` merges automatically.
Preserving the dev attribution tests alongside upstream ground-picking and
surface-picking tests produces eight passing tests in an isolated temporary
copy. This is a focused conflict-resolution check, not full merge validation.

Recommend a merge preserving the published dev history and implementation work.
Do not discard the dev diff or rebase hundreds of published commits. Before
promotion, resolve the test overlap, review all automatic merges (especially
picking, build/CSP, package boundaries and Street Level), and run Node 24/26,
builds, onboarding/recovery, browser journeys and the Street Level/picking gates.
A new merged candidate needs its own exact-commit evidence; older performance
results remain tied to their original revisions.

At the original assessment checkpoint, no merge, rebase, push to main/dev, or
deployment had been performed. The reviewed merge update above supersedes that
checkpoint for QA only.
Fork main advanced from `8b8ccc9a` to `9beadbda` during this check; both remotes
were fetched again to confirm the final table. The earlier checkpoint at
upstream `8b8ccc9a` was correct for that fetched
revision; it is now superseded. Later reviewed QA work remains separate.
