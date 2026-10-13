# S51 render-demand owner audit

This is a source-and-test inventory for the finite S51 render-demand slice. It
does not qualify the app's GPU, settle a measured idle-frame target, or close
S51. The empty-flight/military conditional-hold change is committed at
`85020ccb520dbc0b0068ea856e60560db3a02ad0`; its real-app BEFORE measurement
and paired AFTER result are still required.

## Governor behavior and app wake/disposal

[`src/renderGovernor.js`](../../../src/renderGovernor.js) switches to
`requestRenderMode` only when its identity-keyed hold set is empty. Releasing
the final hold requests one settling frame. Discrete mutations call
`governorRequestRender`; coalesced `scheduleRenderUpdate` runs a bounded
callback and requests one frame afterward. Uninstall increments a generation,
clears scheduled timers/updates, drops holds, and detaches the viewer.

[`src/app/tools.js`](../../../src/app/tools.js) ties continuous rendering to
`viewer.trackedEntity`. Its `visibilitychange` owner suspends rendering while
the document is hidden and calls `governorRequestRender('visibility-restore')`
when shown; teardown removes the document listener and releases the tracked
entity hold. Unit coverage exists for governor and layer ownership, but the
S51 app diagnostic has not yet established a successful real-browser
visibility-away/return, final-frame, and combined owner teardown observation.
Any simulated `document.hidden` control must remain labeled simulated; it is
not evidence of OS/browser tab occlusion.

## Continuous owners with source-backed animation or follow work

- Camera verbs (`src/cameraVerbs.js`) hold while camera motion/orbit is active
  and release at the terminal path. Their work updates the camera each tick.
- A Cesium tracked entity (`src/app/tools.js`) holds while `viewer.trackedEntity`
  is set. `src/data/trackedCamera.js` establishes its ENU frame once, then
  intentionally leaves ordinary safe frames to Cesium `EntityView`; it only
  rewrites the camera if minimum-range/cross-origin safety needs correction.
  S55 tests now exercise setup-once, read-only safe frames, shared controller
  ownership, and self-release on tracking change/viewer destruction.
- Transit (`src/layers/transit/rendering.js`) holds while its `_moving` set is
  nonempty and releases on settle. Trail ageing/fades and visibility boundaries
  use timers plus one-shot governor requests (`src/layers/transit/trails.js`,
  `rendering.js`); those do not need a permanent hold by themselves.
- Awareness (`src/layers/awareness/lifecycle.js`) holds only when its live
  camera/subject/result condition says its per-frame visual is active; its
  discrete visual writes request one-shot frames
  (`src/layers/awareness/rendering.js`).
- Traffic (`src/layers/traffic/lifecycle.js`) owns a hold while the selected
  animated traffic presentation is wanted. Feed retries and other discrete
  traffic writes request renders through the governor.
- Local ADS-B (`src/layers/localAdsb/index.js`) holds while live moving markers
  require frame-by-frame updates; its polling and selection paths are
  separately scheduled/requested.
- CCTV projection (`src/layers/cctv/projection.js`) holds for its
  `requestAnimationFrame` projection loop and releases on stop/disable. CCTV
  adjustment holds only during its bounded visual transition. Other CCTV
  geometry/tint completion paths request a frame when their owned update lands.
- Directions (`src/layers/directions/index.js`) holds while an enabled route
  entity exists. This hold is justified: its route uses
  `FlowMaterialProperty` (`src/annotations/worldAnnotationRenderer.js`), whose
  `isConstant` is false and whose `getValue()` writes a `performance.now()`-based
  time uniform on each rendered frame. With request-render mode, the dash flow
  would stop. Route placement, anchoring, selection, and clearing also issue
  one-shot requests; ground-anchor retries are bounded timers.
- The S51 fleet change (`src/layers/fleetRenderDemand.js`) keeps civil and
  military holds only while an enabled layer has billboards, models, tracked
  visuals, or a trailhead. Snapshot membership is reconciled immediately after
  the authoritative `applySnapshot`, as well as on completion, so a delayed
  follow-up cannot leave new visuals without an owner. Enable/disable,
  tracking suppression/restoration, and destroy paths reconcile ownership.
  Its focused tests cover empty/nonempty transitions, delayed accepted
  snapshots, and tracking/lifecycle changes. Those tests establish ownership
  logic; they are not a rendered application measurement.

## Periodic and discrete owners

Satellite and vessel lifecycle paths use `scheduleRenderUpdate` for periodic
motion rather than holding the renderer continuously when untracked
(`src/layers/satellites/lifecycle.js`, `src/layers/vessels/lifecycle.js`).
Satellite tracking acquires the continuous hold and releases it on stop or
destroy (`src/layers/satellites/tracking.js`). Discrete source polls,
annotations, status/selection updates, installation/ground changes, and
workspace/UI changes use `governorRequestRender` at their mutation boundary.
Their existence is not evidence of an idle frame unless the empty-owner app
probe observes it.

## Additional owner and callback dispositions

The explicit hold/owner registration scan also found these owners, which are
separate from the empty civil/military change:

- `src/annotations/annotationEngine.js` keeps one hold while the annotation
  collection is nonempty. The renderer updates pulsing colors, camera-scaled
  rings, and flow uniforms on frames; deleting the final annotation releases
  it. This is justified for visible animated annotations. The app diagnostic
  does not currently measure a populated annotation scene.
- `src/orbit.js` holds while camera orbit is active because its `preRender`
  callback changes camera heading. `stop()` removes the listener/releases the
  hold. `src/ui/cockpitTrackingController.js` similarly holds while its
  per-frame cockpit camera/HUD update is active and releases on exit/dispose.
