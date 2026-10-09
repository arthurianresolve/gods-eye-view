# Next-stage implementation plan for `dev`: S32-S46

Status: Reconciled on 9 October 2026 against local `dev` and remote `fork/dev` at
`2e0fb80cb696aa6b621e8b93d8effd299ffa4b14`. Code, automated results and external
acceptance are separate. Current CI fails Windows profile recovery; successful
older PR, release and component checks remain historical evidence. The
[S47-S60 ledger](CESIUM_PERFORMANCE_PLAN.md) tracks incomplete performance work
and the retention remediation required to close S44.

This roadmap builds on `6b896e2` and preserves S00-S31. It keeps free-first
sources, uses PeeringDB as a user-opened reference rather than ingesting its
database, and improves the existing public-agency CCTV sources without adding
a new provider dependency.

## Slice ledger

| Slice | Code status | Automated status | External status |
| --- | --- | --- | --- |
| S32 integration baseline | implemented; ledger reconciled | representative PRs to dev/main passed for `91a6076`, including layer-token checks; current push CI has a Windows recovery failure | refresh PR matrix for final candidate |
| S33 candidate evidence | implemented | focused tests passed | pending |
| S34 install/update recovery | implemented; Windows path failure needs correction | `2e0fb80`: Linux/macOS real profile recovery passed; Windows prior-install build failed; Windows onboarding passed | complete three-OS final-candidate matrix pending |
| S35 accessibility/first use | implemented | automated keyboard, focus, AX-name, status, and 200%-equivalent reflow report | NVDA, VoiceOver, contrast/zoom and five users pending |
| S36 infrastructure provenance | implemented | focused tests passed | pending |
| S37 durable references | implemented | focused tests passed | pending |
| S38 archive lookup | implemented | focused tests passed | pending |
| S39 archive investigations | implemented | actual inspector/pin/IndexedDB/profile-transfer journey | pending |
| S40 PeeringDB links | implemented | provenance tests passed | pending |
| S41 camera health | implemented | focused tests passed | pending |
| S42 camera selection | implemented | selection and provider fingerprint fixture tests | verified current production examples pending |
| S43 camera evidence | implemented | focused tests passed | pending |
| S44 soak/performance | harness implemented; retention remediation partial under S49-S50 | historical rendered soak failed stability (listeners 732 -> 11,982; heap 67.8 -> 153.2 MB); `2e0fb80` rendered smoke passed, full soak skipped | root cause, post-fix plateau and matched Windows/macOS GPU evidence pending |
| S45 release provenance | gates implemented | artifact/attestation verification passed for `91a6076`; later `9df13c5` archive locally checksum-verified; neither validates current candidate | final-candidate attestation/download checks and post-publication verification pending |
| S46 final candidate | pending | historical candidate report exists for `91a6076`; no completed final-candidate report for current dev | pending manual/hardware acceptance; stable publication not established |

## Decisions and compatibility

- Evidence `references` are additive, bounded to eight entries, and absent on
  older documents. Existing workspace schema version 1 remains readable.
- References contain a kind, safe public URL, optional title, and optional
  original URL, archive timestamp, and lookup timestamp. Page bodies and camera
  images are never retained by archive lookup.
- Archive lookup contacts only the fixed Internet Archive Availability API. It
  has cancellation, a ten-second timeout, a 256 KiB response cap, two active
  requests maximum, request coalescing, and a ten-minute memory cache.
- PeeringDB is link-only because its acceptable-use policy restricts bulk reuse.
  The application never imports or stores PeeringDB records.
- CCTV health keeps transport, decode, placeholder, fallback, and source-time
  facts separate. Automatic selection filters fresh known failures while manual
  selection remains available.

## Implementation notes

- S32 records the `6b896e2` baseline and the historical representative PR runs
  listed below. Those runs exist and must not be described as never completed;
  they do not validate the later S47-S60 changes.
- S33 validates a schema-versioned manifest, exact candidate commit, phase,
  outcome, environment, timestamp, and bounded artifact references. Missing
  checks remain pending; publication verification is separate from readiness.
