# Both-base validation at 175f2cf3

Frozen source `175f2cf32b89fb3cad370b88ed909c1ed4d83d4e` passes all seven
selected standard CI jobs and release-artifact verification against both bases.
The [independent review](review.json) checks merge parents, source-tree equality,
checkout identities, published-token results and all thirty recovery records.

| Base | Tested merge | Standard CI | Release verification |
| --- | --- | --- | --- |
| `dev` at `e8ccc268` | `a69ba573c684b5b60df5b7dacd944f43f9a3bb4e` | [38464352705](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38464352705) | [38464352736](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38464352736) |
| `main` at `9beadbda` | `5e0a28c4bf011e2d2553cb7a3c63a9689f4e3d84` | [38464354426](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38464354426) | [38464354386](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38464354386) |

Both merge trees equal the source tree. Node 24 and 26 ordinary suites each
report 7,814 passes, zero failures and four skips. Node 24 additionally passes
both calibrated allocation groups; Node 26 explicitly skips those two groups
under the existing allocator policy. Production builds, formatting, boundaries,
Windows onboarding and the Street Level browser gate pass. Each base's token
check reports 29 published allocations and no new tokens.

All six Windows, macOS and Linux recovery jobs pass. Their thirty records retain
settings, matching workspace bundles and one rendered persisted asset; each OS
run preserves its asset hash across all five stages. All pages close before
browser shutdown; shutdown completes without forced process termination.
These hosted functional results do not qualify physical Windows GPU behavior.

## Downloaded release verification

The workflows download immutable candidate artifacts `11848631795` (dev) and
`11847583839` (main), check ZIP digest, inner archive checksum, source manifest
and all 446 file hashes, and verify attestations against this repository,
`.github/workflows/release.yml`, and the tested merge commit. The raw successful
release logs retain the verification command and its subsequent successful
archive verification under shell error checking.

Root independently downloads the small evidence artifacts `11848451924` and
`11847328934`, verifies their API SHA-256 digests and safely reads their entries.
Their ZIPs and extracted metadata are retained here. Attestation stdout is empty;
it is not standalone proof. The successful job and raw verification log provide
that evidence. Root did not repeat the full candidate download locally.

PR #4 remains validation-only. No stable tag or release was published. Remote
dev and VM105 were not changed. The [failed 6d84a6ee runs](../representative-pr-6d84a6ee/README.md)
remain failed historical evidence; the obsolete assertion is corrected in this
tested source. Later Windows harness/test changes have their own
[local full-suite result](../windows-cleanup-688619f5/README.md), not an inherited
hosted pass. Current-candidate hardware qualification remains pending.

[files.json](files.json) binds raw API metadata, compressed unchanged logs,
downloaded evidence and extracted recovery records. Transient HTTP 502 errors
while reading GitHub metadata required retrieval retries, not workflow reruns.
