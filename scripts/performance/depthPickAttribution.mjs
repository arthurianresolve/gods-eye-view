/** Install bounded, fixture-only depth-pick observations on an existing viewer. */
export function installDepthPickAttribution({
  scenario,
  run,
  captureOrdinal,
  documentRole,
  documentId,
  maxRows = 128,
}) {
  const viewer = globalThis.__godsEyeView?.viewer;
  const scene = viewer?.scene;
  if (
    !scene ||
    !scene.postRender?.addEventListener ||
    !Number.isInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 128 ||
    typeof scenario !== 'string' ||
    !Number.isInteger(run) ||
    !Number.isSafeInteger(captureOrdinal) ||
    captureOrdinal < 0 ||
    typeof documentRole !== 'string' ||
    typeof documentId !== 'string'
  )
    throw new TypeError('Depth-pick attribution viewer identity is invalid.');
  if (scene.__gevDepthPickAttribution)
    throw new Error('Depth-pick attribution is already installed.');

  const startedAt = globalThis.performance?.now?.() ?? 0;
  const ownerToken = `${scenario}:${run}:${documentRole}:${documentId}`;
  const callers = new Set([
    'voice-frame-overhead',
    'voice-basemap-label-context',
    'voice-move-end-prewarm',
    'voice-adjust-camera-zoom',
    'voice-entity-context',
    'voice-entity-context-pointer',
    'hud-summary-context',
    'voice-view-target',
    'camera-orientation-public',
    'camera-orientation-refresh',
    'camera-orientation-move-end',
    'camera-orientation-action',
  ]);
  let completedRenderRevision = 0;
  const counts = Object.create(null);
  const cacheCounts = Object.create(null);
  const rows = [];
  let omittedRows = 0;
  let active = true;
  const elapsed = () => {
    const now = globalThis.performance?.now?.();
    return Number.isFinite(now) && Number.isFinite(startedAt)
      ? Math.max(0, now - startedAt)
      : null;
  };
  const allowedCaller = (caller) => callers.has(caller);
  const readPickInputs = (targetViewer, samplePosition) => {
    const camera = targetViewer?.camera;
    const canvas = targetViewer?.scene?.canvas;
    const rect = canvas?.getBoundingClientRect?.();
    const cartographic = camera?.positionCartographic;
    const frustum = camera?.frustum;
    const vector = (value) =>
      value && [value.x, value.y, value.z].every(Number.isFinite)
        ? [value.x, value.y, value.z]
        : null;
    const matrix = (value) => {
      try {
        const values = Array.from(value || []);
        return values.length === 16 && values.every(Number.isFinite)
          ? values
          : null;
      } catch {
        return null;
      }
    };
    return {
      x: Number.isFinite(samplePosition?.x) ? samplePosition.x : null,
      y: Number.isFinite(samplePosition?.y) ? samplePosition.y : null,
      longitudeDeg: Number.isFinite(cartographic?.longitude)
        ? (cartographic.longitude * 180) / Math.PI
        : null,
      latitudeDeg: Number.isFinite(cartographic?.latitude)
        ? (cartographic.latitude * 180) / Math.PI
        : null,
      heightM: Number.isFinite(cartographic?.height)
        ? cartographic.height
        : null,
      headingRad: Number.isFinite(camera?.heading) ? camera.heading : null,
      pitchRad: Number.isFinite(camera?.pitch) ? camera.pitch : null,
      rollRad: Number.isFinite(camera?.roll) ? camera.roll : null,
      positionWorld: vector(camera?.positionWC),
      directionWorld: vector(camera?.directionWC),
      upWorld: vector(camera?.upWC),
      viewMatrix: matrix(camera?.viewMatrix),
      projectionMatrix: matrix(frustum?.projectionMatrix),
      sceneMode: Number.isFinite(targetViewer?.scene?.mode)
        ? targetViewer.scene.mode
        : null,
      frustumType:
        frustum?.constructor?.name === 'PerspectiveFrustum'
          ? 'perspective'
          : frustum?.constructor?.name === 'OrthographicFrustum'
            ? 'orthographic'
            : 'other-or-unavailable',
      fov: Number.isFinite(frustum?.fov) ? frustum.fov : null,
      near: Number.isFinite(frustum?.near) ? frustum.near : null,
      far: Number.isFinite(frustum?.far) ? frustum.far : null,
      left: Number.isFinite(rect?.left) ? rect.left : null,
      top: Number.isFinite(rect?.top) ? rect.top : null,
      width: Number.isFinite(rect?.width) ? rect.width : null,
      height: Number.isFinite(rect?.height) ? rect.height : null,
      drawingBufferWidth: Number.isFinite(canvas?.width) ? canvas.width : null,
      drawingBufferHeight: Number.isFinite(canvas?.height)
        ? canvas.height
        : null,
      completedRenderRevision,
    };
  };
  const record = (row) => {
    if (!active || !allowedCaller(row?.caller)) return;
    if (rows.length >= maxRows) {
      omittedRows += 1;
      return;
    }
    rows.push(row);
  };
  const observeCache = ({ caller, cacheHit, cacheAgeMs }) => {
    if (!active || !allowedCaller(caller)) return;
    const item = (cacheCounts[caller] ||= { hits: 0, misses: 0, agesMs: [] });
    if (cacheHit) item.hits += 1;
    else item.misses += 1;
    if (Number.isFinite(cacheAgeMs) && item.agesMs.length < maxRows)
      item.agesMs.push(Math.max(0, cacheAgeMs));
    record({
      kind: 'view-target-cache',
      caller,
      cacheHit: cacheHit === true,
      cacheAgeMs: Number.isFinite(cacheAgeMs) ? Math.max(0, cacheAgeMs) : null,
      elapsedMs: elapsed(),
      completedRenderRevision,
    });
  };
  const recordPick = ({
    caller,
    samplePosition,
    input,
    startedAt: pickStartedAt,
    endedAt: pickEndedAt,
    result,
    error,
    didThrow,
  }) => {
    if (!active || !allowedCaller(caller)) return;
    counts[caller] = (counts[caller] || 0) + 1;
    record({
      kind: 'depth-pick',
      caller,
      inputCapturedBeforePick: input != null,
      elapsedMs: elapsed(),
      pickElapsedMs:
        Number.isFinite(pickStartedAt) && Number.isFinite(pickEndedAt)
          ? Math.max(0, pickEndedAt - pickStartedAt)
          : null,
      ...(input || readPickInputs(viewer, samplePosition)),
      resultKind: didThrow ? 'error' : result == null ? 'miss' : 'hit',
      errorName:
        error && typeof error.name === 'string'
          ? error.name.slice(0, 64)
          : null,
      completedRenderRevision,
    });
  };
  const onPostRender = () => {
    if (active) completedRenderRevision += 1;
  };
  const removePostRenderListener =
    scene.postRender.addEventListener(onPostRender);
  const snapshot = () => {
    const canvas = scene.canvas;
    const camera = viewer.camera;
    const cartographic = camera?.positionCartographic;
    const rect = canvas?.getBoundingClientRect?.();
    const layers = Object.fromEntries(
      Object.entries(counts).map(([caller, count]) => [caller, count]),
    );
    return {
      scenario,
      run,
      documentRole,
      documentId,
      captureOrdinal,
      ownerToken,
      active,
      elapsedMs: elapsed(),
      completedRenderRevision,
      canvas: {
        left: Number.isFinite(rect?.left) ? rect.left : null,
        top: Number.isFinite(rect?.top) ? rect.top : null,
        width: Number.isFinite(rect?.width) ? rect.width : null,
        height: Number.isFinite(rect?.height) ? rect.height : null,
        drawingBufferWidth: Number.isFinite(canvas?.width)
          ? canvas.width
          : null,
        drawingBufferHeight: Number.isFinite(canvas?.height)
          ? canvas.height
          : null,
      },
      camera: {
        longitudeDeg: Number.isFinite(cartographic?.longitude)
          ? (cartographic.longitude * 180) / Math.PI
          : null,
        latitudeDeg: Number.isFinite(cartographic?.latitude)
          ? (cartographic.latitude * 180) / Math.PI
          : null,
        heightM: Number.isFinite(cartographic?.height)
          ? cartographic.height
          : null,
        headingRad: Number.isFinite(camera?.heading) ? camera.heading : null,
        pitchRad: Number.isFinite(camera?.pitch) ? camera.pitch : null,
        rollRad: Number.isFinite(camera?.roll) ? camera.roll : null,
      },
      pickCounts: layers,
      cacheCounts: Object.fromEntries(
        Object.entries(cacheCounts).map(([caller, row]) => [
          caller,
          {
            hits: row.hits,
            misses: row.misses,
            agesMs: row.agesMs.slice(0, maxRows),
          },
        ]),
      ),
      rows: rows.slice(0, maxRows),
      omittedRows,
    };
  };
  const dispose = () => {
    let finalSnapshot = null;
    try {
      finalSnapshot = snapshot();
    } catch {
      // Disposal must still remove the owned observer if read-only sampling fails.
    }
    let listenerRemoved = false;
    if (active) {
      active = false;
      try {
        if (typeof removePostRenderListener === 'function') {
          removePostRenderListener();
          listenerRemoved = true;
        } else {
          listenerRemoved = scene.postRender.removeEventListener(onPostRender);
        }
      } catch {
        // The report below makes an unconfirmed listener removal explicit.
      }
    }
    const propertyOwned = scene.__gevDepthPickAttribution === controller;
    if (propertyOwned) delete scene.__gevDepthPickAttribution;
    return {
      confirmed: propertyOwned && active === false && listenerRemoved,
      completedRenderRevision,
      finalSnapshot,
    };
  };
  const controller = {
    ownerToken,
    captureInput: readPickInputs,
    recordPick,
    recordCache: observeCache,
    snapshot,
    dispose,
  };
  scene.__gevDepthPickAttribution = controller;

  return {
    schema: 'gev-depth-pick-attribution-install/v1',
    installed: true,
    scenario,
    run,
    documentRole,
    documentId,
    captureOrdinal,
    ownerToken,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
  };
}

