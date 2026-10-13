# Merged candidate integration at 4b60f453

[Standard run 38420706497](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38420706497)
is **failed** at exact merged candidate
`4b60f45391561246b891ffd8783c7acc142a227b`. Six selected jobs pass: Node 24.14.0,
Node 26.x, Street Level browser gate, Windows onboarding, Linux recovery and
macOS recovery. Windows recovery fails in its prerequisite ownership tests,
before browser installation or persisted-profile recovery. Optional diagnostics
were skipped, and the manual run does not supply PR-only layer-token evidence.

The failing prerequisite runs `profileRecoveryPageOwnership.test.mjs` and
`browserShutdownControls.test.mjs`: 73 of 74 tests pass. The test "PowerShell
skips command-line queries when the owned root is absent" fails with
`POWERSHELL_READINESS_TIMEOUT`. Startup takes 5001.8691 ms against the unchanged
five-second readiness deadline. Script execution never starts; cleanup confirms
the child closed in 15.5172 ms. The next actual PowerShell test passes with
3143.4331 ms startup and 3394.4523 ms execution, within its separate phase bounds.

The helper, these tests and CI workflow are unchanged from preceding revision
`f50565a0`, whose seven selected jobs passed. A local Windows diagnostic on the
same candidate passes all seven PowerShell-focused tests. Its two actual process
starts take about 185 ms each. This narrows the failed phase but does not establish
why hosted startup was slow, fix it, or replace the failed hosted result. No
deadline was extended, failure converted to a skip, or unchanged retry dispatched.
Promotion to dev awaits the outstanding Windows prerequisite/recovery validation.

The [separate native map diagnostic](../s47-map-streaming/native-v4-38420739560/README.md)
passes at this same candidate. Neither result is a physical Windows performance
comparison or a 60-minute retention qualification.

Original evidence bytes are preserved:

| Artifact                                                         | Bytes | SHA-256                                                            |
| ---------------------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| [Run summary](run-summary.json)                                  | 24934 | `0256dbf33d2eba6a35d5bc89388cc62f4c6d4512a8bfb40444b8e9ff1233597a` |
| [Failed Windows job log](115376950311.log)                       | 56198 | `7c0f1713512d633bfb2c839253275ae144947807f0e668b90d618450a32ab5ac` |
| [Local PowerShell diagnostic](local-powershell-reproduction.log) |  1854 | `43acd325e83365e5174d01ea309f238f681ac6dfcabea8dd6085de7946c51578` |

Local diagnostic command:

```sh
node --test --test-name-pattern=PowerShell scripts/performance/profileRecoveryPageOwnership.test.mjs
```
