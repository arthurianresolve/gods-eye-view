# God's Eye View: sliced implementation plan for `dev`

Status: implementation code for S00–S31 is present on `dev` at `215a8d9`; hosted
CI passed on that commit in [run 37798558150](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37798558150).
Local gates also pass formatting, package boundaries, 6,328 unit tests (10
skipped), the production build and six browser journeys. S06 now includes
repeated same-machine base/candidate captures for selected-aircraft tracking,
three weather-history playback route runs, and passing positive/negative
motion-budget controls; the wider hardware matrix remains pending. S16's
second-profile bundle transfer passes in browser QA. Manual accessibility,
cross-platform install/upgrade, source-retention approval and signed-release
evidence remain external acceptance gates; see S11–S16 and S23, S30–S31. The
latest comprehensive candidate report is [`candidate-report-20261008-final4.json`](../qa-artifacts/candidate-report-20261008-final4.json)
and records 11 passed checks, zero failures and five pending external checks at
`fdd4d7d`; see the newer S06 artifacts below for follow-up coverage.
Prepared: 2026-10-08. Repository: `arthurianresolve/gods-eye-view`.
Integration branch: existing remote `dev`, verified to match `main` at
[`95fa816232456a6831172befa2f1b34b9ee73794`](https://github.com/arthurianresolve/gods-eye-view/commit/95fa816232456a6831172befa2f1b34b9ee73794).

This document turns proposed product improvements into independently reviewable
implementation slices. The current implementation scope and remaining evidence
are recorded in the ledger and [evidence support matrix](EVIDENCE-SUPPORT.md).
Repository paths in **Existing owners** refer to the original inspected revision;
paths marked **New** were proposed before implementation.

Contents: [outcome](#1-product-outcome-and-scope) ·
[baseline](#2-baseline-to-preserve) ·
[slice ledger](#3-delivery-sequence-and-slice-ledger) ·
[design decisions](#4-cross-cutting-design-decisions) ·
[implementation slices](#5-implementation-slices) ·
[validation](#6-validation-review-and-definition-of-done) ·
[risks](#7-risk-register-and-decisions-to-resolve) ·
[first handoff](#8-first-implementation-handoff).

## 1. Product outcome and scope

A user should be able to understand a scene within 90 seconds, inspect the
evidence behind it, save an investigation, and reopen the same evidence later.
Preserve the cinematic globe, local operation and keyless entry experience.

The delivery priorities are:

1. Reliable behavior, clear evidence and measurable performance.
2. Bounded regional recording and a shared investigation timeline.
3. Durable workspaces, assets, comparisons and exports.
4. Clear interaction, inspectable queries and personal data imports.
5. Reproducible releases and recovery from failed updates.

The first usable milestone does not depend on completing the whole plan. Each
milestone below must produce a working product with its new capabilities either
fully usable or explicitly unavailable.

### Scope boundaries

- Keep vanilla JavaScript, Cesium and the existing application/source/rendering
  boundaries. Use JSDoc and runtime validation for new contracts; no framework,
  language or globe-engine migration is required.
- Keep this an exploration and learning application. No named-person tracking,
  face recognition, emergency dispatch or navigation claims.
- Start history with explicit local recordings of a selected region. No promise
  of arbitrary past global coverage, continuous background capture when the app
  is closed, or a commercial historical-data service.
- Defer multiplayer editing, remote accounts, hosted synchronization, an executable
  plugin marketplace, global anomaly alerts and paid historical providers.
- Store normalized observations and explicitly permitted assets. Do not assume
  that permission to display a provider response includes retention or export.
  Review capabilities per source against [DATA_SOURCES.md](../DATA_SOURCES.md).
- A saved camera/layer view, a live-follow link, a historical snapshot and a
  cinematic scene remain distinct concepts with explicit conversions.

## 2. Baseline to preserve

| Area                  | Existing capability and owner                                                                              | Planned extension                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Application lifecycle | [Application construction](APPLICATION.md), `src/app/application.js`, `src/standalone/application.js`      | Inject evidence, time and storage services with the existing cancellation and teardown rules.                               |
| Evidence              | `src/data/feedState.js`, `src/data/layerSnapshot.js`, `src/data/analystEngine.js`                          | Add observation-level provenance and temporal semantics while retaining current feed-state behavior.                        |
| Time                  | `src/layers/weather/clock.js`, `src/director/clock.js`, launch replay                                      | Coordinate investigation time through adapters; preserve weather eligibility gaps and Director shot timing.                 |
| Views                 | `src/view/index.js`, `src/sharelink.js`, `src/ui/shareRestoration.js`                                      | Add explicit temporal references and recoverable workspace restoration.                                                     |
| Scene storage         | `src/director/document.js`, `src/director/sharing/`, `src/scenes/project.js`, `src/scenes/sharing.js`      | Persist permitted bundle assets and bind scenes to saved investigations. Scene schema is version 6 in the inspected source. |
| Interaction           | [UI ownership](UI-OWNERSHIP.md), [voice ownership](VOICE-OWNERSHIP.md), command dock and typed voice turns | Reuse existing actions for searchable commands, query editing and undo.                                                     |
| Rendering             | `src/renderGovernor.js`, `src/overlays/worldOverlay.js`, `src/data/detection.js`                           | Measured adaptive quality, without changing the records used by analysis.                                                   |
| Extension             | [Code boundaries](CODE-BOUNDARIES.md), [tools](TOOLS.md), `src/sources/sourceSlot.js`                      | Document and test a small adapter kit; no new module discovery system.                                                      |
| Validation            | `.github/workflows/ci.yml`, `scripts/qa-*.mjs`                                                             | Extend current unit/build/boundary, Windows onboarding, Street Level fixture and panel browser gates.                       |

Use the checked-out source and CI at the recorded revision when older narrative
documentation disagrees. In particular, do not describe browser CI as wholly
absent: the inspected workflow already runs Street Level and panel gates.
Reconcile documentation drift in S00 rather than propagating it into new tests.

### Compatibility rules

- Preserve all published layer tokens and their reservation ledger. Follow
  [CONTRIBUTING.md](../CONTRIBUTING.md) for allocation and merge-time checks.
- Existing share links keep their meaning and continue to open live/latest unless
  they explicitly carry the new temporal contract.
- Legacy scene documents migrate through the existing document parser. Unknown
  future versions fail before mutating the current project.
- Keep server credentials out of browser storage, URLs, exports, diagnostics and
  model context. Preserve the existing localhost and provider proxy policies.
- Existing public package exports retain their signatures; add optional fields
  or versioned contracts and update `scripts/package-boundaries.json` as needed.
- New UI consumes named operations and readers, not the entire application
  shell. New world text uses the existing world-overlay host.

## 3. Delivery sequence and slice ledger

One slice normally maps to one focused PR into `dev`. Small supporting commits
may be grouped inside it. If a slice cannot be reviewed as one coherent behavior,
split it with suffixes such as S14a/S14b and update the dependencies before coding.

Effort is relative: **S** is a focused change; **M** crosses a few owners; **L**
has migration, storage or multi-surface risk and should start with a narrow
implementation spike. These are not calendar estimates. Assign an implementation
owner and reviewer when selecting a slice; do not invent assignments in advance.
S00–S31 have implementation code. “Implemented” in this ledger means the scoped
code and repeatable local checks exist; it does not substitute for external
acceptance evidence such as named-hardware measurements, manual accessibility
review, a multi-OS install matrix, source-retention approval or a signed release.
Each slice row records those remaining conditions explicitly.

| Slice       | Deliverable                                                        | Depends on         | Effort | Milestone |
| ----------- | ------------------------------------------------------------------ | ------------------ | ------ | --------- |
| [S00](#s00) | Baseline journeys, fixtures and contract inventory **implemented** | —                  | M      | A         |
| [S01](#s01) | CI and contribution flow for `dev` **implemented**                  | S00                | S      | A         |
| [S02](#s02) | Evidence and temporal metadata contract **implemented**            | S00                | M      | A         |
| [S03](#s03) | Aircraft evidence through source, card and answer **implemented**  | S02                | M      | A         |
| [S04](#s04) | Evidence adapters and feed-health consistency **implemented**      | S03                | M      | A         |
| [S05](#s05) | Shared evidence inspector **implemented**                          | S04                | M      | A         |
| [S06](#s06) | Reproducible performance measurements **implemented; matrix pending** | S00              | M      | B         |
| [S07](#s07) | Adaptive presentation quality **implemented; remains opt-in**       | S06                | M      | B         |
| [S08](#s08) | Loading, cancellation and failure recovery **implemented**          | S04, S06           | M      | B         |
| [S09](#s09) | Investigation-time service and layer capabilities **implemented**   | S02                | M      | C         |
| [S10](#s10) | Transactional local storage foundation **implemented**             | S02                | L      | C         |
| [S11](#s11) | Bounded regional aircraft recorder **implemented; policy-gated**   | S03, S09, S10      | M      | C         |
| [S12](#s12) | Aircraft replay through a source adapter **implemented**            | S11                | L      | C         |
| [S13](#s13) | Timeline controls and live/replay transitions **implemented**       | S05, S12           | M      | C         |
| [S14](#s14) | Vessel recording and replay **implemented; policy-gated**           | S13                | M      | C         |
| [S15](#s15) | Weather and event time adapters **implemented**                     | S09, S13           | L      | C         |
| [S16](#s16) | Historical views and portable recording bundles **implemented**     | S13, S14, S15      | M      | C         |
| [S17](#s17) | Workspace document and transactional restore **implemented**        | S10, S16           | L      | D         |
| [S18](#s18) | Persistent Director and imported assets **implemented**            | S10, S17           | M      | D         |
| [S19](#s19) | Workspace library, autosave and recovery **implemented**           | S17, S18           | M      | D         |
| [S20](#s20) | A/B comparison and evidence reports **implemented**                | S05, S19           | M      | D         |
| [S21](#s21) | Workflow layouts and searchable commands **implemented**           | S05                | M      | E         |
| [S22](#s22) | Undo/redo for annotations and authoring **implemented**             | S17, S21           | M      | E         |
| [S23](#s23) | Guided entry **implemented**; accessibility study pending          | S08, S19, S21, S22 | M      | E         |
| [S24](#s24) | Inspectable query results across surfaces **implemented**           | S04, S09           | M      | F         |
| [S25](#s25) | Editable and saved queries **implemented**                          | S19, S21, S24      | M      | F         |
| [S26](#s26) | Validated GeoJSON and CSV import **implemented**                    | S02, S10, S19      | L      | G         |
| [S27](#s27) | KML and GPX import adapters **implemented**                         | S26                | M      | G         |
| [S28](#s28) | Source-adapter starter kit **implemented**                          | S04, S09, S26      | M      | G         |
| [S29](#s29) | Diagnostics and settings backup **implemented**                    | S08, S19, S24      | M      | H         |
| [S30](#s30) | Versioned releases and update recovery **implemented**             | S01, S19, S29      | L      | H         |
| [S31](#s31) | Candidate matrix **implemented**; rollout evidence pending         | A–G, S29, S30      | M      | H         |

The first wave has working code and repeatable local checks for its core path.
The first hosted `workflow_dispatch` run passed at commit
[`c996a25`](https://github.com/arthurianresolve/gods-eye-view/commit/c996a255c4063a93c0553fa3c3e31d09bc9d31b2),
including Node 24/26, Windows onboarding and the browser gates. The latest
hosted run passed on commit
[`a2d158f`](https://github.com/arthurianresolve/gods-eye-view/commit/a2d158f6ed85b0cf3a5b9db12ba96f606656d3c5)
(run [37741997092](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37741997092)),
including the end-to-end analyst evidence card and keyboard-pinned inspector
gate. The run passed Node 24/26, Windows onboarding, fixture, scene sharing,
aircraft evidence panel and portable panel checks.
The prior checkpoint at
[`54982ba`](https://github.com/arthurianresolve/gods-eye-view/commit/54982ba)
also passed run [37736662700](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37736662700).
S01 still needs representative pull requests to both `dev` and `main` to
exercise base-specific token checks. S04's common feed-state and snapshot
contract is wired; aircraft, AIS vessels and propagated satellites have
object-level evidence. The no-coverage classifier, wind issue/valid-time labels,
and camera still-fallback label have focused guards, while other source families
remain unsupported or lack attached evidence as detailed in
[EVIDENCE-SUPPORT.md](EVIDENCE-SUPPORT.md). Satellite evidence keeps the TLE
element epoch, position evaluation time and feed snapshot time distinct. S05
supports pinning aircraft and vessel evidence from analyst results and satellite
evidence from analyst results and tracked-object selections; refreshing or
changing the live selection leaves that snapshot fixed. Its browser gate sends a
synthetic `analyst_query` result through the application's voice card, activates
Inspect with the keyboard, and checks the pinned inspector, narrow/desktop layout,
focus return, safe links and teardown. S06 records browser/renderer and workload metadata, flags changing source
populations, and has a deterministic development-only aircraft fixture. A
three-run base/candidate/Auto comparison uses a stable 7,578-object dense scene
on Intel UHD 620; the motion-only 200 ms gate passed without injected delay and
failed with a 200 ms injected delay. The capture harness now also measures three
selected-aircraft tracking runs on that same base/candidate fixture; weather
history playback is covered by three repeated route runs over the three NOAA
weather layers. The tracking reports and playback evidence are linked from
[PERFORMANCE.md](PERFORMANCE.md). These results cover one machine; the wider
hardware matrix remains open. S07
only changes detection-label density and stays opt-in: Auto lowered density to
zero while retaining four selected labels, but its typical frame time did not
improve consistently.
The dependency table governs execution; numerical order is only a convenient
reading order. S06 and S09 can begin after their dependencies without waiting for
all of A. S21 and S24 can also land before full replay/workspace completion.
The first critical path is S00 → S02 → S03 → S04 → S05. The history path then
requires S09/S10 → S11 → S12 → S13. Do not block those paths on import formats
or release packaging.

### Milestone exit criteria

| Milestone                        | Demonstration required before enabling it by default                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Understand the evidence      | Select an aircraft, inspect source/time/position method, observe a feed outage, and receive an answer with the same limitations. Repeat for every supported evidence adapter. |
| B — Predictable interaction      | Run the same recorded workload on the declared hardware matrix; show bounded loading, stable selection, adaptive quality and recovery with measured results.                  |
| C — Revisit a regional session   | Record a permitted region, pause/scrub/replay aircraft and vessels, align available weather/events, export/import it and see explicit coverage gaps.                          |
| D — Continue an investigation    | Save, reload, restore assets, compare two times and export a source-linked report without changing the saved evidence.                                                        |
| E — Find and control the feature | A new user completes the first task within the proposed 90-second target; keyboard-only use, narrow layouts and reduced motion work.                                          |
| F — Inspect the answer           | Edit scope/filter/time, run a query, inspect records and omissions, save it and rerun against a chosen live or recorded source.                                               |
| G — Bring your own data          | Preview and import each supported format, handle invalid rows, retain attribution and use the resulting layer in a workspace.                                                 |
| H — Ship and recover             | Install a tagged candidate, reopen a migrated workspace, simulate an interrupted update and recover the previous supported state.                                             |

## 4. Cross-cutting design decisions

### 4.1 Evidence is a record, feed health is a state

Introduce a versioned, plain-data evidence envelope. Keep existing layer records
and IDs; reference the envelope rather than copying large metadata into every
rendered primitive. Proposed fields are:

| Field                                       | Meaning                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`, `observationId`, `entityRef`     | Envelope version; stable observation identity; existing `{layerKey, id}` entity identity.                                                                 |
| `sourceId`, `sourceRecordId`, `sourceUrl`   | Registered provider, provider identity if supplied and a safe source link.                                                                                |
| `observedAt`, `receivedAt`                  | Provider observation time, nullable when absent; local ingestion time. Never substitute one for the other.                                                |
| `snapshotAt`, `displayTime`, `elementEpoch` | Local feed snapshot time; time represented by the displayed sample; orbital element epoch when applicable. Keep all three distinct from observation time. |
| `validFrom`, `validTo`, `issuedAt`          | Optional validity interval and forecast/advisory issue time.                                                                                              |
| `method`                                    | `observed`, `interpolated`, `predicted`, `simulated`, `reconstructed` or `unknown`, plus derivation references where relevant.                            |
| `coverage`                                  | Area, applicable interval, completeness, truncation and missing-source reasons.                                                                           |
| `uncertainty`                               | Provider accuracy/uncertainty with units, or an explicit unknown. Do not manufacture a numeric confidence score.                                          |
| `licenseRef`, `retentionPolicyId`           | Source-policy references used for local retention, display and export decisions.                                                                          |

Dynamic render samples can reference several observations and their interpolation
method. Keep `displayTime` separate from observation time. Feed state remains
derived from the existing classifier; record provenance remains fixed after a
query, snapshot or recording captures it.

### 4.2 Four kinds of time remain distinct

- Wall clock: polling, deadlines, resource expiry and live freshness.
- Investigation clock: selected event time, pause and replay rate.
- Forecast issue/valid times: the time a model was issued and what it predicts.
- Director clock: authored shot duration and camera motion.

The proposed `src/time/` service receives a clock and publishes immutable state.
It does not overwrite Cesium's clock for every feature. Layer adapters declare
`live`, `recorded`, `provider-history`, `forecast` or `static` capabilities and
report available intervals plus the actual sample selected. A historical scene
must hide or explicitly segregate layers that cannot serve the selected time.
Static layers display their vintage or unknown vintage; present-day data cannot
silently appear as historical evidence.

Default history selection uses the latest eligible observation at or before the
requested instant with a source-specific maximum age. Offline interpolation may
use both bracketing observations only when visibly labeled as interpolation.
Analyst questions at a replay time use that time for age calculations, not
`Date.now()`. Live polling may continue separately but cannot overwrite replay.

### 4.3 Local storage and retention

Use an injected storage interface with an IndexedDB browser implementation for
metadata, observation chunks and bounded blobs. Keep portable document validation
independent of IndexedDB, DOM and Cesium. Do not introduce a server database for
the initial local-only product.

Use staged writes and an atomic manifest commit so incomplete saves are never
listed as complete. Record schema/app versions and checksums. Fail with a clear
export/recovery path if quota, private browsing or browser eviction prevents
persistence. Browser persistence is not a backup; offer file export.

Proposed starting limits, subject to S10 measurement: one active recording, a
selected region no larger than 250 km radius or its bounded equivalent, 60 minutes
per recording, 100 MiB per recording and 250 MiB total application-managed data.
Stop at the first applicable limit and show the reason. These are ceilings, not
promises about browser storage. Offer a lower limit on constrained devices.
Pinned workspaces are never silently evicted; temporary caches can use bounded
LRU eviction. Unknown retention permission disables recording for that source.

### 4.4 Restoration, sharing and migration

Explicit user intent wins: an opened share link, selected workspace or imported
project supersedes incidental persisted UI preferences. Apply restoration with a
generation token and cancellation signal; a new user navigation cancels pending
camera restoration. Validate and stage before replacing active state.

A URL may describe historical intent and refer to a local recording, but cannot
make that recording available on another machine. Missing data produces an
import/locate prompt and an unavailable state, never a silent switch to live.
Only permitted data goes into a portable bundle. Existing live links retain
their published semantics. Credentials and local absolute paths never enter URLs.

### 4.5 Performance and acceptance budgets

S00/S06 establish actual baselines. Initial targets below are proposals to accept
or revise with evidence before treating them as release gates:

- Fixtures: useful keyless scene in ≤3 seconds at p95 on the designated reference
  machine; measure boot, first useful frame and first usable record separately.
- Continuous motion: median ≥55 FPS and p95 frame interval ≤25 ms on the reference
  GPU; low-power profile median ≥30 FPS and p95 ≤50 ms on the declared integrated
  GPU. Do not apply motion FPS thresholds to intentional idle rendering.
- Local controls: p95 visible response ≤100 ms; loaded local replay seeks settle
  in ≤250 ms at p95 for the defined test recording.
- Lifecycle: after 20 enable/disable and open/close cycles, owned subscriptions,
  timers and resources return to baseline; investigate retained heap growth >10%
  after equivalent settling/GC in the controlled harness.
- Main-thread work: chunk import/recording work and investigate tasks >50 ms.
- Evidence: every supported result carries its scope, actual source time and
  completeness; any unavailable field is explicit.
- Usability: at least four of five first-time participants complete the defined
  first task within 90 seconds without coaching. Record the task, hardware and
  assistance; this small sample is a release signal, not a population claim.

Measure hardware-rendered performance on Windows integrated graphics, one Windows
discrete GPU and one supported macOS GPU, with exact renderer/browser versions,
1440×900 DPR 1 and a narrow viewport case. Headless software rendering can prove
behavior, not the hardware targets. Use identical record populations, camera
paths, warmup and foreground state for comparisons. Keep provider latency separate
from client processing and never present an empty/outage scene as a fast workload.

## 5. Implementation slices

The acceptance and validation listed for each slice supplement the common gates
in section 6. Each slice has an explicit rollback boundary; schema-changing work
must preserve readable backups before users can depend on it.

<a id="s00"></a>

### S00 — Establish baseline journeys and fixtures

**Depends on:** none. **Effort:** M.

**Outcome:** contributors can reproduce the starting behavior and identify which
improvements are real.

**Existing owners:** `scripts/qa-firstrun.mjs`, `scripts/qa-failstate-b10.mjs`,
`scripts/qa-application.mjs`, `scripts/qa-browserEvidence.mjs`, `TESTING.md`,
`docs/PERFORMANCE.md`, `docs/CURRENT-STATE.md`, `.github/workflows/ci.yml`.

**Work:** inventory existing harness inputs and reusable fixture hooks. Define
synthetic datasets for moving aircraft/vessels, duplicate/out-of-order reports,
partial coverage and weather gaps. Capture first launch, select/track, outage,
share restoration and scene import/export. Reconcile stale testing and document
version claims against the source. Write a short architecture decision record
for evidence/time/storage ownership, using section 4 as the proposed decisions.

**Accept:** fixtures use no credentials or live-provider responses; replayed
fixtures produce the same identities/times; baseline reports record commit,
workload and environment. Every unsupported or unmeasured case is labeled.

**Validate:** run the existing applicable harnesses and document their exact
invocations; check that intentional fixture corruption fails the relevant check.
**Rollback:** remove fixture wiring without altering runtime defaults.

<a id="s01"></a>

### S01 — Make `dev` a tested integration branch

**Depends on:** S00. **Effort:** S.

**Outcome:** each implementation slice is validated against the intended branch.

**Existing owners:** `.github/workflows/ci.yml`, `CONTRIBUTING.md`,
`scripts/check-layer-state-tokens.mjs`.

**Work:** add `dev` to push triggers and document PRs targeting `dev`. Fetch and
validate the actual PR base for layer-token checks instead of assuming every PR
targets `main`. Preserve current Node, Windows and browser jobs. Add the smallest
hermetic first-run/share smoke journey from S00 and upload failure evidence.
Document a stable `main` release promotion flow; do not silently change remote
branch-protection settings as part of a code change.

**Accept:** a PR to `dev` and one to `main` compare token reservations against the
correct base; an injected browser failure makes its job fail; logs contain no
secrets; unrelated upstream checks continue to run.

**Validate:** inspect workflow expressions and run the new fixture command locally;
the first hosted `dev` run passed at
[`c996a25`](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37734053904).
Still verify token-base behavior with pull requests targeting both `dev` and
`main`. **Rollback:** revert added triggers/jobs; retain all existing checks.

<a id="s02"></a>

### S02 — Define evidence metadata and compatibility adapters

**Depends on:** S00. **Effort:** M.

**Outcome:** observations can explain what was measured, when and by whom.

**Existing owners:** `src/data/feedState.js`, `src/data/layerSnapshot.js`,
`src/data/analystEngine.js`, `src/voice/layerManifest.js`.
**New:** focused validation/normalization modules under `src/evidence/`.

**Work:** implement the envelope in section 4.1, safe source references and compact
record references. Adapt legacy records without inventing missing timestamps.
Audit feed-state enums, severity ordering and labels together, including partial
and fallback states. Preserve existing query fields and add evidence fields.
Register any public export with the package-boundary gate.

**Accept:** unknown observation time remains unknown; receipt time cannot make
old data fresh; simulation and alternate-provider fallback remain distinguishable;
partial counts remain partial throughout chip, snapshot and answer handling.

**Validate:** focused unit tests for missing/invalid/future timestamps, mixed feed
states, contradictory metadata and old consumers. **Rollback:** ignore optional
evidence fields while keeping original record values and public signatures.

<a id="s03"></a>

### S03 — Ship aircraft evidence end to end

**Depends on:** S02. **Effort:** M.

**Outcome:** selecting an aircraft exposes traceable observations in both the
telemetry card and a query answer.

**Existing owners:** `src/layers/flights/records.js`,
`src/layers/flights/ingestion.js`, `src/layers/flights/tracking.js`,
`src/layers/military/records.js`, `src/data/trackedReadout.js`,
`src/data/analystEngine.js`, `src/voice/resultDisplay.js`.

**Work:** retain provider observation and ingestion timestamps; tag interpolated
or extrapolated display samples with their source observations. Add a compact
source/age/method readout to selected-aircraft details. Include evidence references
and loaded-record scope in aircraft results. Cover both civilian and military
adapters while sharing the normalized contract.

**Accept:** a delayed report is visibly delayed; changing camera or cockpit mode
does not change its provenance; a provider fallback preserves stable entity
selection; visual smoothing is never reported as a new measurement.

**Validate:** record normalization tests, analyst tests, `npm run test:track` and
the relevant heading/tracking harness identified in S00. **Rollback:** disable
new presentation and evidence attachment independently of ingestion/tracking.

<a id="s04"></a>

### S04 — Extend evidence and unify feed health

**Depends on:** S03. **Effort:** M.

**Outcome:** each supported layer explains data age, coverage and interpretation
using the same vocabulary.

**Existing owners:** `src/layers/vessels/`, `src/layers/satellites/`,
`src/layers/weather/`, `src/layers/earthquakes/`, `src/layers/cctv/`,
`src/data/layerSnapshot.js`, `src/loadingFeedback.js`, `src/tools/queries/`.

**Work:** add adapters in small commits by family: vessels; orbital predictions;
weather/earthquakes/fires; cameras; static/imported infrastructure. Document all
remaining adapters explicitly as unsupported until implemented. Distinguish
successful empty results, geographic noncoverage, credentials missing, throttling,
stale cache and source failure. Reuse the classifier in UI, HUD and tool results.

**Accept:** camera still fallbacks cannot read as live video; forecast valid time
cannot read as observation time; propagated satellites expose element epoch;
no-coverage cannot become an all-clear or a complete count of zero.

**Validate:** per-family fixtures and table-driven UI/tool consistency checks;
existing source tests and relevant fixture browser gates. **Rollback:** remove
one adapter at a time; unsupported evidence remains explicit.

<a id="s05"></a>

### S05 — Add a shared evidence inspector

**Depends on:** S04. **Effort:** M.

**Outcome:** users can inspect the evidence behind an object or result without
losing their place on the globe.

**Existing owners:** `src/ui/applicationShell.js`, `src/ui/panelChrome.js`,
`src/ui/templates/context.html`, `src/voice/resultDisplay.js`,
`docs/panel-surfaces.md`. **New:** `src/ui/evidencePanel.js`.

**Work:** render source links, observation/receipt times, displayed-time method,
uncertainty, coverage and license notices in one reusable panel. Provide concise
default detail and expandable technical fields. Bind selection by stable record
reference; a refreshed live entity must not rewrite a pinned result's evidence.

**Accept:** mouse and keyboard can open/close the panel and restore focus;
refreshing does not reset its scroll or expansion state; unknown values are
explicit; source links are safely rendered; no secret or raw request header leaks.

**Validate:** unit presentation tests and `npm run qa:evidence-panel`. The browser
gate sends a fixture result through the application's actual voice-card controls,
activates Inspect and Close by keyboard, changes the live selection while evidence
is pinned, and checks desktop/narrow bounds, focus return and teardown.
**Rollback:** remove the inspector entry point while retaining evidence on
data/query contracts.

<a id="s06"></a>

### S06 — Build a reproducible performance harness

**Depends on:** S00. **Effort:** M.

**Outcome:** performance changes have comparable workloads and retained evidence.

**Existing owners:** `scripts/qa-perf.mjs`, `scripts/qa-labels.mjs`,
`scripts/qa-overlay-baseline.mjs`, `scripts/qa-weather-perf.mjs`,
`src/ui/frameRateMonitor.js`, `docs/PERFORMANCE.md`.

**Work:** reuse fixture injection and scripted camera paths for idle, dense
detection, selected-aircraft tracking, mixed layers and weather playback. Measure
startup stages, frame interval percentiles, long tasks, live object counts and
available memory metrics. Separate cold acquisition, warm activation and steady
motion. Record renderer, browser, viewport, DPR and foreground state in JSON.

**Accept:** base and candidate consume identical fixtures; software rendering
cannot pass a hardware-performance claim; unavailable metrics are null with a
reason; capture overhead is excluded from timed windows. Adopt measured release
budgets explicitly and keep the original baseline immutable.

**Validate:** repeat each workload at least three times; deliberately add a local
render delay to verify regression detection, then remove it. **Rollback:** keep
the reports and remove only new instrumentation; no default-renderer change.

<a id="s07"></a>

### S07 — Adapt presentation quality to measured frame cost

**Depends on:** S06. **Effort:** M.

**Outcome:** the selected object and controls remain usable on constrained GPUs.

**Existing owners:** `src/renderGovernor.js`, `src/data/detection.js`,
`src/overlays/worldOverlay.js`, `src/ui/visualSettings.js`, layer renderers.
**New:** a small injected quality-policy owner under `src/performance/`.

**Work:** introduce Auto/Quality/Performance presentation profiles. Use a rolling
frame-time window, hysteresis and cooldown to adjust nonselected label density,
effect quality and renderer detail. Preserve the existing idle-render governor.
Start with labels/effects; expand to geometry only after independent measurement.
Expose which settings Auto changed and allow an explicit user override.

**Accept:** selected-object evidence and attribution remain visible; quality does
not oscillate around a threshold; record acquisition and analyst counts are
unchanged; hidden tabs suspend measurement; explicit visual presets round-trip.

**Validate:** pure policy tests using synthetic frame sequences, existing label
and render-governor gates, matched hardware A/B measurements. **Rollback:** fixed
profiles use existing settings; turning Auto off releases its overrides.

<a id="s08"></a>

### S08 — Make loading and recovery predictable

**Depends on:** S04, S06. **Effort:** M.

**Outcome:** slow or failing layers tell users what is happening and recover
without stale work moving the camera or reinstalling disabled content.

**Existing owners:** `src/loadingFeedback.js`, `src/ui/shellFeedback.js`,
`src/data/lifecycle.js`, `src/sources/sourceSlot.js`, provider request owners,
`src/layers/cctv/frames.js`, `src/layers/weather/`.

**Work:** expose bounded fetch/decode/install stages using real measurements,
cancel superseded viewport work and prioritize visible content. Make retry states
and last usable data explicit. Audit existing retries/backoff before adding any.
Add a bounded recovery path for WebGL context loss or a clear reload-with-restore
action where automatic recovery is unsupported. Avoid inventing progress percentages.

**Accept:** a 429 honors retry policy without a request storm; a failed refresh
retains accurately labeled prior data; disable stops owned work; navigating again
cancels old installs; GPU recovery preserves a recoverable view description.

**Validate:** fixture-driven timeout/429/decode/context-loss cases, the constrained
framebuffer regression in `npm run qa:render-resolution`, existing failure, weather
teardown and application lifecycle gates. **Rollback:** retain old loading
UI while reverting scheduling changes per provider rather than globally.

**Implementation checkpoint:** WebGL context loss now offers an accessible
reload action. It serializes the current share-link view at click time, preserving
camera, layer, panel and style state; before initial share restoration completes,
it keeps the incoming URL intact. No global retry loop was added: existing AIS
watchdog and map-provider policies already honor `Retry-After`, while weather
frame failures keep the previously displayed frame and expose the error. The
Recovery state and teardown have focused tests. Real-GPU context-loss behavior
and the broader supported-hardware matrix remain release evidence, not missing
code.

<a id="s09"></a>

### S09 — Introduce investigation time and capabilities

**Depends on:** S02. **Effort:** M.

**Outcome:** time can be selected without confusing observations, forecasts,
camera choreography or network deadlines.

**Existing owners:** `src/layers/weather/clock.js`, `src/director/clock.js`,
`src/app/application.js`, `src/standalone/`, `src/data/analystEngine.js`.
**New:** `src/time/` contract, state machine and layer-capability registry.

**Work:** implement `live`, `paused` and `replay` states, target time, playback
rate and monotonically increasing transition generation. Layers advertise
coverage and selected-sample time through adapters. Inject a query-time reader
into analyst age calculations. Define explicit arbitration when Director or
launch replay owns a local timeline; do not silently steal that clock.

**Accept:** rapid seek/return-live cannot install an obsolete frame; wall-clock
timeouts still expire while replay is paused; forecasts display issue/valid time;
unsupported layers never masquerade as historical. Destroy removes all listeners.

**Validate:** fake-clock transition and cancellation tests, weather-clock and
Director-clock regressions. **Rollback:** live remains the default; new adapters
can be detached without changing the existing clocks.

**Implementation checkpoint:** a separate live/paused/replay clock now exposes a
monotonic generation for stale-seek rejection and a playback rate, while wall
deadlines, Cesium, weather and Director clocks remain independent. Analyst age
calculations read the selected investigation time. A capability registry reports
live-only support, static vintage, provider/recording coverage, no-coverage and
unsupported states without substituting the latest live sample for history. Its
resolver cancels superseded batches, and a timeline arbiter requires an explicit
handoff. The service is application-lifetime-owned and destroyed with the catalog.
The application timeline, Director scenes and launch replay all claim the same
arbiter. An accepted handoff stops the previous owner before playback begins;
refusal leaves the current owner in control. Observed weather follows
investigation time at weather-frame boundaries. Unit race tests and the Chrome
timeline journey cover the integrated path.

<a id="s10"></a>

### S10 — Add transactional browser storage

**Depends on:** S02. **Effort:** L.

**Outcome:** permitted records and assets can survive reload with explicit quotas
and recoverable writes.

**Existing owners:** `src/standalone/application.js`, `src/scenes/project.js`,
`src/director/sharing/lifetime.js`.
**New:** `src/storage/` portable interface and IndexedDB implementation.

**Work:** define stores for manifests, immutable observation chunks, asset blobs
and workspace revisions. Implement staged writes, checksum validation, atomic
manifest publication, quota accounting and orphan cleanup after interrupted saves.
Expose storage estimates and optional persistence requests through explicit user
actions. Add read-old/write-new migrations with a pre-migration export path.

**Accept:** a failed transaction leaves the previous manifest usable; quota failure
cannot mark a save complete; two tabs cannot overwrite each other without revision
checks; closing the app releases handles; deleting temporary data never deletes
pinned workspaces. Unsupported/private storage gets an in-memory mode labeled unsaved.

**Validate:** unit tests against the storage interface plus real IndexedDB browser
tests for reload, two-tab contention, interrupted migration and simulated quota
failure. **Rollback:** use a versioned store; older builds reject unsupported
writes and offer recovery, rather than opening new data destructively.

**Implementation checkpoint:** the `./storage` package owns IndexedDB manifests,
immutable revisions, normalized chunks and asset bytes. Each write requires the
revision the editor last read; content checksums and the new manifest publish in
one transaction. Quota preflight and transaction failure leave the previous
revision readable. Pinning blocks deletion, cleanup removes unreferenced content,
and migrations return the old workspace as a pre-migration export alongside the
new revision. Unsupported/private IndexedDB falls back to clearly labeled
unsaved memory. Browser QA passed reload, two-tab conflict, aborted-write cleanup,
migration, quota preservation, pinning and checksum corruption cases. S19 now
adds the workspace library, debounced authored-state saves, recovery and explicit
reopen; the application owns and closes this store for its lifetime.

<a id="s11"></a>

### S11 — Record a bounded aircraft region

**Depends on:** S03, S09, S10. **Effort:** M.

**Outcome:** a user can deliberately capture one permitted regional aircraft
session for later inspection.

**Existing owners:** `src/layers/flights/ingestion.js`,
`src/layers/military/records.js`, `src/sources/sourceSlot.js`, `DATA_SOURCES.md`.
**New:** `src/recording/` session controller, policy and chunk writer.

**Work:** record normalized source observations at ingestion, never per-frame
interpolated positions. Persist region, source policy, start/end, source gaps and
schema version. Deduplicate identities/reports; retain meaningful corrections.
Enforce section 4.3 limits and expose stop/export/delete actions. Capture only
sources with documented retention permission; use synthetic sources until cleared.

**Accept:** recording is off by default; leaving the region does not silently
expand it; provider silence creates a gap; closing/suspending the page yields an
explicit interrupted interval; the first time/byte/quota limit ends capture cleanly.

**Validate:** deterministic 60-minute logical-clock fixture including antimeridian,
duplicates, corrections and capacity limits; real browser reload of the completed
manifest. **Rollback:** stop new sessions and keep existing recordings exportable.

**Implementation checkpoint:** the bounded aircraft recorder validates a local
region, captures normalized observations only, preserves same-time corrections,
marks outages and page-lifecycle interruption, and enforces duration, byte and
storage limits. Accepted flight snapshots now reach the recorder with provider
position times, and source changes stop the active session. The timeline exposes
camera-centered region inputs (0.01–250 km), source-specific start/stop controls,
active fix/gap counts and an explicit denial message. Synthetic-fixture unit tests
and Chrome coverage pass, including confirmation that current live providers are
not retained or exported. The remaining gate is written retention/export approval
for any live source; no real-provider archive is enabled.

<a id="s12"></a>

### S12 — Replay aircraft through the existing source boundary

**Depends on:** S11. **Effort:** L.

**Outcome:** recorded aircraft can be selected and followed using familiar controls.

**Existing owners:** `src/sources/sourceSlot.js`, `src/layers/flights/`,
`src/layers/military/`, `src/ui/navigationController.js`.
**New:** recording reader, time index and replay source adapter.

**Work:** index observation chunks by region/entity/time and emit source-compatible
snapshots. Implement source replacement with cancellation and restore the previous
live source on exit. Interpolate only between admissible samples with an explicit
method label; do not bridge source gaps or manufacture historical sightings.
Keep live polling, if retained, isolated from replay presentation and analysis.

**Accept:** seeking to the same time returns the same evidence; reverse/rapid seeks
cannot resurrect stale callbacks; selected identity survives when present and
reports absence when not; playback controls do not break camera ownership or terrain
handling. Playback rate changes do not change timestamps or query membership.

**Validate:** replay-source unit tests, tracking/cockpit fixture journey, sparse and
out-of-order recordings, seek latency under S06 workload. **Rollback:** detach replay
and return to live using existing source replacement; retain recording files.

**Implementation checkpoint:** replay selects the latest real observation at or
before the requested time, enforces coverage and gaps, caps loaded history, and
never falls through to live data. The application source router rejects late live
responses after a mode change and exposes dynamic temporal capabilities. Unit tests
cover actual sample selection and stale callbacks; the browser timeline journey
checks replay selection and return-live. Named-hardware seek-latency measurements
remain part of the S06 release evidence.

<a id="s13"></a>

### S13 — Expose the investigation timeline

**Depends on:** S05, S12. **Effort:** M.

**Outcome:** users can pause, scrub and return to live with visible coverage.

**Existing owners:** `src/ui/weatherPanel.js`, existing rail timeline controls,
`src/ui/panelChrome.js`, `src/ui/navigationController.js`.
**New:** `src/ui/investigationTimeline.js` consuming S09.

**Work:** show UTC with an optional local-time display, play/pause, step, speed,
live return and coverage lanes. Coalesce drag previews and cancel obsolete seeks.
Show requested time and actual sample time separately. Keyboard controls work
without conflicting with typing, voice push-to-talk or camera shortcuts.

**Accept:** gaps remain visible; seeking outside recorded coverage shows no-data;
replay has a persistent visible mode label; returning live reacquires current
data before labeling it live; accessibility announcements avoid per-frame spam.
Director playback/time conflicts have an explicit transition, not hidden coupling.
The timeline's capture controls scroll independently and do not crowd out Data
layer toggles.

**Validate:** keyboard/mouse/touch-sized controls, rapid seek/cancel, empty and
single-sample recordings, reduced motion and teardown; S12 tracking regression.
**Rollback:** hide the timeline entry and leave historical files intact.

**Implementation checkpoint:** the Data Layers panel now has aircraft and vessel
recording selectors, a shared UTC scrubber, step/play/reverse speed controls,
requested-versus-actual sample times, outage intervals, export/delete and Return
live. Selecting both movement recordings seeks them to the same investigation
instant. Controller race tests and a real Chrome journey pass. Director and launch
now participate in explicit timeline handoff. The capture controls have a bounded
scroll area so Data layer toggles remain independently reachable. Live source capture remains disabled
by policy where retention/export permission is absent; manual keyboard, touch and
screen-reader review remains part of S23 acceptance.

<a id="s14"></a>

### S14 — Add vessel recording and replay

**Depends on:** S13. **Effort:** M.

**Outcome:** one investigation can align recorded aircraft and vessel movement.

**Existing owners:** `src/layers/vessels/records.js`, `src/layers/vessels/`,
`server/providers/vessels/ais-store.js`, `src/tools/queries/`.

**Work:** implement the recorder/replay adapter for timestamped AIS observations,
including separate static metadata updates. Reuse the common store and clock;
keep MMSI/provider identity policy explicit. Do not backfill voyage history from
current metadata. Verify AIS retention/export terms before enabling the provider.

**Accept:** sparse AIS updates do not create a continuous observed track across
long gaps; corrected metadata remains tied to its validity/receipt time; aircraft
and vessel queries use the same investigation instant; source age remains visible.

**Validate:** sparse/coastal/no-coverage fixtures, vessel card and datum gates,
mixed-source seek and teardown. **Rollback:** mark vessel recording unsupported
while preserving aircraft replay and export of previously permitted data.

**Implementation checkpoint:** a bounded synthetic AIS recorder and replay adapter
preserve sea-surface positions, correction links, receipt-timed metadata revisions,
outages and sparse-track boundaries. The vessel source router has no live fallback
in replay, and the timeline can align vessel and aircraft histories. Unit and Chrome
mixed-source checks pass. Accepted AIS snapshots reach the recorder with their own
position times; a pending initial write is not exposed as active, avoiding a
revision race with the first feed update. The timeline shows bounded region controls,
per-source counts/gaps and policy denials. `DATA_SOURCES.md` records AISStream as
free beta with no formal terms; production AIS retention/export stays disabled
until written permission is established. Live AIS retention remains off.

<a id="s15"></a>

### S15 — Align available weather and event history

**Depends on:** S09, S13. **Effort:** L; split adapter families if review grows.

**Outcome:** movement replay can be inspected alongside temporally honest context.

**Existing owners:** `src/layers/weather/clock.js`, `src/layers/weather/source.js`,
`src/ui/weatherPanel.js`, earthquake/fire/cyclone source owners and tool queries.

**Work:** first adapt observed weather using its existing at-or-before selection
and product-specific gaps. Then adapt earthquake and fire observation windows to
recorded or provider-supported history. Expose forecast issue/valid time as a
separate context, and distinguish event occurrence from publication/revision time.
Satellites remain explicitly propagated predictions with element epoch; historical
elements are required before claiming historically grounded orbital reconstruction.

**Accept:** an unavailable past frame cannot silently use Latest; missing weather
does not stall aircraft playback indefinitely; layers report selected times and
gaps; unsupported cyclone/forecast history is labeled or hidden. Historical query
ages use investigation time. Image retention follows each provider policy.

**Validate:** multi-product timeline fixtures, existing weather journey/swap/teardown
gates, late advisory revisions and future-observation exclusion. **Rollback:**
detach each history adapter; preserve standalone weather history behavior.

**Implementation checkpoint:** the existing weather clock now follows the
investigation clock only when the at-or-before frame changes, preserving its
product-specific maximum gaps. The capability registry reports per-product
provider-history coverage and no-sample results; unit tests cover gap behavior,
latest restoration and avoiding per-tick image requests. USGS earthquake and
NASA FIRMS fire history use bounded provider requests and never fall back to
current observations when historical data is unavailable. Live cyclone advisories
are hidden while investigating the past; wind remains labeled as a forecast and
satellite positions retain their orbital-element epoch provenance. Unit tests cover
the historical-window, latest-restoration and coverage-gap contracts; a broader
provider-backed acceptance run remains external because it depends on source
availability and retention rules.

<a id="s16"></a>

### S16 — Share temporal intent and export recordings

**Depends on:** S13, S14, S15. **Effort:** M.

**Outcome:** users can share a historical view without confusing it with a live link.

**Existing owners:** `src/view/index.js`, `src/sharelink.js`,
`src/ui/shareRestoration.js`, `src/director/sharing/bundle.js`, `src/tools/views.js`.
**New:** versioned recording-bundle manifest and bounded import/export helpers.

**Work:** add validated temporal fields to the canonical view contract, including
target, source mode and recording reference. Design a recording bundle distinct
from Director's existing 32 MiB asset allowance; reuse integrity/path validation
without increasing old limits. Export normalized permitted observations, indices,
coverage and attribution with streaming/chunked assembly and explicit byte limits.

**Accept:** old links preserve their meaning; a link without available recording
bytes prompts to locate/import them; import validates before state change; future
versions, bad hashes and oversized payloads fail clearly. URLs contain no data
blobs, secrets or absolute paths. Same bundle/time reproduces the same evidence.

**Validate:** old/new URL round trips, legacy scene import, corrupt/truncated bundle,
missing source, second-browser import and restoration cancellation. **Rollback:**
stop emitting new temporal links while retaining their decoder/export recovery.

**Implementation checkpoint:** canonical views and share links now preserve a
validated historical target and source mode, including a local recording ID;
opening a recording link selects the referenced local source, while a missing
recording is reported with an import route. The timeline exports recordings as a
versioned, hashed, demand-streamed bundle and imports only after validating every
chunk and the manifest. Unit coverage and the Chrome timeline journey pass. The
browser gate now exports that recording, imports it into an isolated empty
Chromium profile, and verifies the new identity, preserved export policy,
coverage and replayed observation.

<a id="s17"></a>

### S17 — Define workspaces and transactional restoration

**Depends on:** S10, S16. **Effort:** L.

**Outcome:** an investigation has a durable identity and an explicit state model.

**Existing owners:** `src/view/index.js`, `src/ui/shareRestoration.js`,
`src/ui/navigationController.js`, `src/director/document.js`,
`src/annotations/annotationEngine.js`. **New:** `src/workspaces/` document,
migrations and restore coordinator.

**Work:** define workspace version, ID/revision, title, saved view, temporal source,
filters, pinned evidence, annotations, asset references and optional Director
project reference. Store data references rather than Cesium objects or duplicate
live state. Stage and validate restoration, then apply through existing operations
with generation-based cancellation. Specify partial restoration and rollback.

**Accept:** reopening preserves scope and evidence identity; unavailable assets,
providers or recordings are listed before/after application without fabricated
substitutes; new user navigation wins over late restore; a failed restore retains
the previous workspace. Old share links and scenes remain independently loadable.

**Validate:** schema/migration tests; restore during delayed layer startup, missing
keys, unknown future version and user interruption; application teardown regression.
**Rollback:** keep legacy startup available and export new workspace documents;
never downgrade new documents in place.

**Implementation checkpoint:** a versioned JSON-only workspace document now
captures the canonical saved view, temporal source, filters, pinned evidence,
annotations and integrity-addressed asset references. The restore coordinator
checks availability and stages before mutation, cancels superseded restores, and
rolls back a failed apply when it still owns the restore lane. Migration, future
version, missing-reference, user-navigation and rollback cases have unit tests.
S19 now supplies the library UI, and the workspace browser journey verifies
reload, explicit reopen, imported-layer rendering and revision-conflict recovery.

<a id="s18"></a>

### S18 — Persist Director and imported asset bytes

**Depends on:** S10, S17. **Effort:** M.

**Outcome:** a saved scene with permitted bundled assets survives a page reload.

**Existing owners:** `src/director/sharing/bundle.js`,
`src/director/sharing/lifetime.js`, `src/director/packs/session.js`,
`src/scenes/sharing.js`, `src/scenes/dataPacks/controller.js`.

**Work:** store validated asset blobs by content digest and reference them from
workspace revisions. Keep transient object URLs and renderer resources session-owned.
Implement reference accounting, orphan collection and explicit remove/export.
Retain the existing per-file/bundle/geometry limits and source license notices.
Do not persist live map tiles or external media merely because a scene references them.

**Accept:** a saved local bundle reloads without reimport; checksum mismatch prevents
use; deleting one scene does not remove an asset shared by another; a missing blob
is explicit; browser eviction never appears as a successful complete restore.

**Validate:** real browser import/save/reload and shared-asset deletion; existing
Director sharing/packs gates; owned object-URL/resource counts after teardown.
**Rollback:** retain blobs and export them via the current bundle format where
compatible; revert only automatic persistence wiring.

**Implementation checkpoint:** imported Director bundles now persist with the
validated scene project in revisioned browser storage. Each unique asset is keyed
by SHA-256, pack references are checked against the stored bytes before restore,
and missing or modified bytes fail explicitly. The Director waits for restoration
before application startup completes, migrates legacy localStorage projects, and
continues to own object URLs and rendered resources only for the current session.
Unit tests cover reload, integrity failure, missing assets, shared references and
removing unreferenced bytes from the next revision. `qa:director-sharing` passed
real IndexedDB import/save/reload, shared-asset deletion, no-network replay and
teardown checks. The Director pack QA passed its import/render/attribution gates;
its later photoreal-tiles readiness wait timed out in this keyless run.

<a id="s19"></a>

### S19 — Add the workspace library and recovery flow

**Depends on:** S17, S18. **Effort:** M.

**Outcome:** users can name, reopen, duplicate and recover their investigations.

**Existing owners:** `src/ui/panelChrome.js`, `src/ui/applicationShell.js`,
`src/scenes/director.js`, existing view/annotation change notifications.
**New:** workspace library and save-status UI under `src/ui/`.

**Work:** add Save/Save as/Open/Duplicate/Export/Delete with timestamps and storage
usage. Debounce autosave of authored state using document revisions; do not save
every camera frame or live observation as an edit. Preserve a bounded prior-revision
history and recover an interrupted draft. Make deletion scope and backup needs clear.

**Accept:** save status reflects the committed transaction, not a queued write;
switching workspaces cannot save late changes into the wrong document; two-tab
conflicts offer reload or save-as; interrupted saves expose the last complete
revision. A browser storage reset produces a clear empty state and import route.

**Validate:** save/reload/duplicate/delete journeys, quota and two-tab conflict,
dirty-state replacement, keyboard-only library use. **Rollback:** export/library
read access remains available even if autosave is disabled.

<a id="s20"></a>

### S20 — Compare evidence and export findings

**Depends on:** S05, S19. **Effort:** M.

**Outcome:** users can explain differences between two captured states.

**Existing owners:** `src/data/analystEngine.js`, `src/tools/queries/`,
`src/ui/applicationShell.js`, `src/overlays/worldOverlay.js`.
**New:** plain comparison model and report/export presentation.

**Work:** pin A/B evidence snapshots from one workspace, compare compatible fields
by stable entity identity and display an added/changed/no-longer-observed table.
Start with a single globe and instant A/B switching or overlaid tracks; the current
standalone shell supports one app per page, so two live viewers are deferred.
Export Markdown/JSON/CSV findings with UTC times, scope, source links, coverage,
method and license notices. Screenshots retain required map attribution.

**Accept:** absent coverage is not counted as disappearance; incompatible sampling
windows/units require explanation; comparison does not mutate A or B; later live
updates cannot rewrite the report. Spreadsheet-facing strings are safely escaped.

**Validate:** identity matching, duplicate reports, partial overlap, stale sources,
report round-trip and visual A/B navigation. **Rollback:** disable comparison UI;
keep pinned snapshots readable through the evidence inspector.

<a id="s21"></a>

### S21 — Clarify workflows and add searchable commands

**Depends on:** S05. **Effort:** M.

**Outcome:** users can find relevant controls without learning every panel.

**Existing owners:** `src/ui/templates/command-dock.html`,
`src/ui/applicationShell.js`, `src/ui/panelChrome.js`,
`src/ui/navigationController.js`, `src/voice/actionSchemas.js`,
`src/voice/gevActions.js`.

**Work:** create Explore/Investigate/Director layout presets on the existing panel
system. Add a searchable command palette backed by a curated registry of existing
operations, with availability reasons and keyboard hints. Bind UI/voice operations
through existing owners instead of implementing parallel actions. Preserve user
layout overrides and restore them when leaving a temporary workflow layout.

**Accept:** changing layout does not erase annotations, selection or evidence;
commands unavailable without a key/time source say why; palette search/focus/Escape
work on narrow screens; text entry does not trigger globe shortcuts.

**Validate:** palette filtering and availability tests, existing panel/location/scene
control gates and layout restoration. **Rollback:** existing dock/panels remain
usable when presets or palette entry points are removed.

<a id="s22"></a>

### S22 — Add bounded undo and redo

**Depends on:** S17, S21. **Effort:** M.

**Outcome:** users can safely revise annotations and authored scenes.

**Existing owners:** `src/annotations/drawTool.js`,
`src/annotations/annotationEngine.js`, `src/director/authoring.js`,
`src/scenes/director.js`. **New:** workspace-scoped command history.

**Work:** record validated before/after deltas for add/edit/delete annotations and
scene-authoring changes. Group a drag or multi-vertex drawing gesture as one action;
cap history by count and bytes. Route matching UI and voice edits through the same
commands. Do not treat live telemetry, microphone sessions, downloads or provider
requests as undoable edits.

**Accept:** undo restores IDs, references and authored values; editing after undo
clears redo; switching workspaces cannot undo another workspace; cancelled async
annotation resolution cannot recreate an undone mark. Native text-field undo works.

**Validate:** command inverse tests and a browser edit/undo/redo/save/reload journey;
existing draw/Director interaction gates. **Rollback:** disable history capture
while retaining the current authored document and edit operations.

<a id="s23"></a>

### S23 — Improve first use and verify accessibility

**Depends on:** S08, S19, S21, S22. **Effort:** M.

**Outcome:** the core experience is discoverable, readable and controllable across
input methods and constrained screens.

**Existing owners:** `src/ui/templates/welcome.html`, `src/keySetup.js`,
`src/ui/surfaceKeyboard.js`, `src/ui/styles/`, first-run and panel harnesses.

**Work:** refine existing first-run missions around three tasks: explore a live
object, inspect its evidence and save a workspace. Offer a clearly labeled bundled
synthetic demo when offline, with redistribution-safe assets and an offline map
fallback. Add contextual empty/error guidance. Audit focus order, names, contrast,
target sizes, reduced motion and screen-reader status announcements.

**Accept:** the keyless path has no mandatory account/key interruption; demo data
cannot be mistaken for live; all new flows work with keyboard alone and at 200%
zoom; critical states use text as well as color; the proposed first-task usability
target is measured on named tasks, not assumed from automated tests.

**Validate:** first-run fixtures, accessibility checks plus manual keyboard and
screen-reader inspection, five-participant usability exercise. **Rollback:** retain
existing missions while removing a problematic new guide step.

<a id="s24"></a>

### S24 — Make every query result inspectable

**Depends on:** S04, S09. **Effort:** M.

**Outcome:** the answer's records, scope and limitations are available beside it.

**Existing owners:** `src/data/analystEngine.js`, `src/tools/`,
`src/voice/resultDisplay.js`, `src/voice/referents.js`,
`src/voice/gevActions.js`, `src/hud.js`.

**Work:** extend result metadata with normalized query, source mode, investigation
time, included layers, total/returned/truncated counts, coverage and evidence
references. Display a concise explanation and an inspect-records action. Snapshot
results so follow-up queries preserve original provenance unless explicitly rerun.
Ensure voice/MCP/UI projections share the result contract without forcing every
surface to offer identical tools.

**Accept:** a bounded loaded-data query is never narrated as a global census;
partial/unavailable sections survive model narration; stale follow-ups cannot be
relabeled current; cancelled turns cannot publish into a replacement session.
The deterministic result remains useful even if model narration fails.

**Validate:** analyst/tool/result-display unit tests, fixture voice action execution,
MCP structured-result compatibility and result inspection journey. Real audio
checks are separate when session wiring changes. **Rollback:** preserve legacy
result fields and remove optional explainability presentation first.

<a id="s25"></a>

### S25 — Add editable and saved queries

**Depends on:** S19, S21, S24. **Effort:** M.

**Outcome:** users can inspect, modify and rerun the question the application asks.

**Existing owners:** `src/data/analystEngine.js`, `src/voice/actionSchemas.js`,
`src/voice/realtimeTurns.js`, command dock and S19 workspace storage.
**New:** deterministic query form/editor and saved-query document.

**Work:** expose supported area, layer, filter, ordering and time fields through
native controls. Existing typed natural-language input may propose the same query
document; deterministic editing/running remains usable without an AI key. Save
query intent separately from pinned result snapshots. Add explicit Run now/Run at
selected time and record the result's evidence reference.

**Accept:** changing a query does not silently mutate a pinned result; unsupported
fields get validation errors; replay queries never fall back to live; saves preserve
units and geographic scope; natural-language interpretation is visible and editable.
No automatic background alerts or continuous paid model calls are introduced.

**Validate:** schema and query-equivalence tests, typed/form result parity, save/load,
missing-layer handling and cancellation. **Rollback:** keep saved documents
exportable and existing voice/typed queries available.

<a id="s26"></a>

### S26 — Import GeoJSON and CSV with preview

**Depends on:** S02, S10, S19. **Effort:** L.

**Outcome:** users can add their own permitted geographic observations safely and
understand how they will be interpreted.

**Existing owners:** `src/director/packs/geojson.js`,
`src/data/localGeojsonCore.js`, `src/data/localGeojsonLod.js`,
`src/scenes/dataPacks/geometry.js`. **New:** `src/imports/` staged parsers and preview.

**Work:** reuse geometry validation for GeoJSON; add CSV column mapping for ID,
latitude/longitude, time, units and optional provenance. Default to explicit WGS84
longitude/latitude and reject unsupported coordinate systems until an adapter exists.
Preview accepted/rejected counts, bounds, sample rows, time interpretation and
attribution. Chunk/worker parsing must remain cancellable and bounded by bytes,
rows, geometry vertices and nesting. Commit only after explicit Apply.

**Accept:** reversed/out-of-range coordinates, malformed rows and ambiguous date
formats cannot silently create plausible data; CSV formulas and HTML remain inert;
cancel leaves the workspace unchanged; missing observation time stays unknown;
an imported layer participates in evidence inspection and workspace save/reload.

**Validate:** valid/invalid and large-but-bounded fixtures, antimeridian/poles,
timestamp offsets/DST ambiguity, cancellation, quota failure and a full import
journey. **Rollback:** disable import entry points; existing imported assets
remain inspectable/exportable through their versioned document.

<a id="s27"></a>

### S27 — Add KML and GPX adapters

**Depends on:** S26. **Effort:** M.

**Outcome:** common geographic files enter the same preview and evidence pipeline.

**Existing owners:** S26 parser interfaces, existing annotation/geometry rendering.
**New:** bounded KML and GPX parsers under `src/imports/`.

**Work:** support a documented subset: KML placemarks/lines/polygons and GPX
waypoints/routes/tracks with optional times/elevations. Reject external entities,
network links, scripts and remote asset fetching. Treat unsupported extensions as
explicit warnings or errors. Defer KMZ archives to avoid introducing decompression
and remote-resource policy into this slice. Preserve original attribution.

**Accept:** file loading performs no network request; unsupported altitude modes and
coordinate semantics are disclosed; tracks without times stay untimed; malformed
XML fails within limits; all accepted features use the S26 apply/cancel behavior.

**Validate:** namespace variants, missing timestamps, unsafe XML, oversized content,
unsupported geometry and save/reload/export fixtures. **Rollback:** remove only
the format adapters; retain the normalized imported data and preview framework.

<a id="s28"></a>

### S28 — Publish a small source-adapter starter kit

**Depends on:** S04, S09, S26. **Effort:** M.

**Outcome:** contributors can add a well-behaved source without copying app internals.

**Existing owners:** `src/sources/sourceSlot.js`, `src/layers/`,
`src/app/layers/`, `src/tools/services.js`, `scripts/package-boundaries.json`,
`docs/CODE-BOUNDARIES.md`, `CONTRIBUTING.md`.

**Work:** document a minimal source contract for acquisition, normalization,
cancellation, evidence, temporal capability and retention policy. Ship a synthetic
example adapter, conformance fixtures and a short registration guide. Separate
source, renderer, UI and optional server proxy responsibilities. Explain layer
token allocation and how a tool can query the same source without loading Cesium.
Use existing factories/exports; do not add arbitrary runtime code loading.

**Accept:** the example works keylessly, passes boundary checks and tears down
cleanly; malformed observations and ignored cancellation fail conformance; adding
it needs no edits to unrelated layer internals; source attribution is visible.

**Validate:** build the example through declared exports, run conformance tests and
an enable/query/disable browser journey. **Rollback:** remove the example/docs
without changing supported runtime adapters or published token reservations.

<a id="s29"></a>

### S29 — Add useful diagnostics and settings backup

**Depends on:** S08, S19, S24. **Effort:** M.

**Outcome:** users can understand failures and preserve nonsecret configuration.

**Existing owners:** `scripts/setup-doctor.mjs`, `src/keySetup.js`,
`src/voice/realtimeDiagnostics.js`, `src/ui/frameRateMonitor.js`,
provider stats and S10 storage diagnostics.

**Work:** add an on-demand diagnostics view containing app/schema versions,
renderer, capability availability, feed state/latency, retry state, storage usage
and sanitized recent errors. Export a bounded report after preview. Export/import
an allowlisted settings file with units, visual preferences and source selections;
include only presence flags for credentials, never their values or URLs containing
them. Keep workspace data export a separate action.

**Accept:** reports omit credentials, headers, raw voice transcripts and local
absolute paths; user content appears only when explicitly included; invalid backup
does not partially apply; provider failures have actionable messages; no background
telemetry upload or support-message sending is added.

**Validate:** secret-canary redaction tests, malformed/old settings migrations,
doctor parity and keyboard-operated diagnostics/export. **Rollback:** retain CLI
doctor and file decoders; remove diagnostics UI or optional reporting fields.

<a id="s30"></a>

### S30 — Ship versioned releases and recoverable updates

**Depends on:** S01, S19, S29. **Effort:** L.

**Outcome:** users can install a known version and recover when an update fails.

**Existing owners:** `scripts/pinokio-install.mjs`,
`scripts/pinokio-update.mjs`, `scripts/pinokio-preflight.mjs`,
`package.json`, `.github/workflows/`, `CHANGELOG.md`.

**Work:** define stable release tags and an explicit development channel. Build
release artifacts from locked dependencies with checksums and a version manifest.
Extend existing update disclosure with preflight, target-commit pinning, dirty-tree
handling, schema compatibility checks and documented recovery. Stage updates away
from the working install where supported; do not claim app-file rollback restores
browser data. Require an export/checkpoint before irreversible storage migration.
Keep the terminal and Pinokio paths supported; a new desktop wrapper is out of scope.

**Accept:** update installs the disclosed revision; interruption retains a working
old install or a tested recovery route; custom remotes/user changes are not
overwritten; older apps refuse unsupported new data without erasing it; rollback
instructions recover both executable version and a compatible workspace backup.

**Validate:** clean install and upgrade on Windows/macOS/Linux; simulated failed
download/dependency install, changed remote, dirty tree, unsupported Node and
storage migration rollback. **Rollback:** mark the candidate withdrawn and return
the release channel to the previous artifact; do not delete or rewrite published
tags. Retain manual recovery and previous artifacts.

<a id="s31"></a>

### S31 — Validate and roll out the release candidate

**Depends on:** milestones A–G, S29, S30. **Effort:** M.

**Outcome:** default-enabled features are supported by end-to-end evidence.

**Existing owners:** `scripts/qa-l9-matrix.mjs`, relevant `scripts/qa-*.mjs`,
`docs/PERFORMANCE.md`, `TESTING.md`, `CHANGELOG.md`, `README.md`.

**Work:** compose the milestone journeys into a candidate matrix. Run a 60-minute
mixed-use soak, repeated source toggles, tracking/cockpit, replay seeks, workspace
switching, import/export and failure recovery. Run hardware and usability checks
from section 4.5. Review provider retention decisions, migration fixtures, docs and
diagnostic redaction. Enable features in milestone order after their gates pass.

**Accept:** no unresolved blocker affecting correctness, storage integrity or the
advertised core journeys; all skips name the missing environment/coverage; supported
platform results and known limitations are published; release notes distinguish new
capabilities from experimental adapters. Confirm the tested and released commit match.

**Validate:** common gates, applicable focused browser gates, clean release install,
one prior supported version migration, hardware matrix and milestone demonstrations.
**Rollback:** revert default exposure or return to the prior supported release;
preserve data recovery readers and the backups created before migration.

**Implementation checkpoint:** hosted CI passes at `215a8d9`. The local candidate
matrix at [`candidate-report-20261008-final4.json`](../qa-artifacts/candidate-report-20261008-final4.json)
passes formatting, package boundaries, 6,328 unit tests (10 skipped), the
production build, six browser journeys and the repeated UHD 620 performance
controls. Follow-up S06 selected-tracking and weather-playback runs and S16
fresh-profile transfer also pass. It reports zero local failures and remains
`pending-evidence` for representative pull-request events, cross-platform
install/upgrade, the 60-minute soak, broader named-hardware coverage, manual
accessibility and participant review, live-source retention approval, and
signed-release matching.
## 6. Validation, review and definition of done

### Common implementation gates

Follow [CONTRIBUTING.md](../CONTRIBUTING.md) and the existing
[review workflow](MAINTAINER_WORKFLOW.md). For runtime slices, use the repository's
supported Node version and locked dependencies, then record results for:

```sh
npm ci
npm run doctor -- --json
npm run format:check
npm run check:boundaries
npm test
npm run build
```

Run `npm run format` for adopted code before validation, keeping unrelated
mechanical changes out of feature commits. Run `npm run dev` in a separate process
and, with the candidate server at `http://localhost:4173`, run:

```sh
npm run test:track
```

Run the focused feature gate as well. Its header is the authority for supported
arguments, fixtures, keys and browser requirements; do not assume every
`qa-*.mjs` file is an executable or takes the same flags. Stop the dev server
before using the same port for `npm run preview` and inspect the built app.
For a layer-token change, compare against the actual target base after fetching
it, e.g. `npm run layer-token:check -- --base-ref fork/dev` in this checkout.
CI should use the PR base as described in S01, not this local remote name.

Existing browser-gate families worth reusing:

| Changed behavior           | Existing starting points                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Startup, failure, teardown | `qa-firstrun.mjs`, `qa-failstate-b10.mjs`, `qa-application.mjs`, `qa-ui-disposal.mjs`                        |
| Tracking and camera        | `npm run test:track`, `qa-camera-controls.mjs`, `qa-cockpit-utility.mjs`, `qa-focus-evidence.mjs`            |
| Panels and commands        | `qa-panel-resize.mjs`, `qa-location-controls.mjs`, `qa-scene-controls.mjs`                                   |
| Weather                    | `qa-weather-journey.mjs`, `qa-weather-swap.mjs`, `qa-weather-teardown.mjs`, `qa-weather-perf.mjs`            |
| Director/authoring         | `qa-director-sharing.mjs`, `qa-director-packs.mjs`, `qa-director-interactions.mjs`, `qa-director-timing.mjs` |
| Rendering                  | `qa-perf.mjs`, `qa-labels.mjs`, `qa-overlay-baseline.mjs`, relevant layer gates                              |
| Voice session changes      | `qa-voice-wav.mjs` in normal and `--push-to-talk` modes, using configured test credentials                   |
| Attribution and sources    | `qa-attribution-b12.mjs`, `qa-cctv-v2.mjs`, `qa-vessel-cards.mjs`, `qa-firms.mjs`                            |

New fixture journeys should reuse these entry points or their shared support
modules. Introduce a new harness only for behavior they cannot express. Keep
live-provider smoke checks separate from deterministic CI; provider outages
cannot make fixture correctness pass or fail arbitrarily. A skipped required
check remains missing evidence and must be resolved before that feature's release.

### Definition of done for each slice

- The acceptance demonstration works in the composed app, including loading,
  empty, unavailable, cancellation and teardown states relevant to that slice.
- Tests assert observable behavior, including a plausible regression; they do
  not merely match source text or duplicate the implementation.
- Public contracts, published links, layer tokens, old documents and provider
  attribution remain compatible or have an explicit tested migration.
- Validation includes exact commit, environment, commands and outcomes. Visual
  changes include screenshots/interaction evidence; performance claims include
  real renderer/workload measurements.
- Runtime changes update `docs/CURRENT-STATE.md` and `CHANGELOG.md`; provider
  changes update `DATA_SOURCES.md`; new package exports update boundary metadata.
- The rollback boundary is exercised for storage, update and state-restoration
  work. No credential or provider-restricted data appears in committed evidence.
- Update this ledger with completed scope, commit/PR reference, validation and
  deferred cases. Merge a slice into `dev` only after its applicable checks pass.

Documentation-only changes, including this plan, require content, path/link,
dependency and whitespace checks. They do not require installing the application
or running the runtime suite solely to validate prose.

## 7. Risk register and decisions to resolve

These are implementation work items, not questions blocking the planning commit.
The listed defaults make the next slice concrete; change them only with recorded
evidence and update the dependent slices.

| Risk or decision                                                   | Default / mitigation                                                                                                                      | Resolve in          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Retention rights differ by source                                  | Unknown permission means recording/export off; synthetic fixtures unblock development. Record separate display/retain/export permissions. | S02, S11, S14, S15  |
| Several clocks compete for scene/camera state                      | Investigation time is injected and independent; Director/launch time is explicit; generation tokens reject stale work.                    | S09, S12, S13       |
| Browser storage eviction, quota and interrupted saves              | IndexedDB with bounded chunks, committed manifests, revisions and explicit file backup. Never call browser persistence a backup.          | S10, S18, S19       |
| Replays imply complete history                                     | Coverage intervals and source gaps travel with data; no interpolation through gaps; no silent live fallback.                              | S11–S17             |
| Recording duplicates or contradicts observations                   | Provider/entity observation IDs, correction handling and immutable provenance; keep receipt and event time separate.                      | S02, S11, S14       |
| Automatic quality changes alter meaning                            | Presentation-only controls; selected evidence and underlying analytical records are protected.                                            | S07                 |
| Multiple viewers double state/GPU use                              | Start A/B comparison with one globe and immutable snapshots; defer a second viewer until lifecycle ownership supports it.                 | S20                 |
| Imported files consume excessive resources or fetch remote content | Explicit parser limits, staged preview, cancellation, inert text and no remote import resources.                                          | S26, S27            |
| Update rollback cannot read migrated browser data                  | Export before destructive migration; retain old schema reader/backup and refuse incompatible writes.                                      | S10, S30            |
| AI turns change scope or overstate certainty                       | Deterministic result envelope, editable query, visible completeness and cancellation ownership.                                           | S24, S25            |
| Upstream continues to evolve while `dev` diverges                  | Refresh ownership/CI inventory before each wave; merge upstream separately from feature work and rerun affected compatibility checks.     | S00, each milestone |
| Public performance figures are mistaken for universal guarantees   | Record supported hardware and exact workloads; publish limits and unmeasured platforms.                                                   | S06, S31            |

## 8. Current implementation handoff

Implementation code for S00–S31 is present on `dev` at
[`215a8d9`](https://github.com/arthurianresolve/gods-eye-view/commit/215a8d95e2712aa84dfccafe62f87d2db1ea394c).
The local candidate report is
[`candidate-report-20261008-final4.json`](../qa-artifacts/candidate-report-20261008-final4.json).
It records 11 passed local checks, zero failures, and 5 pending external checks
at `fdd4d7d`; the follow-up tests below pass on `215a8d9` and its working tree.
The single-machine UHD 620 comparisons do not replace the wider hardware matrix
or other external acceptance evidence below:

- The upstream `bug` issue sweep found #906 (truncated TLE groups), #905
  (WebGL maximum texture size), #804 (stale compact Radio disclosure) and #751
  (Alpha-5 satellite IDs) actionable; root-cause fixes and regression coverage
  are on this branch. [#854](https://github.com/bilawalsidhu/gods-eye-view/issues/854)
  only says camera controls fail and has no diagnostic output or discriminating
  reproduction, so its root cause remains unidentified; do not guess at a fix.
- Local token-base checks pass against both `fork/dev` and `fork/main`; hosted
  pull-request events targeting both branches remain unverified for S01. The
  latest hosted push/dispatch CI passed at
  [run 37798558150](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37798558150).
- S06 matched selected-tracking captures and three weather playback repetitions
  now pass on one Windows UHD 620 system. Complete captures on the supported
  GPU/OS matrix. Keep S07 Auto opt-in pending broader performance and visual
  validation.
- Obtain written retention/export approval before enabling any live aircraft or
  AIS recording. Synthetic fixtures validate the complete capture and replay path.
- Complete S23 keyboard, screen-reader, contrast, zoom and five-participant first-
  task review; complete the S31 cross-platform install/upgrade, mixed-use soak,
  named-hardware and signed-release checks.
- Keep unsupported evidence adapters explicit in
  [`EVIDENCE-SUPPORT.md`](EVIDENCE-SUPPORT.md); imported files now use the shared
  inspector while absent source time and geographic coverage remain unknown.

The next release milestone is evidence and rollout review for the implemented
features, with experimental or policy-gated behavior kept clearly labeled.
### Slice completion record

Copy this into each implementation PR or its linked validation record:

```text
Slice ID / title:
Base and candidate commits:
Dependencies completed:
User-visible behavior:
Existing contracts preserved / migrations introduced:
Acceptance scenarios and outcomes:
Commands, browser and renderer used:
Unrun checks and remaining limitations:
Documentation / source policy updates:
Rollback verified:
Follow-up slices:
```
