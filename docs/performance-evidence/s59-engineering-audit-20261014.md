# S59 import engineering audit

This is an implementation audit, not an import performance qualification. The
current S59 criterion requires complete records and selection, cancellable
stale-work ownership, bounded preparation and a decision about decode/UI work
based on measured costs. Large real-file import-to-render completion and
interaction qualification remain separate.

## Current implementation

| Area                               | Source and evidence                                                                                                                                                                                                                                                                                                                                                                                                    | Disposition                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cooperative work                   | [`cooperative.js`](../../src/imports/cooperative.js:2) has one owned scheduled wake, a 4 ms batch target, abort checks, iterator retirement and timer cleanup. [`geojsonCsv.js`](../../src/imports/geojsonCsv.js:132) validates GeoJSON feature records in batches; [`kmlGpx.js`](../../src/imports/kmlGpx.js:256) and [`kmlGpx.js`](../../src/imports/kmlGpx.js:360) batch placemark/waypoint/route/track conversion. | Present. The 4 ms value is a target between iterator steps; it cannot preempt one synchronous operation or one feature conversion.                                       |
| CSV completeness and summaries     | [`geojsonCsv.js`](../../src/imports/geojsonCsv.js:323) parses the entire CSV first, then builds accepted/rejected records and bounds/time summary in the batch iterator. [`geojsonCsv.test.mjs`](../../src/imports/geojsonCsv.test.mjs:220) covers empty, invalid, missing-time and duplicate rows; the large test covers full bounds and time range.                                                                  | Record and summary parity is covered. `scanCsv` remains synchronous and cancellation cannot interrupt it.                                                                |
| GeoJSON completeness and summaries | [`geojsonCsv.js`](../../src/imports/geojsonCsv.js:132) decodes the full input and calls `JSON.parse` before batched feature validation. `previewCancellation.test.mjs` exercises timer-delivered cancellation during feature/coordinate batches.                                                                                                                                                                       | Feature conversion is cancellable; decode and JSON parsing remain synchronous and indivisible.                                                                           |
| XML imports                        | [`kmlGpx.js`](../../src/imports/kmlGpx.js:67) parses XML synchronously before batched conversion. KML then scans all accepted records for altitude modes and scans placemarks for time-field selection after batching ([`kmlGpx.js`](../../src/imports/kmlGpx.js:299)); GPX similarly scans records to select its time-field label ([`kmlGpx.js`](../../src/imports/kmlGpx.js:455)).                                   | Parsing and the extra summary scans have no measured large-file attribution. They remain explicit unmeasured main-thread work; do not extrapolate the CSV result to XML. |
| Preview ownership and UI           | [`workspaceLibrary.js`](../../src/ui/workspaceLibrary.js:1289) owns an `AbortController` per staged preview, aborts superseded work, and checks the file/workspace owner before publishing via `showPreview`. The UI shows a preparation status and then a complete review summary; it does not publish partial records.                                                                                               | Stale results are fenced and the UI avoids per-batch DOM updates. There is no progress percentage; no measurement supports adding one.                                   |
| Apply/backpressure and rendering   | [`runtimeLayer.js`](../../src/imports/runtimeLayer.js:301) clears/cancels the previous load, uses the shared batch consumer, and only lets the current controller clear its owned state. Overlay labels are explicitly capped at 180 ([`runtimeLayer.js`](../../src/imports/runtimeLayer.js:19)); primitive point instances are separately owned and reported with units.                                              | Bounded and replacement-aware apply path is present. Application-level complete large-catalog/import-to-render behavior still requires qualification.                    |

## Measurement disposition

The immutable browser diagnostic [`import-browser-9e0109f1.json`](resume-validation-20261014/import-browser-9e0109f1.json)
uses five matched pairs after warmup. It records identical output hashes and
complete first/last IDs, but both proposed alternatives were slower in total
preview time: cooperative CSV ranged from 18% to 70% slower by pair, and the
GeoJSON worker ranged from 45% to 280% slower. The experiment is marked
diagnostic-only and performance-ineligible. Those implementations were
removed; the default path remains synchronous. This is a no-change decision
for those specific alternatives, not evidence that synchronous parsing has no
interaction cost.