/** Read only bounded attribution state from the fixture-owned live viewer. */
export function observeDepthPickAttributionBoundary({ label, ownerToken }) {
  const viewer = globalThis.__godsEyeView?.viewer;
  const scene = viewer?.scene;
  const controller = scene?.__gevDepthPickAttribution;
  if (!controller || controller.ownerToken !== ownerToken) {
    return {
      schema: 'gev-depth-pick-attribution-boundary/v1',
      label,
      available: false,
    };
  }
  return {
    schema: 'gev-depth-pick-attribution-boundary/v1',
    label,
    available: true,
    ...controller.snapshot(),
  };
}

/** Dispose the fixture observer without disturbing a later owner. */
export function disposeDepthPickAttribution({ ownerToken }) {
  const viewer = globalThis.__godsEyeView?.viewer;
  const scene = viewer?.scene;
  if (!scene) return { confirmed: false, unavailable: true };
  const controller = scene?.__gevDepthPickAttribution;
  if (!controller) return { confirmed: false, alreadyAbsent: true };
  if (controller.ownerToken !== ownerToken)
    return { confirmed: false, replacedByAnotherOwner: true };
  const outcome = controller.dispose?.();
  return {
    confirmed: outcome?.confirmed === true,
    alreadyAbsent: false,
    completedRenderRevision: outcome?.completedRenderRevision ?? null,
    finalSnapshot: outcome?.finalSnapshot ?? null,
  };
}

