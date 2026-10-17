# Targeted Windows recovery with phase diagnostics

[Run 38435193284](https://github.com/arthurianresolve/gods-eye-view/actions/runs/38435193284)
**passes** the selected Windows recovery job at
`15c0cff3612f647f3470e48dfe1a85f8280c149b`. This targeted invocation does not
run the other standard jobs. The application includes the reviewed main merge
and S50 volume retention; the prerequisite includes the reviewed timing-only
diagnostics. No startup, execution, cleanup or browser timeout was increased.

All 77 prerequisite tests pass. The first real PowerShell case spends 6.48 ms
inside process creation, 0.24 ms awaiting the spawn event, and 2328.28 ms between
spawn and receipt of the flushed readiness marker. Execution takes 1573.42 ms.
The second case records 4.10/0.15/172.12 ms for those startup phases and 313.83 ms
execution. Neither timeout fires. This sample locates most of its first-start
delay after process creation; it does not establish the cause of the earlier
five-second readiness failures or distinguish initialization from pipe delivery.

The original [recovery report](profile-recovery.json) passes all five checks:
prior-install workspace persistence, interrupted update, rollback with the same
profile, upgrade with that profile, and failed verification followed by rollback
and reopened assets. All settings and workspace bundles match; all owned
browsers close normally without forced termination. The actual browser is Chrome
152.0.7977.75 using SwiftShader, so hardware rendering remains unvalidated.

This is current passing Windows recovery evidence. The [preceding failed run](../integration-dddef9eb/README.md)
and its unresolved historical cause remain visible. The fresh map fault runner
and later viewshed test additions require their own affected validation; no
performance, soak or complete-milestone claim follows from this targeted pass.
Dev and VM105 have not been promoted.

Artifact `11833441971` and job `115427233035` supplied these original bytes:

| File                                     |  Bytes | SHA-256                                                            |
| ---------------------------------------- | -----: | ------------------------------------------------------------------ |
| [Recovery report](profile-recovery.json) |  24176 | `ccb0b3c850490492ea1f5c1a777330a11841ceb8fe80f17ea6a6c1d393ba32e9` |
| [Job metadata](run.json)                 |   8069 | `96e1d908b8c745e3d6110d32dc32108ee2fb86620a61a89c3b5e44edea68d50a` |
| [Windows log](windows-recovery-job.log)  | 143451 | `567219e551275a07aa72603114bfbab72674e3f6c0508b83496bb46fd8c5e8cc` |