The separate [`s59-csv-summary-pass-20261014.json`](s59-csv-summary-pass-20261014.json)
reports 4.15% lower median preview time for a CSV summary change, identical
output hashes, and one rejected row. It is diagnostic-only. The report records
different baseline, candidate and post-measurement source hashes; the final
API-forwarding correction was not timed again. The exact generator for this
report's 1,953,150-byte input was not retained, so its fixture hash cannot be
independently regenerated from the report. Do not infer that it is either of
the 50k-row fixtures below, and do not use the 4.15% as an accepted gain.

The reproducible [`s59-csv-summary-replay-20261014.json`](s59-csv-summary-replay-20261014.json)
uses the checked-in `compareCsvSummaryImplementations.mjs` generator and five
alternating pairs over the same deterministic 50,000-row, 2,653,380-byte
fixture. Baseline and candidate outputs matched exactly. In the retained run,
median total preview was 362.7 ms for baseline and 429.2 ms for candidate
(+18.3%). This retained run overlapped focused test activity on the same host,
so the timing is confounded and diagnostic-only. A prior exploratory run's raw
artifact was overwritten; only a console summary remains, so it cannot be
reproduced or used to infer run-to-run variability. Treat the retained result as
inconclusive, with no performance-gain evidence. The report pins baseline commit
`e20a84b863bb5a91d809bbdd78de4e59ced1897b`, baseline source SHA256
`b641993b975f53d4c396736d1079aa144e67754a4222fec713dde3bf972f492d`, and
candidate source SHA256
`45c9fe3097a768ee81b8dbc3d965be5baf8324ef71bb6e287e705a4ab14dc34f`.
Reproduce it with:

```sh
node scripts/performance/compareCsvSummaryImplementations.mjs qa-artifacts/s59-csv-summary-replay-20261014.json
```

The current-path XML diagnostic is [`s59-xml-import-current-20261014.json`](s59-xml-import-current-20261014.json).
It generated 4,000 KML placemarks (917,681 bytes) and 8,000 GPX waypoints
(808,417 bytes), with one warmup and five alternating pairs. Median
synchronous prefixes were 50.6 ms for KML and 64.2 ms for GPX; median total
previews were 83.5 ms and 115.4 ms. Each output matched its expected complete
summary and stable hash. Immediate cancellation after the synchronous prefix
rejected without returning a partial result, but cannot preempt UTF-8 decoding
or XML parsing. This current-path Node measurement does not isolate the KML
altitude/time summary scans and is not a before/after comparison or browser
qualification. Reproduce it with:

```sh
node scripts/performance/measureXmlImportSummary.mjs qa-artifacts/s59-xml-import-current-20261014.json
```

Reproducible fixture sources for the other retained diagnostics are:

- Node attribution: [`importInputAttribution.mjs`](../../scripts/performance/importInputAttribution.mjs),
  introduced at `99af2af31e783670940a00b99d9ee8c964567fac`; run from a clean
  checkout with:

  ```sh
  node scripts/performance/importInputAttribution.mjs qa-artifacts/import-input-attribution.json
  ```

  Its exact CSV and GeoJSON
  input digests are `08fd9f3332affc16a600018b7648b0a90c5b8dbcb29758a16e3864200b089e5d`
  and `8c2077a1ab3d030c4327558cb66a2bc58bffd01e08642310a9fa480e25a1f756`.

- Browser comparison: fixture generator
  `scripts/fixtures/import-input-comparison-fixtures.mjs` and page driver
  `scripts/fixtures/import-input-comparison.mjs` are retained in experimental
  commit `3c7142b2`. The fixture generator creates the exact inputs in
  [`import-browser-9e0109f1.json`](resume-validation-20261014/import-browser-9e0109f1.json)
  (CSV 50,000 rows, 2,477,807 bytes; GeoJSON 25,000 features, 3,527,821 bytes).
  Retrieve the original source without reintroducing the rejected runtime
  experiment with `git show 3c7142b2:scripts/fixtures/import-input-comparison-fixtures.mjs`.
- CSV summary comparison: [`compareCsvSummaryImplementations.mjs`](../../scripts/performance/compareCsvSummaryImplementations.mjs)
  regenerates the pinned input itself and loads baseline/current modules by
  their source identities.
