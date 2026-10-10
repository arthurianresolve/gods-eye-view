# Candidate performance evidence

The candidate runner supports hash-bound raw performance evidence in version-2
validation manifests. Version-1 manifests retain their existing behavior. A
version-2 manifest automatically requires the performance gates; the
`--require-performance-evidence` flag (or `GEV_REQUIRE_PERFORMANCE_EVIDENCE=1`)
also enables those gates when evidence has not yet been collected.

This is evidence ingestion for S60.1, not evidence that S47–S60 have passed.
Missing workloads, unavailable hardware and incomplete retention remain pending.
Invalid artifacts and measured acceptance failures remain failures.

## Manifest shape

The following is a template. Replace each placeholder with an actual commit,
relative artifact path or SHA-256 digest; it is not a passing validation report.

```json
{
  "schemaVersion": 2,
  "phase": "pre-release",
  "candidateCommit": "<full candidate SHA>",
  "checks": [],
  "performanceEvidence": {
    "comparisons": [
      {
        "environmentId": "windows-uhd620",
        "baselineCommit": "<full baseline SHA>",
        "baseline": {
          "path": "captures/baseline.json",
          "sha256": "<SHA-256 of baseline.json>"
        },
        "candidate": {
          "path": "captures/candidate.json",
          "sha256": "<SHA-256 of candidate.json>"
        }
      }
    ],
    "retention": [
      {
        "environmentId": "windows-uhd620",
        "report": {
          "path": "retention/candidate.json",
          "sha256": "<SHA-256 of retention/candidate.json>"
        }
      }
    ]
  }
}
```

Artifact paths are local and relative to the manifest. The runner hashes the
exact bytes before parsing JSON; editing an artifact requires a new digest and
does not change the revision it tested. URLs are not downloaded. The existing
manual acceptance checks remain in `checks`, including hardware coverage and
accessibility. Derived performance check IDs cannot be supplied as manual passes.

Each comparison contains raw `gev-performance-capture/v1` reports from
`scripts/capture-scene-performance.mjs`. Their common harness, source identities,
build provenance, fixture delivery, populations, routes, visual settings, five
runs, 30-second warmups and 60-second measurements are validated by the existing
paired-report validator. A cached comparison summary is insufficient.

Use one comparison row per environment and workload. Dense investigation includes
the selected-aircraft tracking objective. Current operating view, infrastructure,
weather/effects, lifecycle stress and map streaming require their own workload
evidence. Different machines cannot contribute partial workloads to manufacture
one complete primary Windows result. Hosted and software results remain visible
as supplemental evidence. Successful supplemental rows do not block a complete
primary Windows result; invalid supplemental artifacts still fail validation.
A 20% motion/tracking target miss or a repeatable
regression over the declared limit cannot be turned into a pass by changing a
manifest outcome.

Retention uses the raw output of `scripts/qa-mixed-use-soak.mjs`. The consumer
checks the exact application/harness revision, clean-source observations,
completed mixed-use operations, measured duration, chronological checkpoints and
post-GC provenance, then recomputes resource and heap stability. It does not trust
the artifact's cached `stability.status`. A short smoke test is incomplete
retention evidence. The final retained checkpoint must be within one second of
the measured duration. Historical reports without the new provenance fields remain
historical and cannot acquire those fields through inference.

The capture producer records host identity and browser graphics after the timed
samples, keeping those diagnostic queries outside latency measurements. Retained
metrics record completion of `HeapProfiler.collectGarbage` only after the actual
request succeeds. Renderer classification uses the recorded host rather than the
machine reading the manifest.

## Run the candidate gates

From a clean checkout of the candidate on Windows:

```powershell
$env:GEV_VALIDATION_MANIFEST = 'qa-artifacts/validation-manifest.json'
node scripts/qa-candidate.mjs --require-performance-evidence --out qa-artifacts/candidate.json
```

The output path must not already exist. Exit code `0` means the selected phase is
ready, `1` means a required check failed, and `2` means evidence is pending. The
runner also performs its existing formatting, package, unit/build and configured
browser checks. Published-artifact verification remains a separate phase.

This packet does not automate visual review, interaction latency acceptance,
human accessibility/usability reviews, release attestations or deployment. Those
requirements remain in the implementation ledgers and are not satisfied by the
new comparison or retention gates.
