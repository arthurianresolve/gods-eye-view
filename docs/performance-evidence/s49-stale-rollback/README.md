# Stale workspace rollback ownership

Root reproduced a development-branch lifecycle defect at `d6a97e46`: an older
workspace apply fails and waits in rollback; a newer workspace then finishes
successfully; when the old rollback completes, its catch block publishes a
failure over the newer workspace's applied status. The [before result](before-fix.json)
records that overwrite. The coordinator file was introduced by `3d6b30c8` and is
absent from current upstream/fork main `9beadbda`; this defect is not attributed
to the current upstream integration.

Luna's `91976299`, integrated as **673349bc**, checks ownership after rollback
fulfillment or rejection before publishing a result. The rollback context carries
the original navigation token and ownership predicate. The production workspace
UI checks ownership around its asynchronous view application and passes it to
layer restoration. Share restoration rejects stale tracking follow-up. Gated
layer restoration retains its own controller identities, avoids consuming or
clearing a successor's controllers, and snapshots current durable settings only
after ownership is confirmed so intervening explicit parameter changes still win.

The [same original reproduction after the fix](after-fix.json) returns
`superseded` for the old operation and leaves the newer workspace `applied`.
Run `node docs/performance-evidence/s49-stale-rollback/reproduction-source.mjs`
from the repository root to observe the current behavior.

## Validation

Root passes **258 tests across 14 affected suites** at `673349bc`, covering
workspace restore, layer state, workspace/import UI, cooperative import and
preview cancellation, local GeoJSON, CCTV geometry/restore, and the existing
CCTV, import/workspace, terrain/picking lifecycle report contracts. The raw
`after-focused.log.gz` is retained. The earlier 205-test result predates the
missing regression and did not detect it; its original log remains historical.

The rollback regression matrix covers fulfillment and rejection after workspace
replacement, caller cancellation, navigation invalidation and destruction, with
caller abort-listener cleanup. Layer-state tests cover gated replacement,
caller abort and same-owner explicit parameter changes.

Root found that the first UI regression asserted before the actual restore
settled. Luna's **07ca0cb8**, integrated as **7c9f65dd**, corrects the wait and
models the existing share-link navigation-token contract. Root passes its entire
20-test UI suite. A [separate negative control](ui-control-review.json) removes
only the post-await rollback ownership guard, retaining token forwarding and the
coordinator checks: the corrected UI test fails because one stale layer restore
occurs. The unchanged fixed module passes. Both raw results are retained. This
proves the assertion reaches the late continuation; it is a Node UI test using
DOM/share-link doubles, not a rendered browser result.

Formatting and diff checks pass. The current full-application workspace journey
and final Windows retention qualification remain pending for this new runtime
change. S49 remains partial; these checks do not establish the 60-minute heap or
listener plateau and do not identify the cause of historical browser stalls.

[files.json](files.json) binds retained raw results by bytes and SHA-256, with
both compressed and decompressed hashes. Old results are not relabeled.
