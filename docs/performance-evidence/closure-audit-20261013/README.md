# Engineering closure audit under the amended criteria

S50 and S52 are **engineering closed**, with scoped component checks passed and
primary Windows qualification pending. Other S47-S60 rows remain partial until
their own audit. Counts are **2/14 engineering closed (14.3%)**, **12/14 partial**
and **0/14 fully qualified**. This is a count of completed slice requirements,
not an estimate of code written. No historical failure is changed to a pass.

## S50 geometry construction and ownership

The [S50 review](s50-review.json) binds the current source and 183 passing focused
checks, including the new real-layer workspace integration. The captured
[test output](s50-focused.log) has no failures or skipped tests. The workspace
test passes through the actual layer coordinator, manager, CCTV factory and
Cesium primitive collection. It waits for geometry/source work to drain, checks
primitive identity after repeated and changed persisted coverage modes, and
verifies primitive and listener teardown. It does not introduce calibration
persistence or claim a browser-storage journey.

| Required engineering behavior                                      | Disposition                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source, exact pose, terrain and parameter revisions                | Current geometry/ground tests cover changes and stale replies, including rounded-key collisions and source-owner replacement at equal coordinates.                                                                             |
| One authoritative queued build and bounded preparation             | Cursor-based queue retains reentrant edits, coalesces pending duplicates, prioritizes the active record and cancels obsolete generations; application batches retain the four-ms target.                                       |
| Retain unchanged geometry across visibility and workspace restores | Real primitive identities survive mode and disable/enable cycles; the persisted layer-state integration checks repeated restores and OFF/re-entry.                                                                             |
| Bounded ownership and immediate obsolete-result retirement         | Current fourteen-camera cohort is retained; outgoing/hidden stale volumes and readiness observers are retired. Source identities use weak tokens.                                                                              |
| Tint and observation updates without geometry reconstruction       | Ready/pre-ready tint uses supported attributes; resolved footprint metadata refreshes without replacing identical vertices, while changed support heights rebuild.                                                             |
| Rendered behavior and construction comparison                      | The [strict hosted comparison](../s50-viewshed-retention/native-38439815077/README.md) passes exact in-page pixel equality, fourteen rebuild-control constructions, zero visibility-cycle constructions and complete teardown. |

This closes S50 engineering under the amended finite criteria. The final frozen
candidate still needs full-application physical Windows visual, interaction,
performance and retention qualification. Component construction savings are not
a motion-p95 or GPU-time improvement claim.

## S52 overlay projection and preparation

The [S52 review](s52-review.json) binds the current source at `f8413015`, test
output and reverified artifact hashes. Root reran 90 focused overlay, drawing,
font-wake and token checks: all pass, none skipped. The original output is in
[s52-focused.log](s52-focused.log).

| Required engineering behavior                                        | Disposition and evidence                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse projection with complete invalidation                          | Retained implementation checks camera projection/position/altitude, scene mode, viewport/DPR, source revision and positions. Focused tests check actual visibility-work reuse and invalidation while presentation callbacks remain live. |
| Reuse text and layout preparation                                    | Bounded text/font measurement cache and normalized-entry layouts remain; font readiness/loading changes invalidate geometry and wake idle rendering. Disposal generations reject stale font callbacks.                                   |
| Reuse placement without stale picking                                | Retained placement signatures include layout, font, source and placement inputs; occlusion/selection arbitration remains current. Tests cover moving protected footprints, configuration changes and restored visibility.                |
| Keep painted output, hit regions and accessible actions synchronized | Focused checks cover alpha thresholds, fading, hidden/retired painters, self-releasing callbacks, replacement, selection and accessible actions. Historical browser pixel/picking/action pairs cover the same unchanged renderer.        |
| Evaluate conditional painting                                        | Supported rejection: preserve production painting. The experiment failed an unchanged allocation gate and was not promoted. A further cache design is not mandatory under the amended finite-closure policy.                             |

Both `worldOverlay.js` and `worldOverlayDraw.js` are byte-identical to accepted
component commit `4686ea3b6d33cf02e822f04e122bfb0afdcc9cf5`. Root reverified all
13 hashes in its [acceptance packet](../s52-placement-direct-filter/acceptance.json),
including the five paired, 24-case exact-pixel review, font negative controls,
CPU comparison, focused checks and unchanged allocation gates. The accepted
component tradeoff remains explicit: moving generic/infrastructure CPU medians
were +3.34%/+2.36%; no pair exceeded the 10% regression ceiling, while all twenty
static/periodic pairs improved. These are component CPU measurements.

The [rejected paint-cache packet](../s52-paint-rejection-07/README.md) remains
failed at 160.1 bytes/candidate/frame against the 154-byte allocation limit.
The accepted production renderer is unchanged by this audit.

Engineering closure does not establish dense full-scene motion performance,
the 20% objective, primary Windows visual qualification or the final retention
soak. Those shared final-candidate gates remain pending. Earlier records saying
S52 was incomplete remain accurate under their combined completion definition;
this dated audit applies the newly separated engineering definition only.