- XML current-path diagnostic: [`measureXmlImportSummary.mjs`](../../scripts/performance/measureXmlImportSummary.mjs)
  regenerates both bounded XML inputs and verifies full summaries before
  retaining timing observations.

## Remaining boundary

No default CSV scanner, JSON worker, XML parser or progress-UI change is
justified by the retained comparisons. The demonstrated unresolved cost is
the indivisible synchronous decode/parse boundary; the KML/GPX post-batch
summary scans are also unmeasured. The next evidence, if these paths are
revisited, should use exact saved inputs and measure total preview plus
interaction/selection behavior before retaining another optimization. This
audit makes no browser/GPU or hardware-performance claim.

## S59.2 refresh and UI maintenance follow-up

The workspace UI follow-up is committed at `976cccea`, with race-edge coverage
in `cc7fe5f8` and saved-query ownership coverage in `a65ac748`. In
[`workspaceLibrary.js`](../../src/ui/workspaceLibrary.js), workspace refresh is
now single-flight with one latest pending pass: a newer request invalidates the
current pass before it can publish and a burst shares one follow-up read. The
existing refresh-generation, open-generation and active-owner checks remain in
place. Refresh skips replacing select children when values and labels are
unchanged, preserves a still-present recovery revision only while refreshing the
same workspace using the value current at publication time, and clears that
selection after switching workspaces. Saved-query selection uses the same
workspace identity rule, even when two workspaces expose the same query ID. If
an obsolete refresh fails while a
newer request is queued, the current task proceeds to that latest pass; a
failure from the latest owner still propagates and releases the in-flight slot.
[`workspaceLibraryImport.test.mjs`](../../src/ui/workspaceLibraryImport.test.mjs)
exercises overlapping requests, failed-read recovery, unchanged option lists,
same-workspace versus cross-workspace revision selection, and duplicate query
IDs across workspaces. The workspace import and read suites passed 32/32 tests.
This establishes unit behavior, not
a local-control p95 result.

The rest of catalog/source ownership is distinct from a mutable catalog
refresh. [`catalog.js`](../../src/app/catalog.js) captures an immutable app
catalog at construction; [`data.js`](../../src/app/data.js) registers those
instances and finalizes registration once. There is no dynamic catalog refresh
producer in the current app to coalesce. Live source refreshes have their own
owners: aircraft military classification uses a single-flight `_polling`
guard, source lifetime and bounded request signal in
[`classification.js`](../../src/layers/aircraft/classification.js); CCTV
geometry refreshes use a generation-fenced pending-record queue and coalesced
progress notifications in
[`geometryQueue.js`](../../src/layers/cctv/geometryQueue.js). Their tests cover
stale source/queue completion and retirement. These checks do not establish
complete large-catalog import-to-render behavior.

The separate `s59-csv-summary-pass-20261014.json` report records a 4.15% median
reduction, but its source identities differ from the current final
API-forwarding implementation and its exact fixture generator was not
retained. It is not a comparable result or accepted gain. The reproducible
comparison above is the only current replay; it was host-confounded and is
inconclusive. No raw first-run result was recovered or reconstructed.

Remaining S59 engineering limits are the indivisible synchronous CSV scan,
GeoJSON decode/`JSON.parse`, and XML parse; KML/GPX summary scans also lack
isolated attribution. The app catalog is static by construction, so any future
requirement for dynamic catalog mutation needs an explicit producer/contract
before implementing a refresh path. Final large real-file journeys, complete
rendered data, browser interaction limits, and primary-machine p95 remain
unqualified. This supports bounded maintenance/ownership work and a no-change
decision on the tested parser alternatives, not S59 closure or a hardware
performance claim.

## Subsequent CSV summary disposition

The [independent replay and decision](s59-csv-summary-decision-20261014/README.md)
preserve all five exact-source pairs at `da7a3308`. The median changes by -1.9%,
but four of five candidate pairs are slower. No repeatable benefit is established;
the CSV summary experiment is removed while existing GeoJSON batching/summary
and workspace fixes remain. Earlier implementation descriptions above apply to
their named revisions. The replay driver pins that experimental revision and
records the running harness separately. This is an explicit no-change decision
for the summary experiment, not a throughput claim or S59 closure.
