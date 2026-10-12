# HUD summary context coalescing

The baseline is `acc471e4afb4ff629244ec37caf2836b6aef89ef`. The candidate adds
revision-owned coalescing for HUD summary context construction, skips that work
while a summary service request is already active, and prevents stale or
destroyed owners from starting work or changing summary state.

The actual `IntelHUD._updateSummary` integration tests pass 11/11; together with
the existing altitude-datum tests, the focused command passes 17/17. The same
integration tests against the baseline source produce the five expected
regression failures recorded in `review.json`: duplicate same-revision work,
work during a changed-camera request, stale rejection state, and work started
before or completed after destruction. The baseline run completed without a
timeout.

`hide()` semantics are preserved: hiding changes visibility only and does not
cancel an already-running summary operation. Destruction and revision ownership
remain the cancellation boundaries.

This evidence covers context-builder call counts and state ownership. The tests
mock context construction and the summary service; they do not count individual
depth picks or establish GPU, latency, Windows-stall, or user-visible speedup.
The existing view-target cache can reuse a pick for 2.5 seconds, so a reduction
in context calls does not imply the same reduction in GPU readbacks.
