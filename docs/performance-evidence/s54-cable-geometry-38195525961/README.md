# Partial cable geometry attribution

[Run 38195525961](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38195525961)
tests exact application/harness commit
`9752656caa51829b46224ec36156c92ac62ae436` on hosted Apple paravirtual Metal.
It remains **failed**. The Entity lifetime captures ten images and a complete
2,629-record geometry witness, then fails in a later scene-stability wait.
The collection lifetime is not reached, so no pairwise coordinate comparison
can be made from this report.

The complete [raw report](report.json) has SHA-256
`c55ff090241738a0178bfa148c63c98cefa06a398625ae812127b8d4c040fdfe`.
The [review](review.json) retains the full failure diagnostics and the witness
metadata. The post-loop witness matches camera-change sample 4 exactly. Its
combined geometry hash also matches the earlier Entity capture at 12b2b6c9;
this does not establish equivalence with the collection representation.

The timeout follows capture during the lifecycle portion. The last retained
readiness observations contain a pending 1,913-instance ground-polyline build.
The generic scene-stability label does not identify the exact lifecycle cycle.
The teardown assertion was not reached and no successful cleanup claim is made
for this lifetime. The existing timeout is unchanged. The prior visual
mismatch remains open; this partial report is not a visual or hardware pass.
