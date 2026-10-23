# Windows recovery passes after prerequisite timing correction

[Hosted run 38401057945](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38401057945)
passes its one selected Windows recovery job at exact candidate
`feb067d33c03426646917acd854d95cce3cd288d`. Other jobs were deliberately skipped;
this is not a fresh full standard run. The candidate includes the reviewed
test-only PowerShell timing correction `7542775e`.

The job passes clean installation, disposable Git updates, incomplete-artifact
rejection, all recovery/shutdown prerequisites, and the actual persisted browser
profile journey. All five recovery checks pass:

- Prior installation saves a workspace.
- Interrupted update retains the application.
- Rollback reopens the same profile.
- Upgraded application reopens the same profile.
- Failed verification rolls back and reopens persisted assets.

Every check preserves settings and workspace-bundle contents, renders the saved
feature, closes all owned pages, and closes Chrome without forced termination.
Observed browser-close durations range from 294.2 to 621.5 ms, within the unchanged
5,000 ms deadline. The original failed runs remain failed; this later success
does not identify the cause of the historical empty-output PowerShell delay or
prove the absence of intermittent Chrome shutdown failures.

Environment: free standard `windows-latest`, Windows 10.0.26100, Node 24.14.0,
Chrome 152.0.7977.75, SwiftShader WebGL-only, 960 x 640 viewport. The prior
installation is `6b896e2a8277fba12bc9577ad7772005a71e13c7`.
`hardwareRenderingValidated` is false. This is functional recovery evidence,
not GPU, performance, soak or complete S47-S60 acceptance.

Evidence preserved:

| File                                                            |   Bytes | SHA-256                                                            |
| --------------------------------------------------------------- | ------: | ------------------------------------------------------------------ |
| [Run summary](run-summary.json)                                 |   7,817 | `c50168a5039e550eff0be446006ba43acd72c5f29fb00863a1d0457810d6ee9d` |
| [Unmodified job log](job-115308499461.log)                      | 262,822 | `4f5b65e6f3d57bfdc7a1f9b715a399f6023a5c9bed64d407e01e4369a2df1bdc` |
| [Recovery report extracted from the log](profile-recovery.json) |  14,769 | `ac0ad0c354921db4e135aea2f79a29739e72e87a7daa8506aa6364d0bbd4012a` |

The extracted report is the single JSON payload between the job's
`QA_EVIDENCE_BEGIN/END qa-artifacts/profile-recovery.json` markers, with GitHub's
log prefix removed and one newline appended. It is not claimed to be the original
pretty-printed artifact bytes. Its values are unchanged.
