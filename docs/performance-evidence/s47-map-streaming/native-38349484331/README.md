# First native map build-smoke attempt

[Hosted run 38349484331](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38349484331)
fails at exact application/harness candidate `14472b5b58174c7755f900278962c067d3d60e61`.
Its baseline is `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. This is a Linux
SwiftShader integration diagnostic, ineligible for performance or hardware
acceptance.

The [unaltered report](performance-build-smoke.json) is 4,793 bytes, SHA-256
`5592db01f8b6c421ef658bc9f0342a158ba5c5aa695bdf2da6326954cfb43371`.
GitHub artifact `11789997240` has archive digest
`2fa75f8003dd379420037fd67cbb5528cb31dc1cd8871b40ac09375443da431f`.
The run took 66.972 seconds including its setup clock.

The baseline reaches `production-provider-fixture-population`, then
`Runtime.callFunctionOn` exceeds the existing protocol deadline. Page errors
and interception errors are empty; no dense-population observation is
published. The candidate capture and native map journey are not reached.
Renderer-probe document cleanup exceeds its one-second deadline and its late
result reports a closed target. Worker-audit cleanup also times out. These
failed ownership observations remain failures.

This attempt still adds the native map profile to the inherited dense build
smoke, whose preparation enables 2,500 aircraft, 4,362 datacenters and 716 dams.
The selected map workload therefore does not yet have an independent setup
path. Inspect this preparation and its evidence coverage before another run;
keep the ordinary dense integration gate intact. The report does not establish
whether rendering, JavaScript work, worker completion or another cause blocks
the page. No deadline increase, hardware pass, source regression attribution
or successful retry is inferred from it.

Both fork/upstream main remain `8b8ccc9a81379e8b40d4be67610570ee5b159512`.
Local and remote dev match `e8ccc268608fbece8b6d87a0b6db86e1800ddf90`
(697 ahead, zero behind main). This QA candidate also contains main and dev
(52 ahead, zero behind dev). Its production `src`, `build` and server runtime
match dev; the only server difference is a test file. No main reconciliation
or production deployment occurred during this attempt.
