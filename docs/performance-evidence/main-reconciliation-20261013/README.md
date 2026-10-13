# Current main reconciliation

The latest 13 October fetch confirms fork/main and upstream/main at
`9beadbda6333b83f79aa03047e2d851830f01f6b`; remote dev is still
`e8ccc268608fbece8b6d87a0b6db86e1800ddf90`, fourteen commits behind main.
QA already contains both through reviewed merge `8b84a2e0`. No additional merge,
rebase or history discard is needed. Dev promotion and VM105 remain unchanged.

The [earlier representative PR evidence](../representative-pr-8c0b6f64/README.md)
passes all seven standard jobs and downloaded-release verification against both
bases at `8c0b6f64`. Both tested merge trees equal that source. Published-token
checks and all 30 recovery records pass. Direct REST artifact retrieval now
passes with exact source/merge binding; the earlier discovery failure remains
historical. Later S49 rollback and S51 fleet changes pass scoped mixed-use and
durable workspace journeys at `106918ee`; its separate tracking browser run
passes 111 checks. The [matched S51 diagnostic](../s51-render-demand/paired-6786-1069/README.md)
passes the candidate idle/ownership gate while preserving the failed baseline.
These scoped results do not replace full current-candidate integration or
physical Windows qualification, which remain pending.
The later [both-base runs at `6d84a6ee`](../representative-pr-6d84a6ee/README.md)
finish failed: all six source suites reject one obsolete render-hold source
assertion. Three OS recovery jobs, onboarding and Street Level pass on each
base, including all 30 persisted-state recovery checks. The assertion is
corrected in `0ca5a466`/`ba86a5c0`; fresh integration is still required. A
separate full local Windows suite at `9a2517af` reports 7,802 passes, three
failures and ten skips. Its map-fault budget, child-cleanup duration and
concurrent key-repair failures are under investigation; this is not a pass.
A fresh 13 October 22:25 CEST fetch still finds main `9beadbda` and dev
`e8ccc268`; QA contains both, so no additional main merge is needed.

PR #4 remains validation-only; no stable release has been published.

## Earlier checkpoints

The 13 October 19:31 CEST fetch again confirms both main refs at `9beadbda`
and remote dev at `e8ccc268`. Reviewed QA `e0710bd5` contains both (853 commits
ahead of main, zero behind). Remote dev remains fourteen commits behind main;
the required reconciliation is already included in reviewed merge `8b84a2e0`.
No additional merge, rebase or history discard is needed on QA. Promotion to
dev remains pending current candidate validation; VM105 is unchanged.

The latest [map fault report](../s47-map-streaming/native-fault-38436364036/README.md)
passes missing/corrupt recovery but finds an incorrect held-asset path in the
harness. The strict manifest-based correction at `e0710bd5` passes 100 root
checks and passes [run 38439382587](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38439382587).
Its [retained evidence](../s47-map-streaming/native-fault-38439382587/README.md)
confirms both healthy journeys and all three rendered fault/recovery controls.
Current Windows recovery already passes at `15c0cff3`; historical readiness
failures remain recorded below.

The 13 October 18:55 CEST recheck still finds fork/main and upstream/main at
`9beadbda6333b83f79aa03047e2d851830f01f6b`, and remote dev at
`e8ccc268608fbece8b6d87a0b6db86e1800ddf90`. Dev is 697 commits ahead and
fourteen behind main. Reviewed QA `82da3163fe9499d9540e0e654e361455b338c6ec`
already contains both refs (839 ahead of main, zero behind); ancestor checks
pass. There is no additional main change to merge or rebase. Promotion to dev
still awaits current validation: the [later standard run](../integration-dddef9eb/README.md)
has another Windows prerequisite readiness failure. The independently corrected
[map terrain-stage validator](../s47-map-streaming/native-fault-38432631061/README.md)
is on QA `e701e0ff`; its next run passes the missing-metadata case and exposes a
[separate stale preparation frame](../s47-map-streaming/native-fault-38434748788/README.md).
The reviewed freshness correction at `fe28df76` passes 100 affected root checks
and is under fresh rendered validation. No dev history has been discarded or
rewritten, and VM105 has not changed.

The subsequent [targeted Windows recovery run](../integration-15c0cff3/README.md)
passes at `15c0cff3` with phase diagnostics and unchanged time limits. Historical
readiness failures remain failed with their cause unresolved. Promotion still
requires the current map/fixture checks and final candidate validation; the old
failure is not being treated as a failure of this new targeted run.

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