/** Preserve the final page-side warmup snapshot when host settlement rejects. */
export function retainDepthPickBoundaryFailure(sample, label, error) {
  if (!sample || !['warmupBoundary', 'measurementBoundary'].includes(label))
    throw new TypeError('Depth-pick failure boundary identity is invalid.');
  const observation =
    error?.boundaryObservation?.page?.diagnostics?.finalObservation ?? null;
  sample[label] = observation;
  return observation;
}

/** Dispose through the Puppeteer page owner and keep the cleanup witness. */
export async function disposeDepthPickAttributionForPage(targetPage, identity) {
  if (!targetPage?.evaluate || typeof identity?.ownerToken !== 'string')
    throw new TypeError('Depth-pick page cleanup identity is invalid.');
  const result = await targetPage.evaluate(disposeDepthPickAttribution, {
    ownerToken: identity.ownerToken,
  });
  identity.cleanup = result;
  identity.sample.cleanupConfirmed = result?.confirmed === true;
  identity.sample.finalSnapshot = result?.finalSnapshot
    ? JSON.parse(JSON.stringify(result.finalSnapshot))
    : null;
  if (identity.sample.install)
    identity.sample.install.cleanup = result
      ? JSON.parse(JSON.stringify(result))
      : result;
  return result;
}

/** No observer is expected on setup documents; once installed, cleanup must prove removal. */
export function depthPickRetirementConfirmed(enabled, expectedOwner, cleanup) {
  return enabled !== true || !expectedOwner || cleanup?.confirmed === true;
}

