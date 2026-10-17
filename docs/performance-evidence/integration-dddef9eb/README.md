# Windows prerequisite recurrence at dddef9eb

[Standard run 38432856926](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38432856926)
tests `dddef9eb66357394f596fad028fb671b9263abf3` and finishes **failed**, with
**six of seven selected jobs passing**: Node 24/26 suites/builds, Windows
onboarding, Street Level/browser journeys, and Linux/macOS installation recovery.
Windows recovery fails before browser setup. [Final job metadata](run.json)
and [artifact verification](verification.json) bind these results to the tested
revision; this is not a complete integration pass.

The original [macOS](macos/profile-recovery.json) and
[Linux](linux/profile-recovery.json) reports each pass all five install/update,
rollback and reopened-asset checks. Settings and workspace bundles match in all
ten cases, and all owned browsers close without forced termination. Both use
Chrome 152.0.7977.75 and software rendering; neither qualifies physical hardware.

[Windows job 115419249140](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38432856926/job/115419249140)
passes 73/74 prerequisite tests. The real PowerShell test for an absent owned
root fails after 5003.4968 ms awaiting its readiness marker, before its script
is sent. Execution elapsed is unavailable. Cleanup takes 9.7842 ms and process
closure is confirmed. The second real PowerShell test passes, with 819.0228 ms
startup and 3181.9697 ms execution.

The [preceding c7c47245 pass](../integration-c7c47245/README.md) uses the same
helper, ownership tests, shutdown tests and workflow blobs. Both jobs report
runner 2.337.0 and `windows-2025-vs2026` image `20260925.250.1`. Its first real
PowerShell test starts in 1713.2118 ms and executes in 1117.3199 ms; the second
starts in 149.9732 ms and executes in 260.6828 ms. This variation does not prove
a particular host, runtime, security-software or application cause. The S50
runtime code and browser have not executed at the failing prerequisite.

The original diagnostics cannot separate synchronous process creation, delivery
of the Node spawn event, process initialization/readiness delivery, and host
timer lateness. Reviewed change `7cda7cfc1538693685cf915f43a5898dd50c3b8e`
(Luna source `680691490e5749e174cd924b039e01ba1706ed8f`) measures these phases
as bounded scalar diagnostics in the prerequisite test harness only. Root
passes all 77 ownership/shutdown checks, including the two real PowerShell
cases on this Windows machine and deterministic late timer/late marker cases.
The five-second startup/execution and one-second cleanup limits remain unchanged.
There is no retry or root-cause-fix claim. A later passing run alone will not
explain this recurrence.

The fresh [targeted Windows run 38435193284](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38435193284)
uses the reviewed timing diagnostics at `15c0cff3612f647f3470e48dfe1a85f8280c149b`.
Its result must be evaluated separately; the original failed run stays failed.

Original job logs are retained without line-ending conversion:

| File                                                                              |  Bytes | SHA-256                                                            |
| --------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Failed Windows job](windows-recovery-job.log)                                    |  57620 | `d3871b77e723576c6524654bb9c67697982554fbfce52776166aa98644a77ecd` |
| [Preceding passing Windows job](../integration-c7c47245/windows-recovery-job.log) | 142778 | `9cc6b929999ed2a9fb593a6604fc937c17c9a9a1e911b6e8a3f8063bc7a9f90e` |
| [Final job metadata](run.json)                                                    |  24906 | `7f5b63ba8bc9afa28fba1da89b6a69152dc1e5f6fdffd678dcbb1e378e8acff3` |
| [macOS recovery](macos/profile-recovery.json)                                     |  18651 | `a7f5644d6c6480619070f46cb123982fc9ec1360a26edbcadc0d7c2d26870ba8` |
| [Linux recovery](linux/profile-recovery.json)                                     |  18132 | `7ccc3a8b60b81c2d37ae00d6302d094a0409927e87bd429d2db5bb59e1bf226b` |

The separate [native map control failure](../s47-map-streaming/native-fault-38432631061/README.md)
is a test expectation error about initial terrain. Its correction does not fix
the PowerShell prerequisite. Dev and VM105 remain unchanged.
