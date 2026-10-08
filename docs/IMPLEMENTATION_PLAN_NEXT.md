# Next-stage implementation plan for `dev`: S32-S46

Status: The code portions of S32-S45 are implemented in this change. Hosted
CI, manual usability review, real hardware captures, and stable publication
remain explicitly pending until their evidence exists.

This roadmap builds on `6b896e2` and preserves S00-S31. It keeps free-first
sources, uses PeeringDB as a user-opened reference rather than ingesting its
database, and improves the existing public-agency CCTV sources without adding
a new provider dependency.

## Slice ledger

| Slice | Code status | Automated status | External status |
| --- | --- | --- | --- |
| S32 integration baseline | implemented | local gates passed; hosted PR matrix pending | pending |
| S33 candidate evidence | implemented | focused tests passed | pending |
| S34 install/update recovery | implemented | fixture passed; CI matrix pending | pending |
| S35 accessibility/first use | planned | pending | pending |
| S36 infrastructure provenance | implemented | focused tests passed | pending |
| S37 durable references | implemented | focused tests passed | pending |
| S38 archive lookup | implemented | focused tests passed | pending |
| S39 archive investigations | implemented | integration journey passed | pending |
| S40 PeeringDB links | implemented | provenance tests passed | pending |
| S41 camera health | implemented | focused tests passed | pending |
| S42 camera selection | implemented | focused tests passed | pending |
| S43 camera evidence | implemented | focused tests passed | pending |
| S44 soak/performance | implemented | short fixture passed; 60-minute/GPU matrix pending | pending |
| S45 release provenance | implemented | workflow checked in; hosted attestation pending | pending |
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
  The fixture covers clean install, interrupted update, verification rollback,
  atomic marker replacement, settings, assets, and workspace reopen.
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
- S44 adds the provider-hermetic mixed-use soak fixture. Real 60-minute runs,
  GPU captures, and the S35 usability review remain external acceptance work.
- S45 checks exact staged commits, checksums, downloaded candidate contents,
  and GitHub artifact attestations before stable tag publication.

## Remaining slices

S35 must complete keyboard, focus, screen-reader, contrast, zoom, and
five-participant first-task review. S44 must run the default 60-minute fixture
soak and matched hardware captures. The fixture can be smoke-tested with
`npm run qa:mixed-use-soak -- --duration-ms 100`; the three-OS CI job runs
`npm run qa:install-recovery`. S46 must freeze the candidate, collect those
external records, and update support claims without turning pending evidence
into passes.

## Validation contract

The baseline is `6b896e2`; this implementation records the resulting commit in
the delivery report. Local validation completed with the focused suites,
formatting, package boundaries, the production build, the recovery fixture, and
the short mixed-use soak. The hosted pull-request matrix, accessibility study,
GPU captures, and signed publication remain pending because they require the
external environments described above. Automated CI remains provider-hermetic;
live providers are never required for unit or browser fixtures.