- `src/layers/launches/renderDemand.js` owns a continuous hold only while the
  launch layer is enabled and a launch is selected, replay camera is active,
  or a wrapped camera flight is outstanding. Completion, cancel, thrown
  flights, reset, and disposal retire that owner. Mission-orbit frames use
  `src/layers/launches/orbitRendering.js`'s one-second scheduled owner only
  while an orbit primitive is visible. Its callback checks the generation and
  current visible primitive before work/rescheduling; hiding/removing the last
  visible orbit cancels the scheduled wake.
- `src/ui/visualSettings.js` aliases the shared governor into
  `src/ui/visualEffects.js`. The effect loop requests animation frames only
  while a transition remains or an enabled animated stage has visible
  intensity. Each callback recomputes that condition, holds only while it is
  true, then releases; `stop()` cancels the owned frame and releases. Static
  bloom/sharpen changes request one frame. This is conditional animation, not
  an unconditional visual-settings hold.
- `src/data/bhoteKoshiEvent.js` aliases three named holds through its render
  host: scene-path reveal during camera movement, scene reveal during its
  transition, and flood playback. Progress callbacks check enabled/current
  travel identity and cancellation before updating; bounded deadline and RAF
  paths release on finish/stop. Discrete progress/selection writes request
  frames. The diagnostic does not exercise this active narrative path.
- `src/data/detectionRenderDemand.js` is change-driven with bounded follow-up
  frames for fades, pending label solves, and skipped paints; static detection
  does not hold continuously. Its frame-time policy and governor behavior have
  focused tests.

Wind and weather animation do not register a permanent hold. In
`src/layers/wind/rendering.js`, the RAF scheduler requires a running field,
canvas, foreground document, non-still mode, and (for GPU) visible GPU output.
The draw callback exits when those conditions no longer hold or the viewer is
unavailable; camera/visibility/motion changes cancel or re-arm work. Errors are
caught, then the next frame is scheduled only through the same guarded path.
`src/layers/weather/shellRendering.js` requests frames while an asynchronous
primitive/image is not yet drawn: its postRender callback requests another
frame only while visible and unsettled, then removes itself. Hidden/destroyed
owners stop waking the scene. `src/layers/weather/rendering.js` requests a
frame at image/frame staging, commit/failure, visibility, alpha, and clear
boundaries; transitions are bounded and tied to owned incoming/retiring frame
records rather than a permanent continuous hold. These are source-level
dispositions; the empty-owner S51 app probe does not qualify wind/weather
animation cadence or hidden-work behavior.

The owner inventory is the current explicit `holdContinuousRender` and
`registerRenderDemand` set plus the named wind/weather/effects callback paths,
not every individual `governorRequestRender` call site. Static mutation paths
request one frame and remain outside the idle fixture unless their population
is explicitly enabled.

## S55 engineering coverage and qualification boundary

The tracked-camera code-level packet is committed as
`30e364ef2a9fe07c72c5ecbfb09000df532a8b83`; root reports 83 focused checks
including a mutation control that rejects repeated handoff writes, and the
historical civil/military source hashes matched the reviewed baseline. The
tests cover display-cache use, one-time ENU setup, no repeated position callback
or safe-frame camera writes, minimum-range corrections, shared zoom-controller
ownership, and listener/settings release when tracking changes or the viewer
is destroyed. No additional tracked-camera runtime change is justified by
those checks. They do not measure rendered follow/cockpit/CCTV/replay/manual
transitions, tracking p95, or long tasks. Those are S55 qualification evidence;
the proposed 20% objective remains separately reported and is not a mandatory
validity gate.

## Remaining evidence

The first real-app BEFORE run, `38454796341` at `c716093f`, observed 22
completed frames over 10 seconds, 185 stable map requests, empty tile queues,
and empty civil/military populations. Its simulated hide/resume control passed.
The report failed at the endpoint comparison because the military receipt
timestamp advanced with its normal 15-second poll; the run did not reach app
teardown. The follow-up `da8ad3ef` preserves both endpoint timestamps and uses
`isDeepStrictEqual` for stable stats after excluding only `military.lastUpdate`;
civil receipt time remains fixed.

The corrected BEFORE run, `38456481165` at `ed825bd3`, reached teardown and
reported 27 completed frames in 10 seconds, empty source populations, and
successful application/owner/listener teardown. It failed the unchanged
two-frame gate and reported one remaining canvas. That report held only a total
count, so it does not establish which element remained. The app's static
[`layer-panels.html`](../../../src/ui/templates/layer-panels.html) contains
a hidden `#cctv-video.cctv-frame` canvas; `scene-chrome.html` contains the
world-overlay canvas that its owner removes. The follow-up diagnostic now
records a bounded before/after inventory tagged by actual element identity,
dimensions, connection state, and the exact CCTV host-markup selector. It
accepts one remaining canvas only if it is the same hidden CCTV template
element with unchanged dimensions, while the viewer and world-overlay canvases
were present before and removed after. It retains the two-frame gate and does
not delete host markup. Since the old report did not capture these identities,
the retained canvas is still unclassified for `38456481165`.

The projector also now reports `tileContentReady` only when the explicit
readiness state is `content-ready` and globe loading is true. The fixture's
`blocked-by-fixture` state remains not content-ready even if Cesium's
`globe.tilesLoaded` happens to be true. Focused fixture/live-contract checks
pass 43/43, and capture no-undef passes 32 files. A new matching BEFORE/AFTER
pair must use the corrected inventory projector; the prior 27-frame result is
still failed evidence. The hide/resume result is simulated lifecycle evidence,
not OS/browser tab-occlusion evidence. Periodic satellite wake remains a
separate follow-up if the current deterministic fixture does not exercise its
normal producer path; this audit does not claim that path was measured.
