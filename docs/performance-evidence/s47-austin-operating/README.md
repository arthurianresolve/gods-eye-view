# S47 Austin operating workload

This packet records the local fixture checkpoint on 2026-10-12. It does not
complete S47 or establish rendered, performance, stability, or hardware
acceptance. Application capture integration is still in progress.

| Requirement                                                   | Status at this checkpoint                       |
| ------------------------------------------------------------- | ----------------------------------------------- |
| Six native source adapters and pinned fixture inputs          | Implemented locally                             |
| Fixture source, response, clock, and ownership checks         | 33 focused tests pass; independent audits below |
| Full application capture integration                          | In progress                                     |
| Five matched runs, 30-second warmup and 60-second measurement | Pending                                         |
| Physical Windows GPU evidence and final soak                  | Pending                                         |

The earlier [source audit](source-audit.json) remains historical. The fixture
combines acquired metadata with explicitly synthetic radio and installation
records; it is not a historical reconstruction or a claim about live coverage.
CCTV frame responses are generated SVGs, not captured camera images.

## Independent review

The [corrected fixture audit](root-review/independent-fixture-audit.json) records
exact module, contract, and test hashes before and after its 15 controls. The
files did not change during that audit. It verifies native-style method access,
endpoint ownership, malformed requests, camera identity checks, rejection of
late work after disposal, required-delivery checks, and the actual installation response hash.
All 750 radio records satisfy the native catalog validator; 88 fall within the
initial camera rectangle. That last result is geographic coverage, not a
rendered visibility measurement.

The [initial failed controls](root-review/independent-fixture-audit-initial.json)
are retained. They exposed an unknown-camera acknowledgement being accepted and
zero radio records in the initial rectangle. The corrected implementation also
separates installation catalog identity from each filtered response's hash,
length, record count, requested bounds, and snapped response bounds. Missing
installation delivery and undeclared required asset IDs are rejected.

The subsequent [bounds audit](root-review/fixture-bounds-audit.json) passes five
additional controls. It verifies the 32-response-variant limit, repeat-response
counting without a new entry, rejection of a 33rd distinct variant, a bounded
redacted error history, and rejection of missing or unknown required assets and
tiles. These are contract checks, not a retained-memory measurement.

The fixture tests use the native source adapters and can be rerun from the
repository root:

```sh
node --test scripts/performance/austinOperatingWorkloadFixture.test.mjs
```

The independent JSON reports preserve the local review results; they are not CI
reports or candidate manifests. Later source changes require fresh validation.

The earlier [focused-suite checkpoint](root-review/focused-fixture-clock-checkpoint.json)
records 25 passing tests: nine fixture cases and sixteen shared clock/provider
cases. It binds the checked module and test hashes before and after execution.
The in-progress capture producer is outside that result's scope.

The subsequent [fixture and ownership checkpoint](root-review/focused-austin-ownership-checkpoint.json)
passes 33 tests across the three Austin suites and the shared provider/clock suite.
It verifies pinned catalog identities, changing installation subsets, rejection
of invented viewport counts, and document cleanup with valid session identity
and a fully drained request queue. Source and test hashes remained unchanged
during this independent run. The capture producer and paired-report validator
are still outside this checkpoint's scope.

After formatting and commit, the independent [committed-checkpoint recheck](root-review/focused-austin-ownership-committed.json)
also passes all 33 tests at `cd44d1df2bdcbb0e9ed401c4f813ea2a5709b998`.
The fixture/clock/ownership files match that commit; capture/comparison/smoke
work remains uncommitted and outside these test imports.

The [baseline source check](root-review/baseline-source-compatibility.json)
confirms that all six native endpoint adapters and the ALPR viewport implementation
are byte-identical between the frozen `eb8c682` baseline and the current candidate
ancestor. This supports using the same fixture routes on both builds; it does not
replace a built-application compatibility check.

The [observer API review](root-review/baseline-observer-api-compatibility.json)
also finds all 13 required native getter declarations in both revisions. Four
complete modules are unchanged; satellite and CCTV edits are outside the
observed getters. This is a static compatibility check, not proof that both
production builds complete the browser workload.

## Corrected native route coverage

The initial mathematical route audit incorrectly applied the installation
camera rectangle to ALPR. ALPR normally uses the centre ray's ellipsoid
intersection and twice the camera-to-ground distance. The rectangle is only its
fallback for viewers without `pickEllipsoid`. The initial zoom-11 coverage
conclusion is superseded; those acquired bytes and timestamps remain historical.

The [corrected route audit](root-review/native-source-route-audit.json) invokes
both actual layer viewport functions with a real Cesium `Camera`. It samples the
unchanged 12 km Austin starting pose and 19.2 km elapsed-time route at 100 ms
intervals. The native ALPR union is 12 zoom-10 tiles, x=232–235 and y=420–422.
The initial pose already covers this union. Each document must validate the
tiles required for its own scenario; source inventory alone is not delivery.

