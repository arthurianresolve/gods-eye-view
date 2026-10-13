# Current main reconciliation

[Fresh standard integration at `c7c47245`](../integration-c7c47245/README.md)
now passes all seven selected jobs, including Windows recovery. This validates
the reviewed main merge at that exact revision. The later map-navigation fix and
S50 runtime change are under separate validation at `dddef9eb`; they cannot inherit
the earlier result. Dev/VM105 remain unchanged pending current candidate checks.
The earlier Windows failure remains historical failed evidence, not a current
failure of the successful `c7c47245` run.

The latest fetch before the `cc3328e1` integration check again confirms both main
refs at `9beadbda6333b83f79aa03047e2d851830f01f6b` and fork/dev at
`e8ccc268608fbece8b6d87a0b6db86e1800ddf90`. Dev remains fourteen commits behind
main. Both are already ancestors of the current QA branch; no additional merge
or rebase is needed on QA. The reviewed reconciliation still awaits current
integration validation before promotion to dev. VM105 is unchanged.

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
The merged candidate `4b60f453` has now completed its [standard integration run](../integration-4b60f453/README.md):
six selected jobs pass, including both Node suites/builds and Street Level;
Windows recovery fails before browser setup on a PowerShell readiness timeout.
The helper and workflow are unchanged from the preceding green revision. The
cause remains unresolved; the failed prerequisite still blocks promotion.
The [separate native diagnostic failure](../s47-map-streaming/native-v4-38416400160/README.md)
is a capture-report topology mismatch and remains failed. The
[reviewed correction](../s47-map-streaming/map-document-ownership/README.md) passes
90 root focused checks plus the original-report replay and fourteen negative
mutations. A [fresh native run at the merged candidate](../s47-map-streaming/native-v4-38420739560/README.md)
passes both production map journeys and candidate capture validation. The prior
failure is not caused by the Street View merge, which that run predates.
Promotion to dev follows review
and merged-candidate validation; no rebase or history discard is needed.

A fresh remote fetch for the latest user recheck still finds fork/main and
origin/main at `9beadbda6333b83f79aa03047e2d851830f01f6b`. Local and remote QA
`c1850bcb10ba711c1cc027259f35cffca01b41c2` contain both current main and dev:
826 commits ahead of main and zero behind. Local/remote dev remain
`e8ccc268608fbece8b6d87a0b6db86e1800ddf90`, 697 ahead and fourteen behind main.
Both ancestor checks pass, and both local worktrees are clean at this checkpoint.
No additional upstream reconciliation is needed beyond the reviewed merge
already on QA. Promotion of that merge to dev still needs the current candidate's
validation; the CI results above apply to `4b60f453`, not to the later harness and
report commits. Dev and VM105 have not been promoted during this recheck.

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
