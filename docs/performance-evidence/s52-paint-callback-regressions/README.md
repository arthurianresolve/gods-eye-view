# Paint-cache callback regression controls

These controls reject an unpublished conditional-paint prototype, not the
production renderer. Production runtime SHA-256 `a938f3acdfb56ba7801e76c7449c934d2b5c232ae375590aef47c405b29f2582`
passes both cases. The corrected prototype also passes both independent cases.
The production focused suite passes **90 tests, zero failures and zero skips**.

The first prototype determined cache eligibility from active painters at frame
end. A painter that unregisters itself can leave its own pixels in that frame,
or change an already painted label from a later callback. Neither condition is
visible in the final active-painter count. Reusing that frame then preserves
retired pixels or an obsolete label.

The corrected prototype records an unsafe callback attempt before evaluating
`shouldPaint`. Any shared painter or later detection callback prevents that
frame from seeding reusable shared pixels, even if it unregisters itself.

| Runtime | Independent callback tests | Disposition |
| --- | --- | --- |
| Production `a938f3ac…` | 2 pass | Runtime unchanged |
| Prototype 01 `89962db8…` | 2 fail | Rejected |
| Prototype 02 `2cf2d2c0…` | 2 pass | Still experimental; broader gates required |

The archived regression appendix is identical in the independent failure and
corrected controls. JSON reviews bind source and raw TAP hashes; archived
runtime snapshots preserve both experimental revisions. `artifact-hashes.json`
binds the raw files. The initial local control used an overly broad `fillRect`
assertion and was corrected before the archived comparison: these controls
identify the custom marker by its exact arguments, preserving ordinary label
chrome. The failed harness output remains in ignored local diagnostics.

To reproduce, use a disposable checkout of production commit
`f301cba278d7dc6188b14e6fd84a889f1d2c40af` with its locked dependencies. Append
`regression.append.mjs.txt` to `src/overlays/worldOverlay.test.mjs` and run
`node --test --test-reporter=tap --test-name-pattern="root paint cache" src/overlays/worldOverlay.test.mjs`.
Repeat after replacing `src/overlays/worldOverlay.js` with each archived runtime
snapshot. The expected exit codes are 0, 1 and 0 for production, prototype 01
and prototype 02 respectively. Do not replace a production checkout's renderer.

The browser fixture now has 44 cases, including consecutive invisible frames,
visible recovery, consecutive visible frames and a return to invisibility.
The source is registered once; later phases change only its opacity callback.
Actual normalized-entry and pooled-rectangle identity are checked on recovery.
Native pixel validation of this expanded fixture remains pending at this commit.
These unit controls do not establish browser, GPU or full-scene performance.
