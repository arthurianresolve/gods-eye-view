# 14 October upstream reconciliation

Upstream `main` advanced to `132b9e96dc1491e5db8bf949b1560f4561c925c3`
(GBFS localized station names, PR 1120), while fork `main` remained at
`9beadbda6333b83f79aa03047e2d851830f01f6b` and fork `dev` at
`e8ccc268608fbece8b6d87a0b6db86e1800ddf90`.

Merge `b6d30c37c31d56dc67a438cae0f208e2f4bd861c` contains all three refs.
The seven-file upstream patch adds robust legacy/localized names to the shared
GBFS station parser and covers malformed/empty translations and bike-share
queries. It changes no Cesium version, lockfile, renderer setting or performance
fixture. Both additive conflict blocks in the changelog and formatting list are
preserved. No existing development changes were discarded or rebased.

At that clean merge, 23 GBFS/mobility checks and two unit-discovery checks pass;
formatting passes for 1,656 adopted source files. The new source tests are
included by normal recursive discovery. The upstream browser QA script is
retained but was not run locally. Full integration now passes on containing source e53df518; see the
[both-base CI and release verification](../representative-pr-e53df518/README.md).
The prior c5802408 matrix remains bound to its original source.

The change is on the isolated QA branch. Remote dev/main and VM105 have not
been updated. Final promotion and deployment still require the current candidate
checks. The [review](review.json) records exact refs and scope.
