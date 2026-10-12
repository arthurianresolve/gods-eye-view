# Failure origin review - 12 October 2026

This review attributes the principal failures investigated during the performance
work. It is a source/history review, not a complete upstream benchmark. Live
`git ls-remote` checks found both upstream `origin/main` and our `fork/main` at
`591f299d11f38a612629a274463196d57ae3862e`. The integrated dev checkpoint is
`2f7de280e41f23fa2036b07c74d9bf21cfb01c32`. Local branch `main` is older and is
not the comparison used here.

| Issue | Attribution and evidence | Disposition |
| --- | --- | --- |
| Duplicate HUD summary context work; stale completions after revision changes or destruction | Inherited code. The complete `_updateSummary` method in remote main is identical to the method immediately before fix `bbca229f`. The independently reviewed regressions fail against that pre-fix method. | Fixed in dev. This does not prove that HUD work caused the Windows GPU stall. |
| Regional-weather decoded bitmap ownership | Inherited code. Remote main processes the decoded bitmap into a separate canvas without explicitly closing the displaced source bitmap. Fix `f90e24f3` closes that source after the copy, including exceptions, while preserving Cesium ownership of pass-through images. | Fixed in dev; focused and repeated-transfer evidence is separate from whole-application heap acceptance. |
| Command-palette queued-close focus race | Our feature defect. The palette was added by `3d6b30c8` and is absent from remote main. The additional queued focus restoration could steal focus after native dialog closing. | Fixed by `289fd1c8`; native regression and standard CI pass. The specific earlier untraced accessibility timeout still cannot be reconstructed conclusively. |
| Map event bridge disconnecting a newer connection | Our implementation defect. `mapStackEvents.js` was added by `bacc54a8`, is absent from remote main, and used shared cleanup state across connections. | Fixed by `8b68d54e`, with ownership regressions. |
| Datacenter fixture using `layerId` instead of public `id`; asynchronous worker-audit snapshot and publication checks | Our test-tool defects. These checks were introduced on our QA branches. Their failures are not evidence of upstream application regressions. | Caller fixed by `f09aa36a`; audit repairs at `6ca6373e` and `788b2bd8`. Later rendering failures remain separate. |
| Duplicate fixture comparator rejecting renderer-specific datacenter pick metadata | Our test-tool defect. The local comparator compared full pick records, while the shared validator already compares stable datacenter identity and native ownership. | Repair `24bebb1b` uses the shared comparator. Raw-report replay still rejects a separate 16-pixel camera-change mismatch; the failed run is not converted into a pass. |
| Infrastructure display reports ready while a current stem is absent | Shared dependency behavior plus our fixture assumption. Both branches lock Cesium 1.138.0 / engine 22.3.0. Its display-ready flag retains an earlier success; our fixture treated it as proof of current geometry readiness. | The corrected normal hosted gate at `5ba9a940` requires a successful current update and stable revision at capture; all ten paired images and native picks pass. This closes the hosted fixture check, not physical Windows or full S54 acceptance, and does not prove an upstream application failure. |
| Repeated renderer/vendor GL queries during scene observation | Our measurement tooling. All `getParameter` samples in the three bounded CPU profiles at `9ec1172c` have `observeCommonScene` as their direct JavaScript parent. | Isolated repair `2de9501c` moves immutable identity reads to real context creation while retaining live ownership/settings checks. The three later profiles at `09fec83f` contain no sampled `getParameter` calls. The integration run still fails a separate validator contract; no matched performance benefit is claimed. |
| Renderer-probe cleanup deadline | Our isolated harness ownership path; not an upstream runtime change. At `a342c54a`, the failing main-setup document cleanup executes in 0.100 ms but its acknowledgement arrives after 1,975.751 ms. All document cleanups pass once at `09fec83f`, but the main-setup timeout recurs at `e3f7e096` before measurement and its late response is `Target closed`. | Complete cleanup gate remains failed. The measured delay at `a342c54a` is outside the page cleanup callback; task scheduling, protocol delivery and host scheduling remain undifferentiated. The later recurrence has no usable page timing. No GPU/driver cause is established and no deadline is relaxed. |
| Map comparison evidence overwritten after its observation period; oversized CI payload logging | Our fixture/reporting defects. The comparison publisher omitted required ownership fields and later replaced its retired snapshot after intentional selection changes. The corrected 3.2 MB report then exceeded the unchanged 2 MiB log limit. | `0c221261` fixes observation lifetime; `14f903cb` prints artifact identity and preserves the full upload. The exact workflow at `14f903cb` passes, with independent raw-report replay. No upstream application failure is established. |
| Obsolete fixture-clock field in capture validator | Our QA contract mismatch. The phased producer records `measurementStart`, but the outer validator and its hand-built mock still expect `start`; run `38227044680` completes six samples and then fails this assertion. | `e3f7e096` validates the actual phased contract using producer-backed tests. Seventy focused tests and replay of six retained clock records pass; full replacement integration is separate. The original report remains failed. |
| Rejected optimization experiments | Our candidates. Measured regressions and visual differences in isolated experiments are attributable to the tested candidate differences when the comparison is valid. | Rejected candidates remain outside production defaults. This is not completion of the affected slice. |
| Physical Windows WebGL/frame/capture stall | Unresolved. Large frame gaps reproduce in a minimal WebGL fixture without Cesium or the application. The supplied GPU report confirms hardware acceleration, not a driver defect or an application cause. | Requires further environment and frame-delivery attribution. No matched main/dev hardware experiment establishes its branch origin. |
| Intermittent Windows recovery timeout | Unresolved browser/process shutdown. Settings, workspace and persisted assets passed in the reached stages; Chrome acknowledged shutdown, then remained alive beyond the five-second gate. | Later natural exits establish intermittency, not a root-cause fix or attribution to upstream. |
| Original soak listener/heap growth and remaining dense-render timeouts | Unresolved as an aggregate. Observations were made on development builds, and fixture/worker instrumentation was subsequently corrected. | Specific owner fixes have evidence; the complete historical growth cannot be assigned to upstream or to one implementation change without equivalent reproductions. |

Supporting reports: [HUD ownership](https://github.com/arthurianresolve/gods-eye-view/blob/bbca229f0077b8443db04395c106677684d2ef61/docs/performance-evidence/hud-summary-coalescing/README.md),
[palette focus](../command-palette-focus-311cc5ea/README.md),
[current stem readiness gate](../s54-current-update-gate-38218238754/README.md),
[renderer query profiles](../s47-interception-failure-evidence-38217259994/README.md),
[renderer cleanup lifetime](../s47-renderer-cleanup-lifetime-38222535286/README.md),
[cleanup execution timing](../s47-renderer-cleanup-timing-38225433300/README.md),
[retired-document and fixture-clock evidence](../s47-retire-render-loop-38227044680/README.md),
[map observation boundary](../s57-observer-epoch-38226108308/README.md),
[Windows GPU controls](../windows-gpu-20261012/README.md),
[Windows shutdown](../windows-recovery-38203843444/README.md), and
[dense failure before CPU profiling](../s47-first-motion-cpu-profile-38210121293/README.md).

Passing standard CI does not settle these unresolved causes. Reverting all dev
changes is not supported as a fix: it would remove confirmed repairs as well as
new features, without an experiment showing that it resolves the remaining
Windows failures.