- S34 adds `qa:install-recovery` and a Windows/macOS/Linux Node 24 CI matrix.
  CI runs the actual installer and real Git updater tests. The portable fixture
  stages and verifies checksummed files, rejects interrupted and corrupted copies,
  and reopens a bundle with a verified asset. `qa:profile-recovery` now exercises
  an actual prior checkout, interrupted update, rollback, candidate update, and
  persistent Chrome profile. At `2e0fb80`, Linux and macOS pass this runner;
  Windows fails while building the prior installation, before the profile journey.
  Vite/Rollup rejects the emitted `index.html` path and the error includes both
  `RUNNER~1` and `runneradmin` temporary-path forms. Investigate path normalization
  and rerun; the passing Windows onboarding job does not resolve this failure.
- S36 gives datacenters and dams stable source-record identity, evidence
  envelopes, OSM/OpenInfraMap attribution, ODbL licensing, unknown time fields,
  and a link-only PeeringDB search reference for named datacenters.
- S37-S40 add bounded public references, strict import/export validation,
  same-origin archive lookup, removable archived references, and user-linked
  PeeringDB facility URLs without importing PeeringDB data.
- S41-S43 add structured CCTV health reasons and timestamps, freshness-aware
  nearest-camera selection, placeholder/fallback distinctions, and shared
  inspector evidence. Existing manual selection and camera ownership paths are
  unchanged.
- S44 performs actual operations in one persistent browser: source mode changes,
  replay reads, GeoJSON imports, IndexedDB workspace switches, inspector
  rendering, archive errors and decode recovery. The post-fix smoke run completed
  nine cycles in 128 seconds on Chrome/Intel UHD 620. CCTV now skips identical
  frustum rewrites and does not restart its geometry queue when re-enabled with
  materialized geometry. Workspace and settings restores now apply an already
  matching camera pose without starting another flight, and incoming share-link
  restores retain their animated handoff. At that historical milestone the
  focused share-link suite and full 6,421-test gate passed. A follow-up two-minute
  smoke run completed nine cycles with no operation failures, but retained listeners still grew 783 ->
  1,471 and JS heap 67.2 -> 73.4 MB; the earlier clean 60-minute run completed
  253 cycles in
  3,606,160 ms with no operation failure, but retained listeners grew from 732 to
  11,982 and JS heap from 67.8 MB to 153.2 MB (178.1 MB peak). Repeated fixture
  layer toggles still enqueue Cesium createGeometry worker work, so S44 remains
  a failed acceptance diagnostic until that resource path is fixed. The report
  records an Intel UHD 620 renderer but sets `hardwareRenderingValidated: false`.
  Retention paths do not yet establish whether the root cause is application
  ownership, fixture interception or Cesium itself. Current CI's rendered smoke
  passes, while its 60-minute job is skipped unless explicitly dispatched.
- S45 checks exact staged commits, checksums, downloaded candidate contents,
  and GitHub artifact attestations. Tag pushes create unpublished drafts. Stable
  promotion requires complete exact-commit acceptance, another download and
  verification of draft assets, and a current tag-target check. The historical
  `91a6076` workflow and local verification checked GitHub attestation, repository,
  workflow, source commit, archive checksum and all 441 manifest entries. This is
  completed historical provenance evidence; repeat it for the final candidate.

## Remaining slices

S34 must fix the Windows recovery failure and pass the complete real-profile
matrix. S35 still needs screen-reader, contrast, zoom and five-participant
first-task review. S42 requires current verified provider placeholders. S44 needs
retention remediation, a post-fix 60-minute plateau and matched hardware captures.
S32/S45 need final-candidate PR and artifact evidence; S46 must freeze that
candidate, collect remaining evidence and update support claims. The independent
S47-S60 implementation work is detailed in its linked ledger.

`npm run qa:mixed-use-soak -- --url http://localhost:4174 --duration-ms 1000`
is a smoke check only. CI's recovery matrix includes both `qa:install-recovery`
and `qa:profile-recovery`. A full rendered CI soak requires dispatching CI with
`full_soak=true`; its runner does not replace the required real-GPU comparisons.

## Validation contract

