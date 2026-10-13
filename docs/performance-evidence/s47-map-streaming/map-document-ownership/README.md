# Map capture documents match their actual owners

Reviewed corrections `37f88372` and `155f2ac0` (Luna sources `a619d5f6` and
`6e27b27b`) fix the producer/validator mismatch exposed by
[native run 38416400160](../native-v4-38416400160/README.md). Map samples reuse
the main document, whereas dense and Austin operating samples own fresh pages.
The old generic topology incorrectly required nonexistent provider documents.

An explicit `reuseMainDocumentForSamples` option now describes the map capture
producer and outer validator. Every sample is bound to the planned main owner;
worker audits, diagnostics, cleanup, delivery and interception-release inventories
must exactly cover startup and main owners. Missing, duplicate and wrong owners
remain failures. Map retirement is checked at its actual final boundary: startup
retirement rows and confirmed main retirement in its cleanup record. Other
workloads retain their existing per-sample retirement checks. Root verifies that
the generic retirement validator is byte-for-byte unchanged from before this fix.
No application renderer, timeout, request limit or artifact cap changed.

Root first reproduced the original failure using the untouched saved report and
pre-fix validator, then replayed it through the corrected real outer and map
validators with the deterministic v4 fixture and pinned build profile. The result
passes diagnostic validation and remains comparison-ineligible. Fourteen damaged
copies are rejected, including wrong sample ownership, duplicate cleanup,
unconfirmed main retirement and false hardware/comparison eligibility claims.
This does not change the failed hosted run or create new browser evidence.

Root independently passes 90 tests across capture comparison, outer smoke,
map capture and Austin operating contracts, with no failures or skips. Capture
no-undef (25 files), package boundaries (1,015 modules, 80 entries), changed-file
formatting and diff checks also pass. Luna reports 96 focused checks. Fresh
merged-commit standard and native browser runs are still required.

| Artifact                                 | Bytes | SHA-256                                                            |
| ---------------------------------------- | ----: | ------------------------------------------------------------------ |
| [Root focused output](focused.log)       | 17842 | `9a950f8bc80eabd8530836e461caf140b90a73a3cb89c308aafdd250ff93abde` |
| [Root replay result](replay-result.json) |   704 | `4e51c2aea9c7e5a9341f2bcbccc7003681dcb8cbfea3b01dc0910587f7793124` |

The [replay script](replay.mjs) pins the original report bytes, source revisions
and build receipt; it invokes the actual map validator and runs the negative
mutations. Run from this repository at the reviewed revision:

```sh
node docs/performance-evidence/s47-map-streaming/map-document-ownership/replay.mjs
```

The `--expect-old-failure` mode is for the pre-fix source only. Current source is
`155f2ac0033bc5cae7d1184293cc39ac491b5150`; the replay does not replace live rendered
journeys, missing/corrupt/superseded map fault controls, paired performance capture
or the primary Windows retention gate.
