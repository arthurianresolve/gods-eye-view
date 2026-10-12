# Command-palette queued-close focus repair

Candidate `311cc5ea16fe31f0743a2fd7366851799c132d40` passes
[all seven standard CI jobs](ci-run.json), including the new deterministic
native-dialog regression and the existing accessibility/browser journeys.
[Run 38196890682](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38196890682)
also passes Node 24/26 tests and builds, Windows onboarding, and three-OS
installation/update recovery. Optional diagnostics and PR-only layer-token
checks remain skipped, not passed.

The command palette previously restored focus again in its queued `close`
handler. Native modal-dialog closing already restores the opener's focus
synchronously. If another action focuses the inspector or reopens the palette
before the queued event, the duplicate restoration can steal that new focus.
The fix removes the duplicate handler and its retained focus target.

Root independently ran the new unit regressions against the unchanged original
module from `c3c6c5a7`: the delayed-inspector and close/reopen cases fail, while
Escape restoration and the two older tests pass. All five pass with the fix.
The [original output](original-unit-result.txt) and [review](review.json)
record the modeled native ordering, source hashes and exact revisions.

The actual browser regression opens through the application's trigger, closes
the dialog, focuses the inspector in the same task, then awaits the native
close event. Inspector focus must survive. The ordinary keyboard close and
focus-return journey still runs afterward; its timeout is unchanged.

This demonstrates and repairs an application focus race. The earlier failure
at `a92c6921` has no focus trace, so its particular cause cannot be conclusively
reconstructed. These automated checks do not replace human screen-reader
reviews or establish Windows GPU frame-delivery or hardware-soak acceptance.