/** Build the sample identity using the capture list's actual next ordinal. */
export function createDepthPickAttributionIdentity(
  captures,
  { scenario, run, documentRole, documentId },
) {
  if (
    !Array.isArray(captures) ||
    typeof scenario !== 'string' ||
    !Number.isInteger(run) ||
    typeof documentRole !== 'string' ||
    typeof documentId !== 'string'
  )
    throw new TypeError('Depth-pick capture identity is invalid.');
  return {
    scenario,
    run,
    captureOrdinal: captures.length,
    documentRole,
    documentId,
  };
}

const DEPTH_PICK_CALLERS = new Set([
  'voice-frame-overhead',
  'voice-basemap-label-context',
  'voice-move-end-prewarm',
  'voice-adjust-camera-zoom',
  'voice-entity-context',
  'voice-entity-context-pointer',
  'hud-summary-context',
  'voice-view-target',
  'camera-orientation-public',
  'camera-orientation-refresh',
  'camera-orientation-move-end',
  'camera-orientation-action',
]);

function assertDepthPickSnapshot(snapshot, label, identity) {
  if (
    snapshot?.schema !== 'gev-depth-pick-attribution-boundary/v1' ||
    snapshot.label !== label ||
    snapshot.available !== true ||
    snapshot.scenario !== identity.scenario ||
    snapshot.run !== identity.run ||
    snapshot.captureOrdinal !== identity.captureOrdinal ||
    snapshot.documentRole !== identity.documentRole ||
    snapshot.documentId !== identity.documentId ||
    snapshot.ownerToken !== identity.ownerToken ||
    snapshot.active !== true ||
    !Number.isFinite(snapshot.elapsedMs) ||
    snapshot.elapsedMs < 0 ||
    !Number.isSafeInteger(snapshot.completedRenderRevision) ||
    snapshot.completedRenderRevision < 0 ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length > 128 ||
    !Number.isSafeInteger(snapshot.omittedRows) ||
    snapshot.omittedRows < 0
  )
    throw new Error(
      `Depth-pick ${label} snapshot identity or bounds are invalid.`,
    );
  for (const row of snapshot.rows) {
    if (
      !DEPTH_PICK_CALLERS.has(row?.caller) ||
      !['depth-pick', 'view-target-cache'].includes(row.kind) ||
      !Number.isFinite(row.elapsedMs) ||
      row.elapsedMs < 0 ||
      !Number.isSafeInteger(row.completedRenderRevision) ||
      row.completedRenderRevision < 0
    )
      throw new Error(`Depth-pick ${label} row is malformed.`);
    if (row.kind === 'depth-pick') {
      if (
        row.inputCapturedBeforePick !== true ||
        !Number.isFinite(row.pickElapsedMs) ||
        row.pickElapsedMs < 0 ||
        !['hit', 'miss', 'error'].includes(row.resultKind) ||
        ![
          'x',
          'y',
          'longitudeDeg',
          'latitudeDeg',
          'heightM',
          'headingRad',
          'pitchRad',
          'rollRad',
          'positionWorld',
          'directionWorld',
          'upWorld',
          'viewMatrix',
          'projectionMatrix',
          'sceneMode',
          'completedRenderRevision',
        ].every((key) => Object.hasOwn(row, key)) ||
        !Number.isSafeInteger(row.completedRenderRevision)
      )
        throw new Error(`Depth-pick ${label} input witness is incomplete.`);
      if (row.inputCapturedBeforePick !== true)
        throw new Error(
          `Depth-pick ${label} input was not captured before the call.`,
        );
      for (const key of [
        'x',
        'y',
        'longitudeDeg',
        'latitudeDeg',
        'heightM',
        'headingRad',
        'pitchRad',
        'rollRad',
        'sceneMode',
        'completedRenderRevision',
      ]) {
        if (row[key] !== null && !Number.isFinite(row[key]))
          throw new Error(`Depth-pick ${label} input ${key} is invalid.`);
      }
      for (const key of [
        'positionWorld',
        'directionWorld',
        'upWorld',
        'viewMatrix',
        'projectionMatrix',
      ]) {
        if (
          row[key] !== null &&
          (!Array.isArray(row[key]) ||
            row[key].length !== (key.endsWith('Matrix') ? 16 : 3) ||
            row[key].some((value) => !Number.isFinite(value)))
        )
          throw new Error(`Depth-pick ${label} input ${key} is invalid.`);
      }
    } else if (
      typeof row.cacheHit !== 'boolean' ||
      (row.cacheAgeMs !== null &&
        (!Number.isFinite(row.cacheAgeMs) || row.cacheAgeMs < 0))
    )
      throw new Error(`Depth-pick ${label} cache row is malformed.`);
  }
}

