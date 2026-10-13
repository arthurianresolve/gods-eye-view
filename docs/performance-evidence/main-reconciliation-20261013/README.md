# Current main needs a reviewed merge

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

No merge, rebase, push to main/dev, or deployment was performed for this check.
Fork main advanced from `8b8ccc9a` to `9beadbda` during this check; both remotes
were fetched again to confirm the final table. The earlier checkpoint at
upstream `8b8ccc9a` was correct for that fetched
revision; it is now superseded. Later reviewed QA work remains separate.
