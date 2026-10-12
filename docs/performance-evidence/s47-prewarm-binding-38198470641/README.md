# Dense capture with pre-warmup diagnostic binding

[Run 38198470641](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38198470641)
tests application/harness commit `bbf4e88fd0df43a1bf351bf564a0fd8d23d6a8ce`
against the frozen `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7` baseline build.
The result remains **failed**. The baseline build/inspection passes; the
candidate capture completes two idle samples before timing out at the first
scripted-motion measurement boundary. It is not comparison evidence.

The complete outer [raw artifact](report.json) is 119,418 bytes, SHA-256
`94293e3f4ef1f3d5b9076f89b16a1c8f26a875a92f4320937f3b4318d11b2f34`.
The [independent review](review.json) preserves the relevant observations and
[CI metadata](ci-run.json) binds them to the exact revision. The embedded
bounded failure report marks `evidenceTruncated: true`; it must not be presented
as a complete, successful capture.

The prior per-boundary binding setup consumed 4,075 ms inside a 6,000 ms host
window. This revision installs one owned binding per measured document before
warmup, then registers and releases individual boundary observations. Setup
costs are now 11.80, 5.31 and 2.43 ms, outside the boundary windows. All three
owned bindings are confirmed removed, including after failure. The two idle
samples retain two and three rendered frames respectively.

The motion sample still exposes substantial delay:

- Its warmup completed render arrives after 4,574.4 ms of page observation;
  the host receives the final result after 4,653.9 ms.
- Measurement records two rendered frames over 7,046.8 ms, one interval of
  3,624.1 ms, and two long tasks with a maximum duration of 2,620 ms.
- At the subsequent boundary, host dispatch itself takes 0.33 ms. The
  page-entry acknowledgement reaches the host at 5,987.5 ms and the render-request
  acknowledgement at 5,989.1 ms. The unchanged host deadline fires at
  6,001.3 ms with no terminal page result or post-render acknowledgement.
  Host receipt times include queueing and transport; they do not establish
  one-way page-entry delay or GPU execution time.
- All 2,500 aircraft are delivered. No page or interception errors are recorded.
  Owner-binding cleanup and wrapper child-process cleanup are separate
  observations; neither turns the failed boundary into a pass.

These short, instrumented SwiftShader observations establish that moving setup
outside the boundary avoids the earlier diagnostic interference. They do not
identify the cause of the remaining motion delay, establish a speedup, or
provide physical Windows coverage. The harness remains unmerged. The next
diagnostic must attribute the page, render and worker activity during the
failing boundary while keeping the current deadlines and fixture population.
