# Primary Windows UHD 620 soak — 15 October 2026

This packet preserves exact-candidate hardware and readiness evidence for
`3a0e49be11a44a04b608e0b4b3cd2ff1f69bc958`. It became historical evidence
when upstream `main` advanced to
`e50bc45674c4e7f940dce07f3c67b7c1ed83fb67` after the run; it does not qualify
the later merge candidate.

## Exact candidate

- Application and harness commit: `3a0e49be11a44a04b608e0b4b3cd2ff1f69bc958`
- GitHub Actions run: [38637636231](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38637636231)
- Source and harness were clean at start and unchanged during the run.
- Renderer: native Intel UHD Graphics 620 through ANGLE Direct3D 11; hardware
  acceleration and physical-desktop coverage were both verified.

## Results

The full mixed-use run completed 3,602,843 ms with:

- `operationStatus: passed`
- `fullSoak: true`
- `stability.status: passed`
- 252 iterations and 1,008 source toggles
- 252 replay seeks, imports, archive failures, and camera recoveries
- 504 workspace reloads
- 13 retained-resource checkpoints
- warmed listener count `644` to `644`
- final pending worker count `0`
- final-window post-GC heap growth ratio `0.0218658076` (2.19%)

The optional cold-start prewarm reached its bounded timeout after 180,277 ms.
The harness classified that expected cold module-graph condition, closed the
disposable page, and then started the independent authoritative soak page. The
real page booted successfully and every operation and stability gate passed.

The candidate report has zero failures. Its automated readiness phase passed,
while three qualification categories remain pending: the five-pair matched
performance matrix, unavailable discrete-Windows/macOS hardware, and external
accessibility/usability review. Release-tag verification remains a separate
post-publication check.

## Integrity

- Original local report SHA-256:
  `424860539efd731a389b56bd7d28c6fe7ec2f759907a692cc4d8fdadb8983c3c`
- Sanitized report SHA-256:
  `7d1ab603bae176e41f472e4f65f2498ac0ffcf8bfe903365fad20816cf33ff52`
- Recording bundle SHA-256:
  `4b183f487afbea9096ab93b507dc4b1d5b56d833b934d563e62a632e77cfed63`
- Validation manifest SHA-256:
  `2e95f34490d241ebe511a7b2190201a85b5c939ef1f20039e5c0fc5bb11ef401`
- Candidate report SHA-256:
  `0c4417abfaff3b2e8be0035d6c6286668a94dc744e702b5b2d9b2b154c5460e5`

The sanitized report differs only by replacing its machine-local recording
bundle path with the adjacent evidence filename.
