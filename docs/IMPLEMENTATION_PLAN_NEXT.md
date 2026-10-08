# Next-stage implementation plan for `dev`: S32-S46

Status: Corrective implementation and validation are in progress. Code, automated
results and external acceptance are separate. Earlier fixture passes did not
establish complete installation recovery or application soak acceptance.

This roadmap builds on `6b896e2` and preserves S00-S31. It keeps free-first
sources, uses PeeringDB as a user-opened reference rather than ingesting its
database, and improves the existing public-agency CCTV sources without adding
a new provider dependency.

## Slice ledger

| Slice | Code status | Automated status | External status |
| --- | --- | --- | --- |
| S32 integration baseline | implemented | historical push CI passed; corrected PR matrix pending | pending |
| S33 candidate evidence | implemented | focused tests passed | pending |
| S34 install/update recovery | partial | real installer/updater CI and portable artifact recovery | full prior-install/browser-profile matrix pending |
| S35 accessibility/first use | partial | existing browser gates plus reference controls | NVDA, VoiceOver, contrast/zoom and five users pending |
| S36 infrastructure provenance | implemented | focused tests passed | pending |
| S37 durable references | implemented | focused tests passed | pending |
| S38 archive lookup | implemented | focused tests passed | pending |
| S39 archive investigations | implemented | actual inspector/pin/IndexedDB/profile-transfer journey | pending |
| S40 PeeringDB links | implemented | provenance tests passed | pending |
| S41 camera health | implemented | focused tests passed | pending |
| S42 camera selection | implemented | selection and provider fingerprint fixture tests | verified current production examples pending |
| S43 camera evidence | implemented | focused tests passed | pending |
| S44 soak/performance | component harness implemented | real browser smoke; full duration pending | full rendered application and GPU matrix pending |
| S45 release provenance | implemented | draft-only tags, readiness and downloaded-attestation gates | pending |
| S46 final candidate | planned | pending | pending |

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

- S32 records the `6b896e2` baseline and keeps hosted PR and publication URLs
  pending rather than inventing external evidence.
- S33 validates a schema-versioned manifest, exact candidate commit, phase,
  outcome, environment, timestamp, and bounded artifact references. Missing
  checks remain pending; publication verification is separate from readiness.
- S34 adds `qa:install-recovery` and a Windows/macOS/Linux Node 24 CI matrix.
  CI runs the actual installer and real Git updater tests. The portable fixture
  stages and verifies checksummed files, rejects interrupted and corrupted copies,
  and reopens a bundle with a verified asset. It does not establish a complete
  old-install/browser-profile migration.
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
- S44 now performs actual operations in one persistent browser: source mode
  changes, replay reads, GeoJSON imports, IndexedDB workspace switches, inspector
  rendering, archive errors and decode recovery. A short run is a smoke check.
  Full application rendering and matched GPU evidence remain separate.
- S45 checks exact staged commits, checksums, downloaded candidate contents,
  and GitHub artifact attestations. Tag pushes create unpublished drafts. Stable
  promotion requires complete exact-commit acceptance, another download and
  verification of draft assets, and a current tag-target check.

## Remaining slices

S35 must complete keyboard, focus, screen-reader, contrast, zoom, and
five-participant first-task review. S44 must run the default 60-minute fixture
soak and matched hardware captures. The fixture can be smoke-tested with
`npm run qa:mixed-use-soak -- --url http://localhost:4174 --duration-ms 1000`; the three-OS CI job runs
`npm run qa:install-recovery`. S46 must freeze the candidate, collect those
external records, and update support claims without turning pending evidence
into passes.

## Validation contract

The baseline is 6b896e2a8277fba12bc9577ad7772005a71e13c7. Its
[CI run](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37828006253)
passed. The pre-correction revision 56f8936b6308463d0a64ebec6c7d180bfa9ffa14
also [passed push CI](https://github.com/arthurianresolve/gods-eye-view/actions/runs/37837104706).
These historical results do not validate later changes. Push CI does not execute
the PR-only layer-token check. Retain run URLs, bases and tested revisions for
representative PRs against both dev and main.

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
within 90 seconds without coaching. S46 cannot mark readiness until that evidence,
the full recovery/rendered-soak/hardware matrix, and published artifact verification
exist for the candidate. Preserve older reports without relabeling their passes.