The baseline is 6b896e2a8277fba12bc9577ad7772005a71e13c7. Its
[CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37828006253)
passed. The pre-correction revision 56f8936b6308463d0a64ebec6c7d180bfa9ffa14
also [passed push CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37837104706).
These historical results do not validate later changes. Push CI does not execute
the PR-only layer-token check.

### Reconciled hosted evidence

| Evidence | Revision / base | Result and limits |
| --- | --- | --- |
| [PR #1 to dev](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37848853442) | head `91a60769cd389968190ef0700d281189c9a0c35c`; base `56f8936b6308463d0a64ebec6c7d180bfa9ffa14`; tested merge `3a3f61f4af1529e09070c8ed20c885f0d6e5fbb1` | Passed, including published layer-token checks; historical |
| [PR #2 to main](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37848852682) | head `91a60769cd389968190ef0700d281189c9a0c35c`; base `6be25595b16491ce01ffd8d81e66921f321ee200`; tested merge `ab9e08172bf3919dd8e0d79bfdc76f6eb4048816` | Passed, including published layer-token checks; historical |
| [Candidate artifact verification](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37849245508) | `91a60769cd389968190ef0700d281189c9a0c35c` | Passed; local download/attestation verification recorded in `qa-artifacts/VALIDATION_NEXT_91a6076.md`; no stable publication |
| [Current dev CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37917730204) | `2e0fb80cb696aa6b621e8b93d8effd299ffa4b14` | Overall failure: Windows profile recovery. Node 24/26 suites/builds, formatting/boundaries, Windows onboarding, Linux/macOS recovery and browser job passed; full soak skipped |

The older report records matching PR/candidate trees at
`de00751f1a2871fbbaf983ba993fd7dd093d89e7`. Keep its local artifacts and the hosted
run URLs as historical evidence. None is relabeled as a pass for current `dev`.
The documentation reconciliation does not claim a new execution of these checks.

The corrective audit found unbounded archive state, missing datacenter selection
evidence, stale inspector responses, lingering camera failure reasons, unchecked
server tests, incomplete release gating and overstated fixtures. Corrections:

- New candidate/recovery/soak/server tests participate in npm test.
- Browser and server archive pools have two active, 64 pending and 128 cached
  entries maximum, a ten-minute cache TTL and ten-second overall deadline.
  Only the fixed Availability endpoint is contacted; redirects are refused.
- Targets and requested dates appear before lookup. Captures are previewed
  before attachment; cancelled/late selections cannot overwrite current evidence.
- Direct and nested pinned envelopes share strict reference validation. All
  comparison formats retain references even when evidence is unchanged.
- The reference journey selects a real bundled datacenter, attaches fixture
  archive metadata and a PeeringDB link, pins/reloads IndexedDB, and imports
  the bundle into a fresh browser profile.
- Proxy and decode conclusions expire independently; recovery replaces reasons.
  Cancellation is not a source fault. Provider-scoped placeholder matches require
  a verification trail. The production registry stays empty until real current
  examples are verified; repeated identical frames alone never imply failure.
- The component soak records real operations, browser version, elapsed time and
  resource metrics. It does not claim GPU or full application rendering evidence.
- Candidate manifests require full commit identity and artifacts for passes.
  Relative artifact paths resolve beside the manifest. Wrong commits, conflicting
  outcomes and dirty tracked source are rejected. Missing evidence stays pending.
  Pre-release readiness excludes post-publication verification.

Run formatting, package boundaries, Node 24/26, production builds, Windows
onboarding and browser gates at the final code revision. Retain controls at
p95 <=100 ms and loaded replay seeks at p95 <=250 ms. Auto quality stays opt-in.
Investigate matched hardware regressions over 10% in motion p95, peak heap or
retained resources, recording actual GPU/OS/browser versions.

S35 still needs NVDA/Windows, VoiceOver/macOS, contrast and 200% zoom reviews.
Four of five first-time participants must inspect evidence and save a workspace
within 90 seconds without coaching. Pre-release readiness requires that evidence,
the full recovery/rendered-soak/hardware matrix and candidate provenance checks.
Verification of published artifacts is a separate post-publication phase, not a
circular prerequisite for creating a ready candidate. S46 remains incomplete until
the applicable final reports exist. Preserve older reports without relabeling
their passes.
