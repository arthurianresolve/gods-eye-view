# Dense satellite cadence correction

Reviewed source `9a2517afc42199790b43122851130621db136c25` retains a continuous
render owner while a visible dense satellite population exists. Core-only
satellites retain their one-second scheduled update. The actual catalog loader
acquires demand when its first dense chunk is accepted, before yielding; point
visibility, catalog removal and disable resynchronize or retire that demand.

The prior dev change `379fca0a` scheduled all untracked satellites at one second,
although dense propagation advances only a bounded chunk per frame. With no
other continuous owner, this changed the full-population update cadence. Main
`9beadbda` retains unconditional satellite rendering; the newly reviewed main
merge did not introduce this defect. The correction keeps the existing dense
algorithm and visual populations rather than changing its batch size.

Root passes 49 focused tests across eight files. The new actual catalog/control/
lifecycle tests verify the first-chunk handoff, 900 identities over the existing
300-frame sweep, visible/core transitions and stale completion after disable.
A separate imported copy using the previous lifecycle fails the first-chunk and
dense-owner assertions (two expected failures), while its late-disable control
passes. Mock timers, mocked point storage and simulated render callbacks make
this behavior evidence, not GPU timing or visual equivalence evidence.

The subsequent full Windows Node 24.16.0 suite at the unchanged source reports
7,815 tests: 7,802 passes, three failures and ten skips. Its ordinary-suite
failure prevents the later isolated allocation probes from running. Failures
are the map-fault test's exhausted setup budget, a confirmed child cleanup
exceeding the test's five-second duration, and concurrent malformed panel-key
repair returning different keys. They are not silently retried into passes.
An instrumented copy of the key test logs safe fallback codes; one isolated
run and twelve four-way-contention runs pass without observing a fallback.
This does not explain or erase the original failure. Further investigation is
required before current integration can be accepted.

S51 remains partial: the separate focus-transition scheduling change still
requires review, deadline preservation and cleanup coverage. No hardware,
performance-target or full-candidate acceptance is claimed here.

[review.json](review.json) summarizes the observations; [files.json](files.json)
binds the retained local logs, including the original failed full suite.
