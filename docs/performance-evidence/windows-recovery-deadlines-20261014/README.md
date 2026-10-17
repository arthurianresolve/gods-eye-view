# Windows recovery test deadline correction

[CI run 38522620105](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38522620105)
fails one unit test before installing or launching the fixture browser. The
mocked close/cleanup finishes in 589.96 ms, but the test asserts host wall time
below 500 ms. Its requested simulated operation deadline is 20 ms. That wall-clock
assertion conflates timeout behavior with runner scheduling; the log does not
establish why the host took longer.

The corrected page-close and browser-close tests advance controlled timers to
19 ms, verify the operation is still pending, then advance to 20 ms and require
settlement. They verify forced-cleanup ownership and listener retirement. A new
case verifies a hung force callback receives its own bounded 20 ms deadline.
Production timeouts and recovery logic are unchanged.

All 78 recovery/shutdown checks pass locally. A loader-only mutation increasing
the requested deadline by 1 ms fails both selected deadline tests promptly;
the production file is untouched. [Review and hashes](review.json) bind the
original failure, passing suite and mutation logs. Fresh hosted validation is
still required; this correction does not turn the original workflow green.