The [independent tile audit](root-review/native-tile-audit.json) verifies all
12 acquisition identities, timestamps, URLs, lengths and hashes: 63,222 bytes
decode to 952 unique records. Native nearby-area counts at 0, 1, 30 and 60
seconds are 776, 777, 746 and 704. These differ from the source catalog count and
from the count actually visible on screen. Browser capture must still verify
its pose, viewport, frustum, delivered tiles, readiness and rendered populations.

These are mathematical and source-adapter checks without WebGL. They cannot
establish rendering speed, pixel equivalence or resource retention.

The [installation population audit](root-review/installation-population-audit.json)
uses the native endpoint normalization, ingestion, viewport filter, and public
controls at the same saved camera poses. The source catalog contains 699 records, while normalized endpoint
responses contain 425, 475, 475 and 437 records at 0, 1, 30 and 60 seconds.
The corresponding native analyst and statistics populations are 357, 357, 340
and 357. Ingestion filters the endpoint response before exposing these rows.
The analyst API identifies each named installation by `record.name || record.id`,
so its identity hashes differ from the normalized source IDs. The report verifies
both projections and includes exact bounds. Rendering and ground services are
no-op fixtures in this audit; these are expected settled populations, not
rendered observations. Browser validation must also account for camera-change
debounce and confirm that the corresponding load completed.

## Source time and measurement time

The simulation starts at `2026-10-12T18:00:00.000Z`. Acquisition timestamps remain
separate, including snapshots fetched after that start time. Wind retains its
actual fixture valid time, `2026-10-08T12:00:00.000Z`, initially 4 days 6 hours
older than the simulation clock.

The [satellite phase audit](root-review/tle-phase-audit.json) checks 828 unique
objects through the native parser and propagation function. All 75,348
propagations at one-second checkpoints over 90 seconds are finite, and all 828
objects change position. Element epochs range from 2026-09-13 to 2026-10-12;
none follows the simulation start. Finite propagation does not prove current
orbital accuracy.

The full benchmark must advance simulation time deterministically during each
sample. A frozen clock would suppress genuine satellite position updates and
would not represent the agreed operating workload. Clock reset and boundary
validation are still part of the capture integration work.

## Clock integration review

The [independent clock audit](root-review/phase-clock-audit.json) verifies ten
30-second warmup / 60-second measurement cycles, guarded stale callbacks in
every phase, compatibility with existing single-use callers, and rejection of
a global sample ordinal passed to a new document's clock. These are Node
controls with simulated monotonic time, not timed browser runs.

The same audit executes the native satellite renderer's cadence with one
controlled propagation result. It reproduces an integration failure: the first
cycle propagates 90 times; rewinding the wall clock while retaining the same
layer state produces zero propagations in the second cycle. The native
`_lastPropagation` timestamp still belongs to the end of the preceding run.
Repeated samples therefore require fresh application documents; rewinding the
clock alone does not reset the workload. That capture correction is in progress.

The satellite witness uses `getAllPositions()` to read cached rendered positions.
The separate analyst-record API performs fresh propagation on demand and cannot
by itself establish that the rendered fleet advanced.

The [earlier unguarded callback reproduction](root-review/phase-clock-reentry-initial.json)
also remains available. Bound run tokens reject callbacks from an older run;
legacy callers without tokens retain their existing behavior. Tokens do not
solve retained layer timestamps or replace document lifecycle isolation.

Review also caught a document-local ordinal error before a browser run: a fresh
dense-provider document starts at run 1 even when it is the second overall
sample. Capture callbacks must use the clock's document-local ordinal. The
corrected capture producer and its lifecycle cleanup still need integration
validation; the clock checks alone do not establish that result.

Reproduce the clock and bounds checks from the repository root with:

```sh
node docs/performance-evidence/s47-austin-operating/root-review/phase-clock-audit.mjs
node docs/performance-evidence/s47-austin-operating/root-review/fixture-bounds-audit.mjs
node docs/performance-evidence/s47-austin-operating/root-review/installation-population-audit.mjs
```

Each command writes its current local observation to the adjacent JSON report.
The clock audit deliberately expects the native rewind failure to reproduce;
a successful audit does not mean that a shared-document capture is acceptable.

## Paired report integrity review

The [initial paired delivery audit](root-review/paired-delivery-integrity-initial.json)
preserves three failures in the unfinished integration: replacing an acknowledged
asset hash, removing acknowledged ALPR tiles, or removing acknowledged installation
identities still produced a comparable pair. The validator checked copied summary
fields without revalidating those raw delivery records. The unchanged positive
control passed. Exact working-tree file hashes were stable during the replay;
these observations do not describe the committed fixture checkpoint alone.

The [replay script](root-review/paired-delivery-integrity-audit.mjs) uses the real
fixture delivery producer with synthetic browser and build observations. It is a
Node integrity check, not browser or hardware evidence. Run it with a new output
filename to retain the original failures:

```sh
node docs/performance-evidence/s47-austin-operating/root-review/paired-delivery-integrity-audit.mjs paired-delivery-integrity-corrected.json
```

The repair and permanent rejection tests are required before the Austin integration
can be accepted. The diagnostic capture also remains ineligible for latency
acceptance until a mode without profiling instrumentation is validated.
