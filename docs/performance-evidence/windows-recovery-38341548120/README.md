# Windows recovery: shutdown failure with process observations

[Standard CI run 38341548120](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38341548120)
tests candidate `9dfff5b47691ebb9b2a8c5895e7c0c0972d43a47`.
The [Windows recovery job](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38341548120/job/115113436043)
fails during shutdown of the upgraded application. This is hosted Windows with
SwiftShader, not physical GPU evidence.

All four attempted stages preserve settings, workspace contents and the saved
asset. The first three browser processes exit normally in 346–483 ms. The fourth
acknowledges `Browser.close` after 16.21 ms and disconnects after 25.66 ms, but
does not exit within the unchanged 5,000-ms gate (observed 5,006.45 ms). The fifth
stage is not reached.

The new bounded `SystemInfo.getProcessInfo` observation succeeds before all four
shutdowns. Before the failed close it reports one browser, two renderer, one GPU
and two other processes. The parent PID remains present at timeout; that probe
alone cannot prove process identity or exclude PID reuse. The separate WMI
snapshot times out. Forced cleanup subsequently confirms child exit with code 1,
8,040.95 ms after entry to the close helper.

These observations distinguish a remaining process from a missing protocol
acknowledgement. They do not identify the root cause, prove that a specific child
role blocked shutdown, or resolve the intermittent failure. Earlier failures
on both the prior and upgraded applications remain evidence; a passing retry
would not erase them. No shutdown deadline is relaxed and no candidate is promoted.

[Raw report](report.json) preserves the exact job-log evidence payload plus its
final newline: 12,512 bytes, SHA-256
`ea9314d029571eacfd06756f1e15df0cdbd62d13fbe08beb17b4555ec73f8ffe`.
The [independent review](review.json) records source identities, persistence,
timings, process observations and the limited conclusion.
