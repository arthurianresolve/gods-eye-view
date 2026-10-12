# Austin render-boundary optional binding fix

The native-renderer diagnostic `38320527836` reached the first Austin idle
warmup after initial setup and the first fresh provider document passed source
readiness. It then failed before completing a sample with
`Render boundary observer arguments are invalid.` The preserved raw failure
report is [the unchanged downloaded capture](root-review/hosted-native-38320527836-cli-failed.json)
(145,345 bytes; SHA-256
`a1c8156a3c755e21dd5b47a2bc7cc83ecde6f0e72218e9b2d44b62ac5d7e6af5`).

The Austin caller intentionally has no persistent render-progress binding:
`activeRenderBoundaryProgressBinding` starts as `null`, and only the dense
flight-fixture path prepares one. The shared provider boundary helper forwards
that nullable optional value to `observeRenderBoundary`. The observer now
treats `null` like an omitted optional binding, while continuing to reject
malformed non-null bindings. This keeps the existing boundary deadlines,
clock hold, readiness requirements, and render behavior unchanged.

Regression coverage passes the actual producer-shaped `progressBinding: null`
case through the observer and verifies malformed binding objects still fail.
Focused validation:

```text
node --test scripts/performance/renderBoundaryObservation.test.mjs scripts/performance/settleCompletedRenderDiagnostic.test.mjs scripts/capture-scene-performance.test.mjs
41 tests passed
```

This fixes a harness argument-contract failure only. The native run completed no
performance samples and provides no renderer or hardware acceptance evidence.

## Follow-up: sample boundary scope

The corrected native run `38321326898` then settled warmup but exposed four
previously unreachable successful-sample references: the measurement boundary
result and phased-clock end snapshot were declared inside the provider branch
but consumed by Austin report assembly after that branch; the Austin comparison
validator was used without an import; and the outer smoke capture path
referenced the fixture under the `runRevision` local name rather than the
`fixture` parameter passed to `runCandidateCaptureCli`. The per-run boundary
values now live at sample scope, the validator is imported explicitly, and the
child report validator uses the fixture actually passed by its caller. No
measurement, timeout, population, or acceptance rule changed. The preserved
run still completed zero samples and remains a failure.

The regression uses the real `observeRenderBoundary` host-envelope producer and
passes its settled result through the elapsed-time projection and fixture-backed
Austin comparison contract. Root's source-level no-undefined audit also checked
the capture and outer-smoke call sites; the next hosted rerun is still needed to
exercise the complete browser capture path.
