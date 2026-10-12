# S48 capture diagnostics on current dev

This branch ports the isolated capture and attribution work from
`947f1e121096436e6f8058f5c0f91b37b3a66902` onto current `dev`.
The isolated source's [failed hosted result](../s48-fixture-release-ownership/README.md)
is preserved. This port does not establish a rendering speedup or close S48.

The capture producer retains the reviewed isolated implementation. The smoke
producer also includes the import-boundary repair described below.
The integration retains the newer dev camera-verb, viewer-disposal and shared
prewarm ownership repairs. The map lifecycle and streamed HTTP evidence paths
also retain their dev implementations. Fixed caller labels add attribution to
existing depth picks only when the diagnostic observer is installed; ordinary
camera behavior, picking order, visual settings and render deadlines are retained.

The interception merge preserves S57's before-continue observation hook inside
the cancellable preparation lifetime. Regressions cover normal observation before
request handling, a blocked hook cancelled before target closure, and a hook
exception reported with its phase. Superseded hooks cannot send late commands.

Implementation and automated results are recorded independently from browser
and hardware acceptance. The full Node 24 suite passes; exact-commit hosted integration is still
required before promotion. No complete capture,
performance comparison, Windows soak or final-candidate pass is claimed.

## Invalid-input startup repair

Root's first full Node 24 run recorded 7,398 passes, one failure and ten existing
skips across 7,409 tests. The failing invalid-input CLI child returned no exit
code after 5,211.5 ms with a 5,000 ms subprocess limit. The original assertion
did not retain the spawn error code, so the raw result does not establish every
termination detail. [The original failed log](node24-original-failed.txt.gz) and
[structured counts](local-validation.json) remain preserved.

Source inspection found an unnecessary eager Cesium import through both the
infrastructure fixture and comparison validator. The lightweight workload IDs
and clock assertion now live in a separate module. The heavy fixture producer
loads only after CLI arguments validate. Its JulianDate conversion, pinned
asset hashes and populations are unchanged. The infrastructure validator takes
the independently constructed expected fixture from the producer and rejects
missing or mismatched expectations; it does not derive expected values from
the submitted report.

The CLI regression now fails immediately if invalid input attempts to import
Cesium, Puppeteer or application browser fixtures. Its existing five-second
bound is unchanged, and future failures retain exit status, signal, error code
and elapsed time. Root's [actual old/candidate CLI control](cli-import-review.mjs)
[confirms the dependency boundary](cli-import-review.json): the original attempts
Cesium before producing a failure report; the candidate attempts none of the
forbidden dependencies and writes the expected bounded SHA-validation failure.
This control uses a module-resolution guard and is not a browser measurement.

The focused smoke, infrastructure fixture and comparison suites pass 45/45.
Formatting passes for 1,597 adopted files, and package boundaries pass. The full
Node 24 rerun under the original suite scheduling passes: 7,413 passed, zero
failed and ten existing skips across 7,423 tests, including all fourteen
serialized allocation checks. The previously failing CLI test takes 358.249 ms
in this run. [The passing log](node24-fixed-passed.txt.gz) and structured counts are
preserved separately; the earlier failed run is not reclassified.

Full logs use gzip with verified byte-identical decompression; the manifest records
both compressed and original byte counts and SHA-256 hashes.
