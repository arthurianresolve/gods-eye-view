# Infrastructure capture document contract repair

[Run 38193087266](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38193087266)
passes at exact application and harness commit
`c21b3f21a8fd7933dc0e52698e2b1175165ef7db`. The baseline remains
`eb8c6828d0d03e1c04bda94c8c4fb99915a577b7`. Both builds pass served-asset,
provider-interception and dense-population integration checks. The candidate's
actual capture CLI additionally completes two idle and two scripted-motion
samples of the datacenter workload.

The repair supplies one consistent workload envelope to the report and its
readiness validator. It binds all four infrastructure samples to
`main-measured-document`, with separate startup and measured-document worker
audits. Diagnostic coverage records startup and main setup; dense workloads
retain their separate document per sample. A review caught and corrected an
early read of a later-declared topology variable before this commit. The
31 focused tests validate contract behavior; this hosted executable run
provides the end-to-end producer initialization check.

The [complete downloaded report](report.json) has SHA-256
`28526a023bb7572c9e4b22a505c4540352f612be5868a3c004cf10f7c6cf0e1d`.
[Independent review](review.json) reruns the exact revision's full capture
validator against its retained raw capture successfully. This report is
complete, rather than the bounded diagnostic projection retained from the
previous failure. The startup audit validates four workers and the measured
document validates eight, all against the same embedded-worker source hash.
Native blob creation is restored and the audit registries are cleared.

The observed workload retains 4,362 datacenters, fixed fixture time,
Manual/Dense 75%, 1440x900 drawing buffer, antialiasing and MSAA 4. The
datacenter source response's SHA-256 and byte count match the bundled manifest.
The [CI job record](ci-run.json) preserves the tested revision and step results.
The prior failed reports remain unchanged as historical evidence.

This closes the demonstrated infrastructure producer/validator mismatch for
the datacenter CLI smoke. Dams, cables and combined infrastructure still need
their own executable workload checks. It does not complete S47 or qualify
performance acceptance: the runner uses SwiftShader, one-second warmup and
measurement windows, two repeats and worker instrumentation. The report keeps
comparisonEligible=false and explicitly lists all six remaining readiness
limitations, including the disabled uninstrumented latency-comparison path.
