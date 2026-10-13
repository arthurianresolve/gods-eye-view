# Engineering closure audit under the amended criteria

S50, S52, S55, S56 and S57 are **engineering closed**, with scoped component checks passed and
primary Windows qualification pending. Other S47-S60 rows remain partial until
their own audit. Counts are **5/14 engineering closed (35.7%)**, **9/14 partial**
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

## S57 map resources and streaming

The [S57 review](s57-review.json) records current source hashes and all 50 passing
map controller, factory, token, imagery-host and terrain-retry tests. The
[focused log](s57-focused.log) has no failed or skipped cases. Source review
confirms generation checks, abort ownership, cache reuse, deduplicated disposal,
caller-owned versus factory-owned tilesets, and comparison-lease restoration
that preserves intervening operator choices.

Thirty equivalent unit switch cycles retain two imagery providers and one
terrain provider, with no pending jobs or growing listener counts. Destruction
empties cache and scene ownership. Other tests cover held/failed/late creation,
superseding sources, comparison release during acquisition, stale tile errors
and cancellation during throttled retry. The inherited construction-fallback
alias defect is fixed: explicit source selection can retry without losing the
fallback provider's legitimate cache ownership.

The [current production map evidence](../s47-map-streaming/native-fault-38439382587/README.md)
passes both immutable revision journeys and complete missing, corrupt and
superseded metadata controls using native fixture coverage. Its source settings,
actual renderer, worker assets and cleanup remain strictly checked. Root replayed
those validators and retains the unmodified reports.

The earlier [streamed-tile component](../s57-flat-readiness-owner-38236552746/README.md)
separately establishes cancellation/recovery, warm-cache reuse, measured tiny-tile
memory and owner teardown at its original revision. Its raw hash was reverified;
its result is not relabeled as a new-candidate hardware test. Tile memory remains
unavailable where Cesium does not expose it, and no Google cache/detail limit is
reduced.

These reviewed implementations and component checks close S57 engineering.
Final physical Windows routes, equivalent-detail captures, timing regression
checks and the full retention soak remain pending. No map speedup is claimed.

## S56 fresh capture and surface lifetime

The [S56 review](s56-review.json) binds the current capture helper, actual viewport
and pointer callers, viewer teardown, tests and preservation-default decision.
Root passes all 199 frame/pointer/voice checks in [the focused log](s56-focused.log).
The caller tests drive postRender and cover success, null contexts, drawing and
encoding failures, black/oversized rejection, resized dimensions, and all temporary
surfaces. The helper separately checks abort, visibility, timeout, concurrent
destruction, missing/zero canvases and stale completion cleanup.

The new tests first reproduce fourteen failures in [the negative log](s56-negative.log)
at `e842103c`: the black-frame sampler keeps a 48 by 32 canvas backing surface
after return. Fix `d73f3c89` releases it in `finally`, including context/readback
failures. It preserves the luminance test, existing null-context behavior and
error propagation. This is bounded transient-resource cleanup; it does not prove
an unbounded leak or explain the historical Windows rendering stalls.

The existing capture-matrix fixture creates the real application viewer and
tests `destroy-pending`. Both preservation modes pass that component case in
[native run 38439815077](../s50-viewshed-retention/native-38439815077/README.md).
No test-only production constructor hook is added.

The explicit default decision is to retain `preserveDrawingBuffer: true`.
The [controlled Windows observations](../windows-gpu-20261012/README.md) still show
frame-delivery stalls with preservation disabled and do not demonstrate a
qualifying application benefit. Changing the default is not accepted. The
preservation option remains available for controlled investigation; resolution,
antialiasing, effects, capture-size limits and deadlines are unchanged.

This closes S56 engineering under the conditional default-change requirement.
The full application idle/moving/portrait/resized/restored/hidden capture matrix,
physical Windows qualification and any performance claim remain pending. The
small application-viewer component matrix is not substituted for those checks.

## S55 tracked-frame work and camera ownership

The [current camera-ownership review](../s55-camera-owner-851d6841/README.md)
closes the remaining engineering audit. Root passes all 83 current focused
checks, verifies the civil and military accepted source/dependency hashes, and
confirms the new safe-frame regression rejects a repeated-handoff mutation.
The [owner disposition](../s51-render-demand/owner-audit.md) records justified
continuous camera work separately from removable duplicate work.

| Required engineering behavior | Disposition |
| --- | --- |
| One authoritative tracked time and shared displayed pose | The accepted civil and military implementations reuse the tracked-frame sample across pose and trail callbacks; invalid frame identities remain fresh and target replacement clears cached ownership. Current production-factory reproductions pass both callback orders and cache-only observation cases. |
| Avoid redundant position/transform/camera writes | Tracked labels and camera consume the displayed-pose cache. The camera applies its ENU handoff once; safe later updates leave following to Cesium EntityView. The new behavior test and failing mutation control verify this boundary. |
| Keep fleet maintenance outside tracked updates | Fleet rendering remains in the bounded preRender fleet tick; tracked-model synchronization occurs in its separate preUpdate path. Untracked queries retain fresh independent time rather than borrowing the tracked scratch record. |
| Preserve authority and recoverability | Current handoff/cockpit/click tests preserve tracking transitions, stale navigation guards, rollback ownership and release. Camera tests check shared zoom settings, safety clamping, disposal and viewer retirement. Per-frame follow and safety work is retained because it changes the view. |
| Evidence for the accepted reduction | Existing five-repeat 124-frame component comparisons have identical output hashes and 372 to 248 clock reads. Their original source revisions and diagnostic-only scope remain explicit; no new latency claim follows from the audit. |

This closes S55 engineering under the amended criteria. Current integrated
rendered follow/cockpit/CCTV/replay/manual transitions, physical Windows motion
p95 and long-task measurements remain pending qualification. The 20% objective
is still unassessed for the final candidate. This is not an added slice or a
retroactive hardware pass.
