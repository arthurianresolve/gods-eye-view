# Windows recovery shutdown recurrence

The [Windows job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38335846725/job/115095606251)
fails on exact dev `e8ccc268608fbece8b6d87a0b6db86e1800ddf90` during final
browser cleanup. All five stages preserve settings, the complete workspace
bundle and the reopened asset hash. The final stage remains failed because
its browser process requires forced termination.

The owned page closes, leaving zero pages and no unexpected page targets.
Chrome acknowledges `Browser.close` after 11.685 ms and disconnects after
32.175 ms. The process does not exit within the unchanged 5,000 ms gate.
The eventual code-1 exit at 6,158.226 ms follows forced cleanup and is not a
natural successful exit. Earlier stages close naturally in 289–504 ms.

This matches the boundary of the earlier intermittent shutdown failures;
it does not identify the remaining process role or establish an application
regression. The same exact commit previously passed all seven standard jobs
in [run 38334290706](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38334290706).
That pass does not override this failure.

The original automatic run has now finished: six of seven standard jobs pass,
including Node 24/26, Windows onboarding, macOS/Linux recovery and browser
journeys. Windows recovery is the sole failure. The
[final CI metadata](ci-final.json) is retained separately from its live observation.

The [raw report](report.json) was extracted from the job's marked evidence
record, with a single trailing newline: 10,580 bytes, SHA-256
`7a2d54552d16072aa4e102dc579155fbee966f70620db6740551185f10804873`.
Environment: Windows Server 26100, Chrome 152.0.7977.75, Node 24.14.0 and
SwiftShader WebGL. This is recovery evidence, not physical GPU acceptance.

The [diagnostic follow-up](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38336908148)
uses the same immutable application/harness commit and renderer, with the
existing bounded shutdown observations enabled. It can capture owned process
roles before forced cleanup if the failure recurs. This changes observation,
not the deadline or pass criteria. It has now passed all five stages with
natural exits in 309–475 ms, settings/workspace agreement and the original
persisted asset hash. Before each close only the browser target remains;
after disconnect target information correctly becomes unavailable.
No timeout occurs, so the failure process snapshot is not exercised.
The [raw diagnostic report](diagnostic-report.json) and
[final diagnostic metadata](diagnostic-final.json) preserve this successful
control separately. The [dispatch identity](diagnostic-dispatch.json) and
[original CI observation](ci-observation.json) remain historical live snapshots.

This control does not fix or explain the intermittent shutdown. The separate
workflow correction `6942be8a` enables existing bounded observations for every
Windows recovery CI job, so an automatic recurrence can retain the missing
process evidence. Other platforms remain opt-in, and the deadline and failure
criteria are unchanged. This is an evidence-collection correction only.
