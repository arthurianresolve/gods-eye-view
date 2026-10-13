# Engineering closure audit under the amended criteria

S52 is **engineering closed**, with current component checks passed and primary
Windows qualification pending. All other S47-S60 rows remain partial until their
own audit. Counts are therefore **1/14 engineering closed (7.1%)**, **13/14 partial**
and **0/14 fully qualified**. This is a count of completed slice requirements,
not an estimate of code written. No historical failure is changed to a pass.

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
