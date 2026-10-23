# S47 early-document CPU attribution

The isolated application and harness commit is
`626087cd6e9eeef1c53d91e63924f61f50bc9d82`, on
`qa/s47-early-document-cpu-profile`. The previous first-motion diagnostic remains
frozen at `73e6c72cc7e7acc6cbb957dd94a6a902e7e489f3`; its
[failed idle-stage run](../s47-first-motion-cpu-profile-38210121293/README.md)
remains historical evidence.

The new opt-in diagnostic covers idle samples 1 and 2 and scripted-motion sample

1. Each window begins before warmup on its prepared document and ends when the
   measurement boundary settles or fails, with a 60-second profiling cap. A profile
   that reaches the cap or overruns it during the existing bounded stop operation
   is explicitly incomplete. Actual timestamps are preserved. The maximum accepted
   delivery window is 62 seconds, and protocol operations cannot exceed two seconds.
   The original capture-child and render-boundary deadlines are unchanged.

Every profile is bound to the scenario, run, actual capture ordinal, document
role and document identity. Three fixed sidecar/index pairs preserve earlier
profiles if a later sample fails. Byte lengths and SHA-256 hashes are checked;
invalid filenames, altered target identities and eligibility claims are rejected.
Profiles remain limited to 8 MiB, 20,000 nodes and 100,000 samples each, with
non-fixture source URLs redacted. Failure reports retain a consistent envelope.
Disabled profiling creates no protocol sessions or sidecars.

Review corrected a profile-array-index/capture-ordinal confusion. The hosted
smoke has two runs per scenario, so first motion has ordinal 2; a five-run route
has ordinal 5. The full-report validator binds the ordinal to the actual capture
list position, while helper and partial-sidecar tests cover the five-run identity.
Another regression covers synchronous profile callbacks, which must not insert
the same record twice.

Root independently passes all 49 focused tests across `boundedCpuProfile`,
`providerSampleCpuProfileWindow`, the capture CLI and the smoke validator.
Formatting, syntax, package boundaries and whitespace checks pass. The commit
changes diagnostics and tests only; it has no `src`, dependency or runtime-default
diff. It does not establish a performance improvement or fix the rendering stall.

[Hosted run 38214581314](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38214581314)
was dispatched with the same dense fixture, diagnostic worker auditing and scene
frame diagnostics as the previous run. It **fails before any profiling window**,
while preparing the fresh document for idle sample 1. The gate reports two fixture
interception errors. The harness stores these errors internally but fails to
include their details or document/session ownership in the saved failure report.
The raw error messages cannot be recovered from the uploaded artifact or failed
job log. This reporting gap must be corrected before attributing the failure or
repeating the diagnostic; relaxing the interception gate is not justified.

The baseline build smoke passes. The candidate's outer integration observes
2,500 aircraft, 4,362 datacenters and 716 dams at both checkpoints. Its capture
child observes the 2,500-aircraft response, but completes zero measured samples.
All three profile windows remain pending and no sidecars are created. The raw
failure projection is complete, rather than truncated. Worker-audit restoration
reports its one late worker target and blob request as validated, with zero
unvalidated late targets/requests. Those facts do not identify the two omitted
interception errors. The process error reports child cleanup confirmed.

The [raw report](report.json) is 38,722 bytes, SHA-256
`ffb250b6e5589fbca98e690c9748e757a4162b05731dc8d6b43b74c24c19064f`.
[Independent review](review.json) and [CI metadata](ci-run.json) preserve this
failed result. The startup sample reports Linux Chrome 152 and SwiftShader;
no physical GPU, paired performance or stall root-cause acceptance follows.

Separately, all seven [standard dev jobs](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38213470541)
pass at `72df25ee8c8ea7f0fb94a7d4f00525fd00167290`, including Node 24/26,
Windows onboarding, three recovery jobs and browser journeys. Their
[terminal metadata](standard-ci-dev-38213470541.json) is preserved. That dev
revision does not include this isolated profiling diagnostic.
