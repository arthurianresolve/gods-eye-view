# Current both-base source checks expose an obsolete assertion

Source `6d84a6ee27e8b542f207a8f9aff04a378d8ff3f8` includes the reviewed main
merge and the later workspace, fleet and satellite-test changes. Both GitHub
merge trees equal this source tree:

| Base | Tested merge | CI | Release verification |
| --- | --- | --- | --- |
| dev | `febfea1815e5c4637412fba66a2be1d86ea6b029` | [38459820173](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38459820173) | [38459820013](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38459820013) |
| main | `3d77b7d16dee3b3da5adeb67963c7ec8714dfe1e` | [38459824649](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38459824649) | [38459824578](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38459824578) |

All six completed source-verification suites fail the same test at
`src/data/detectionRenderDemand.test.mjs:461`. Each reports 7,808 passing tests,
one failure and four skips out of 7,813 tests. The assertion reads source text
and requires a literal unconditional `holdContinuousRender` call inside each
layer's `enable()`. The new implementation delegates that decision to the
shared fleet owner and holds while actual visuals exist. The source assertion
therefore encodes the old implementation rather than its required behavior.

The replacement behavior coverage already invokes both actual lifecycle
factories and ingestion paths: empty enable releases ownership, accepted
nonempty membership acquires it before asynchronous follow-up, and disable,
destroy, tracking changes and stale completion release or preserve it correctly.
The full tracking browser run separately passes 111 checks at `106918ee`.
Removing the obsolete regex must preserve those behavior tests; it does not
relax frame, visual, tracking or cleanup gates.

These runs remain failed evidence. Both release workflows stop during source
verification, before building or publishing a stable release. The six independent Windows/Linux/macOS recovery jobs pass. Root checked all
30 records for unchanged settings, workspace bundles and asset hashes, one
rendered imported feature, no leftover browser pages, natural browser closure,
and no forced process termination. Each log prints two identical copies of its
report; the review requires exact equality before treating them as one run.
See [the recovery review](recovery-review.json). These are hosted functional
checks, not physical GPU evidence. Windows onboarding and the Street Level browser gate also pass on each base.
Both CI and release workflows finish failed overall. A corrected revision
requires fresh integration.
[files.json](files.json) binds raw failed/recovery job logs, original recovery
reports, run metadata snapshots and [root review](review.json). Checkout lines bind each
log to the actual PR merge ref and revision; GitHub's shared-head check rollup
is not used to infer which base was tested. PR #4 remains validation-only.
