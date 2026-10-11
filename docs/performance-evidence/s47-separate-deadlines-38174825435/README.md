# Separate callback/render deadline diagnostic

[Run 38174825435](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38174825435)
tests exact application/harness `ac22669edbf07ad44a6927b979757f0fa9266685`.
The original [performance-build-smoke.json](performance-build-smoke.json) has
SHA-256 `4cc27f5f97e78bd7cb650f88602e51502d2fab6215c4d1db19691ca3093f367c`.
The frozen baseline remains `eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`.

The report remains **failed**, with three completed candidate samples retained.
This is a software-rendered integration diagnostic, not a matched performance
comparison. The baseline static-count/build check passes. The candidate's
fourth sample (scripted motion, run 2) reaches its measurement boundary and
fails the unchanged five-second page deadline.

The warmup boundary separates a 2,111.97 ms callback-entry wait from roughly
3,267 ms of page settling, completing after 5,372.16 ms on the host. This now
passes correctly. At the measurement boundary, callback entry takes only
4.86 ms. The next `preUpdate` occurs about 5,155.5 ms after page entry, followed
by `preRender` and a timeout report at roughly 5,187.8 ms. The page monotonic
deadline rejects this late frame even though the timer callback was delayed.
The failure is no longer explained by startup consuming the render allowance.

The diagnostic records actual slow SwiftShader frame intervals (the current
sample has a 3,507.7 ms interval and a 7,089.2 ms measured window for a requested
one second). These values are not clamped or converted to hardware results.
Five disposed probe documents are recorded. Failure serialization is bounded
and explicitly marked truncated; the artifact cannot establish full cleanup or
performance acceptance. Further work must attribute the delay before the next
update/render opportunity rather than silently increasing acceptance limits.
