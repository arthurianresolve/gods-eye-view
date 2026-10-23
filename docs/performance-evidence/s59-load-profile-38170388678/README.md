# S59 geometry profile: flow evidence retained, buffer metric unavailable

Frozen application/harness: f014be161467e4aedfc1470fdb31e39bda872f9b. Original report.json bytes are preserved.

The 50,000-position LineString retains its known geometry identity, native pick and fresh capture. The flow repair retains both observed start/end records with matching identity, no malformed records and no omissions. The profile still fails completeness because bufferUsagePeak is null: no periodic buffer usage event was observed in this short trace. It must not be replaced with zero.

Instrumented load wall time is 29.5 ms; coordinate conversion is 20.0 ms. These are diagnostic observations and are not an unprofiled comparison. Trace completeness remains failed, so the listed GC overlap is not accepted attribution.

Page cleanup leaves zero pages, the browser closes naturally in 1088.7 ms without forced termination, and Vite exit is confirmed. The collector currently consumes but does not persist the tracingComplete event's explicit dataLossOccurred boolean. Follow-up will retain that completion witness and independently validate delivery completeness while preserving unavailable buffer telemetry. Historical evidence is not retroactively changed.

[Hosted run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38170388678).

Original report SHA-256: c829f879fb4fb954a9d3ff673a632f4ccf2e5ae580537a2d7ad9f24bde78873a
