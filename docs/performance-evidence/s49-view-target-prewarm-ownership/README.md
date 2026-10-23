# S49 view-target prewarm ownership

The unchanged `84004e110f5233c869e9b6f9d51a8900fcfd307b` action runner leaves
its camera `moveEnd` listener and queued prewarm callback alive after disposal.
Both debounce-pending and idle-pending cases then perform a late depth pick.
The [original reproduction](original.json) uses the real action runner and
`Cesium.Event`, with deterministic timer/idle queues.

Fix `3907df04e78c7937ad5b60b13d2f1374d7648bf0`, integrated as
`92e449ae06f407c3fda94351683a3ec6eb3900d2`, assigns a shared per-viewer lease.
The final runner disposal removes its exact listener, cancels queued work and
invalidates late callbacks. A newer camera event also invalidates an older
debounce or idle callback. Multiple live runners retain one shared listener;
later reinitialization acquires a fresh owner. The 120 ms debounce, 500 ms idle
timeout, 2,500 ms view-target cache and picking fallbacks are preserved.

Root ran the same 102-test action-runner suite against both versions. The
[unchanged parent fails seven lifecycle regressions](negative-tests.txt);
the [candidate passes all 102](candidate-tests.txt). The independent
[integrated-code reproduction](candidate.json) reports zero listeners, timers,
idle callbacks and picks after disposal and draining in both cases.
Formatting, import directions and package boundaries pass on the candidate.
[Full integrated CI 38255379818](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38255379818)
passes all seven jobs at `c39c52c8301282973716102c380f369c9036cb59`: Node 24/26,
production builds, Windows onboarding, three-OS real install/update recovery,
and the browser journeys. The [terminal job evidence](integration-ci.json)
records that exact revision; subsequent documentation commits do not change
the tested runtime source.

[Review metadata](review.json) records exact commits, source/test hashes,
artifact hashes and the Windows Node 24.16.0 environment. Reproduce with:

```sh
node docs/performance-evidence/s49-view-target-prewarm-ownership/reproduce.mjs
node --test src/voice/gevActions.test.mjs
```

The source attribution for the original prewarm is documented in the
[S48 profile review](../s48-depth-pick-attribution/README.md). This fixes a
demonstrated ownership defect. It does not prove the cause of the historical
whole-application heap growth or the Windows frame/capture stall. S49 and S60
remain partial; physical rendering, matched performance and final retention
acceptance remain outstanding.
