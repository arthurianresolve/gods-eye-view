# Both-base validation at c5802408

Source `c5802408c7612857d5e1f09c3a938e0bda824ca7` passes all seven selected
standard CI jobs and release-artifact verification on both bases. This revision
includes the Windows cleanup/test changes and the deterministic aircraft
snapshot audit. [review.json](review.json) independently binds checkout logs,
merge parents and identical source/merge trees.

| Base | Tested merge | Standard CI | Release verification |
| --- | --- | --- | --- |
| dev `e8ccc268` | `8e9cb12d007ff282309f629ad8b34b575ccc70ce` | [38467537539](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38467537539) | [38467537591](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38467537591) |
| main `9beadbda` | `2424a6662fbe58a668a231f125d7afda2ecb2c76` | [38467542226](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38467542226) | [38467542185](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38467542185) |

Each hosted Node 24/26 ordinary suite reports 7,822 tests: 7,817 passed, zero
failed and five Windows-only skips. Node 24 additionally passes the 1/1 and
13/13 calibrated allocation groups; Node 26 explicitly skips those groups.
Production builds, formatting, package boundaries, published-token checks,
Windows onboarding and the Street Level browser gate pass. Each token check
reports 29 published allocations and none new.

All thirty recovery records across six OS jobs pass: unchanged settings and
workspace bundles, one reopened asset with a stable per-run hash, no leftover
pages, completed browser shutdown and no forced termination. These hosted
functional runs do not establish physical Windows rendering qualification.

Candidate artifacts `11849726610` and `11851070226` pass immutable REST download,
ZIP and inner archive checksums, release manifest and all 446 file hashes, and
signed repository/workflow/source attestation verification in their workflows.
Root separately downloaded the small evidence ZIPs `11849601810` and
`11850910475`, checked their API digests and retained their exact entries.
Empty attestation stdout is not independent proof; the successful job and raw
shell-error-checked verification log establish that result. No stable release
was published; PR #4 remains validation-only.

[files.json](files.json) binds raw metadata, compressed logs, extracted recovery
records and the evidence ZIPs. This is exact-revision standard integration,
not final S60 qualification or a physical GPU/soak pass.
