# Windows shutdown: diagnostic timeout remains unavailable

The [Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38338398935/job/115103620881)
fails at QA integration `13796691f81be55e977a8241a633586526ce0a4e` during
the first prior-install stage, before the candidate application is exercised.
The prior application is `6b896e2a8277fba12bc9577ad7772005a71e13c7`.
Settings, workspace contents and the reopened asset match. Its page closes
and only the browser target remains before browser shutdown.

Chrome acknowledges close after 7.213 ms and disconnects after 27.817 ms,
but browser-close completion exceeds the unchanged 5,000 ms gate. Unlike
the [earlier recurrence](../windows-recovery-38335846725/README.md), this run
has the bounded process diagnostic enabled. That observation itself times
out at its 1,500 ms limit and remains unavailable. The subsequent force
callback also times out; process exit and forced termination are unconfirmed.
Do not describe this as either a natural exit or a confirmed forced exit.

The [raw report](report.json) and [bounded review](review.json) retain the
exact revision and unavailable states. The prior successful diagnostic run
does not override this failure. This is hosted software-rendered recovery
evidence, not physical GPU acceptance or a failure of the new map corpus.

The next diagnostic must avoid depending solely on a cold PowerShell/WMI
snapshot after timeout. A bounded, same-browser process inventory before
close plus lightweight read-only PID observations is a candidate approach;
its ownership and PID-reuse limits require review before implementation.
No longer shutdown deadline, unchanged rerun or inferred GPU/OS cause is
justified by this report. The [final integration result](ci-final.json) is
failed: six of seven standard jobs pass, including the browser gate; only
Windows recovery fails. No unchanged rerun was used to replace this result.

The next diagnostic candidate `fd1ae054` uses the existing Puppeteer browser
connection with an 800 ms command timeout and a one-second outer observation
cap, plus read-only presence checks for the owned parent PID. Independent
[actual-Connection failure controls](cdp-error-classification-review.json)
confirm no pending protocol callbacks or probe-owned connection disposal,
but reveal that native Puppeteer timeout, unsupported-method and connection
errors are all labelled generically. Correct that classification before the
next hosted run. This control uses a fake transport and launches no browser;
it does not explain the earlier Chrome shutdown failure.

Correction `8c49b078` handles the installed Puppeteer error shapes without
storing protocol text. Root independently passes all 75 recovery, shutdown
control and capture CLI checks, plus capture-harness lint. The
[correction review](diagnostic-correction-review.json) records ownership,
timeout and output bounds. A new exact-commit hosted run is required to observe
real recovery; the earlier failed run remains failed and no root cause is
claimed from these controlled checks.
