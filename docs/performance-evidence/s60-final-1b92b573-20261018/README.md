# S60 final candidate evidence: `1b92b573`

The frozen application candidate is
`1b92b573b70d565e139c9c8c7b887157f98696f9`. The evidence validator is
`d87c8db86e0263b67dd3070205154575dc54a3ea`. The remote `dev` branch matched
the candidate when this packet was assembled on 18 October 2026.

## Result

All available automatic, browser, physical-Windows, hosted-platform, install,
recovery, artifact and attestation checks pass. The candidate report is
`pending-evidence`, with no failed checks, because the human NVDA, VoiceOver,
200% zoom/contrast and five-participant review has not been performed and a
pre-release candidate cannot yet prove that a future stable tag points at the
tested commit. Neither item is reported as a pass.

The eight physical-Windows matched workload pairs are comparable and none
crosses the 10% regression gate:

| Workload                | Measured result                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| Austin operating        | idle 123.4 -> 119.8 ms (-2.92%); motion 134.3 -> 130.9 ms (-2.53%)                                      |
| Dense investigation     | idle 163.1 -> 174.6 ms (+7.05%); motion 165.7 -> 177.5 ms (+7.12%); tracking 868.1 -> 926.5 ms (+6.73%) |
| Datacenters             | motion 110.7 -> 112.9 ms (+1.99%)                                                                       |
| Dams                    | motion 104.7 -> 104.8 ms (+0.10%)                                                                       |
| Cables                  | motion 140.1 -> 130.5 ms (-6.85%)                                                                       |
| Combined infrastructure | motion 143.4 -> 137.4 ms (-4.18%)                                                                       |
| Weather/effects         | idle 3402.7 -> 2118.4 ms (-37.74%); motion 94.1 -> 92.1 ms (-2.13%)                                     |
| Map streaming           | route readiness 2480.9 -> 2541.4 ms (+2.44%)                                                            |

The proposed 20% dense-motion and selected-tracking objectives were missed:
the candidate is 7.12% and 6.73% slower respectively. The acceptance policy
keeps those objective outcomes separate from qualification; both remain below
the blocking 10% regression threshold.

The 60-minute physical Windows soak passed on Intel UHD 620 through
ANGLE/D3D11. Final-window post-GC retained heap grew 0.887%, listeners moved
from 666 to 664, and pending worker work was zero. Hosted macOS Apple
Paravirtual Metal provided supplemental retention coverage with 1.997% heap
growth. GitHub-hosted Windows, macOS and Ubuntu clean-install, upgrade,
rollback and persisted-workspace recovery checks passed.

The exact-commit release workflow run
[39048585545](https://github.com/arthurianresolve/gods-eye-view/actions/runs/39048585545)
passed. Its downloaded archive has SHA-256
`DA05AC4C02E896BB3E66AD3E3A8834B7322446A5C7409AF0D2642C0A23C30DA9`,
and GitHub attestation verification bound it to the repository and candidate
commit.

## Files

| File                       | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `candidate-report.json`    | `B0CE47AAC434147D907A279DC93DD8115ED71C15868F745BDA71C867460E7C60` |
| `evidence-index.json`      | `B7F9F1127D544B6C8C3216445E321ABC743CAA0A963EBDFEED769AFC14BC10D9` |
| `validation-manifest.json` | `DFADAC6DEEF2F54D7A1865B59C52063D1D3AE21F38BA854E6E4D2A5B5710EDD8` |
| `windows-soak.json`        | `58F3D36024E0A10D9C023CF0C67DC93EEBA0FCFC61893771791C18DD30135B6C` |

## Upstream boundary

The candidate was frozen before upstream `main` advanced from `1df2a272` to
`93ea088f`. The 45 new upstream commits include dependency security updates,
satellite/TLE correctness fixes, map-distance consolidation, bike-share data,
and a development-server watch fix. They are relevant to the next development
candidate. Merging them into `1b92b573` would create a new unqualified commit,
so this packet does not claim coverage for that later upstream state.