/** Validate the actual successful-capture producer envelope before smoke accepts it. */
export function validateDepthPickAttributionEnvelope(envelope, captures) {
  if (
    envelope?.enabled !== true ||
    envelope.schema !== 'gev-depth-pick-attribution/v1' ||
    envelope.performanceAcceptanceEligible !== false ||
    envelope.status !== 'complete' ||
    !Array.isArray(captures) ||
    !Array.isArray(envelope.samples) ||
    envelope.samples.length !== captures.length ||
    envelope.samples.length < 1
  )
    throw new Error(
      'Depth-pick attribution envelope is incomplete or eligible.',
    );
  for (let index = 0; index < captures.length; index += 1) {
    const capture = captures[index];
    const sample = envelope.samples[index];
    const identity = {
      scenario: capture.scenario,
      run: capture.run,
      captureOrdinal: index,
      documentRole: sample.documentRole,
      documentId: sample.documentId,
      ownerToken: sample.ownerToken,
    };
    if (
      sample?.schema !== 'gev-depth-pick-attribution-sample/v1' ||
      sample.scenario !== identity.scenario ||
      sample.run !== identity.run ||
      sample.captureOrdinal !== index ||
      typeof identity.documentRole !== 'string' ||
      typeof identity.documentId !== 'string' ||
      sample.install?.schema !== 'gev-depth-pick-attribution-install/v1' ||
      sample.install.installed !== true ||
      sample.install.ownerToken !== identity.ownerToken ||
      sample.cleanupConfirmed !== true
    )
      throw new Error(
        `Depth-pick attribution sample ${index} identity is invalid.`,
      );
    assertDepthPickSnapshot(sample.warmupBoundary, 'warmup-boundary', identity);
    assertDepthPickSnapshot(
      sample.measurementBoundary,
      'measurement-boundary',
      identity,
    );
    if (
      sample.finalSnapshot?.scenario !== identity.scenario ||
      sample.finalSnapshot?.run !== identity.run ||
      sample.finalSnapshot?.captureOrdinal !== index ||
      sample.finalSnapshot?.documentRole !== identity.documentRole ||
      sample.finalSnapshot?.documentId !== identity.documentId ||
      sample.finalSnapshot?.ownerToken !== identity.ownerToken ||
      sample.finalSnapshot?.active !== true ||
      !Number.isSafeInteger(sample.finalSnapshot?.completedRenderRevision)
    )
      throw new Error(
        `Depth-pick attribution sample ${index} cleanup snapshot is invalid.`,
      );
  }
  return true;
}
