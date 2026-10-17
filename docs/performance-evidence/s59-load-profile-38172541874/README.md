# S59 heap trace calibration failure

[Original CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38172541874). Original artifact bytes are preserved in [report.json](report.json); SHA-256: `a51686bf4896a597495f4335f52010305d70aaeb794d47cd617fabf1bb3d244c`.

The exact d91e0873 heap diagnostic failed with an invalid trace attribution input. Its retained page result shows a console timestamp bracket of 24.6 ms, beyond the existing 2 ms precision gate. The geometry load completed in 30.9 ms, including a 22.1 ms coordinate-conversion span, but these are instrumented diagnostic observations from a failed report. No heap profile was retained after the attribution exception. Pages, browser and server clean up normally; browser shutdown takes 597.5 ms without forced termination.

Follow-up 20f5e257 moves a single calibration before sampled profiling and retains bounded profile/trace inputs before later attribution can throw. It does not retry or clamp a slow calibration.

This diagnostic is not full S47/S59/S60 acceptance or physical Windows evidence. Failed reports remain failed.
