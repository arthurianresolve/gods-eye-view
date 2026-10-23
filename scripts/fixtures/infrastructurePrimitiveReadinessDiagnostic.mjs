export const INFRASTRUCTURE_PRIMITIVE_READINESS_SCHEMA =
  'gev-infrastructure-primitive-readiness/v1';
export const INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS = 128;
export const INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES = 256;
export const INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS = 2;
export const INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH = 4;
export const INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN = 5_000;
export const INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS = 3_000;
export const INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_PNG_BASE64 = 1_500_000;

const supportedCesiumVersions = new Set(['1.138', '1.138.0']);
const ownerKinds = new Set([
  'primitive',
  'ground-polyline-primitive',
  'point-primitive-collection',
  'unsupported-nested-collection',
]);
const targetStatuses = new Set([
  'unknown',
  'observed',
  'pending-owner-unmapped',
  'not-found',
  'truncated',
  'unknown-unindexed-owner',
]);
// A depth-4 nested collection can still expose its leaf at the fifth index.
const ownerPaths = /^(scene\.(?:primitives|groundPrimitives))(?:\/\d+){0,5}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const MAX_DIAGNOSTIC_ELAPSED_MS = 180_000;
const errorName = (error) =>
  ['TypeError', 'DeveloperError', 'RangeError'].includes(error?.name)
    ? error.name
    : 'Error';

export function infrastructurePrimitiveReadinessDiagnosticRequested(
  searchParams,
) {
  return searchParams?.get?.('primitive-readiness-diagnostic') === '1';
}

export function infrastructurePrimitiveReadinessDiagnosticOptionEnabled(args) {
  const options = Array.isArray(args) ? args : [];
  const enabled = options.includes(
    '--infrastructure-primitive-readiness-diagnostic',
  );
  if (enabled && !options.includes('--infrastructure-datacenters'))
    throw new Error(
      '--infrastructure-primitive-readiness-diagnostic requires --infrastructure-datacenters.',
    );
  if (enabled && options.includes('--infrastructure-pick-path-diagnostic'))
    throw new Error(
      'Primitive-readiness and pick-path diagnostics must run separately.',
    );
  return enabled;
}

export function createInfrastructurePrimitiveReadinessEnvelope() {
  return {
    schema: INFRASTRUCTURE_PRIMITIVE_READINESS_SCHEMA,
    enabled: true,
    instrumented: true,
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    pickAcceptanceEligible: false,
    scope:
      'post-failure-only public Cesium primitive readiness snapshot; no during-gate timeline or native-pick calls; later observation never changes or satisfies the original gate',
    maxOwners: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS,
    maxVisitedNodes: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES,
    maxTargets: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS,
    maxDepth: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH,
    maxPointChildren: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN,
    maxPostFailureMs: INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS,
    status: 'not-triggered',
    lifetimes: [],
  };
}

export function createInfrastructurePrimitiveReadinessLifetime(envelope, mode) {
  if (!['entities', 'primitive-collections'].includes(mode))
    throw new TypeError('Primitive readiness renderer mode is invalid.');
  const lifetime = {
    mode,
    status: 'not-triggered',
    originalGate: null,
    targets: [],
    initialSnapshot: null,
    postFailureObservation: null,
    renderRevisionObserver: {
      available: false,
      cleanupConfirmed: false,
    },
  };
  envelope.lifetimes.push(lifetime);
  return {
    report: lifetime,
    ownerIds: { values: new WeakMap(), next: 1 },
  };
}

export function selectPrimitiveReadinessTargets(rows) {
  if (!Array.isArray(rows)) return [];
  const selected = [];
  for (const row of rows) {
    if (
      row?.entityShow !== true ||
      row?.point?.show !== true ||
      row?.stem?.show !== true ||
      typeof row.entityId !== 'string' ||
      typeof row.sourceRecordId !== 'string'
    )
      continue;
    selected.push({
      entityId: row.entityId,
      sourceRecordId: row.sourceRecordId,
      visible: true,
    });
    if (selected.length >= INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS)
      break;
  }
  return selected;
}

function boundedCandidates(candidates, entityById) {
  if (!Array.isArray(candidates)) return [];
  const bounded = [];
  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate.entityId !== 'string' ||
      candidate.entityId.length === 0 ||
      candidate.entityId.length > 160 ||
      typeof candidate.sourceRecordId !== 'string' ||
      candidate.sourceRecordId.length === 0 ||
      candidate.sourceRecordId.length > 160 ||
      candidate.visible !== true
    )
      continue;
    bounded.push({
      entityId: candidate.entityId,
      sourceRecordId: candidate.sourceRecordId,
      visible: true,
      entityRef: entityById?.get?.(candidate.entityId) || null,
    });
    if (bounded.length >= INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS) break;
  }
  return bounded;
}

function safeOwnerId(owner, ids) {
  if (!owner || (typeof owner !== 'object' && typeof owner !== 'function'))
    return null;
  let id = ids.values.get(owner);
  if (id === undefined) {
    id = ids.next++;
    ids.values.set(owner, id);
  }
  return id;
}

function safeFlag(owner, name) {
  try {
    const value = owner?.[name];
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

function classifyOwner(owner, Cesium) {
  try {
    if (
      typeof Cesium?.GroundPolylinePrimitive === 'function' &&
      owner instanceof Cesium.GroundPolylinePrimitive
    )
      return 'ground-polyline-primitive';
    if (
      typeof Cesium?.Primitive === 'function' &&
      owner instanceof Cesium.Primitive
    )
      return 'primitive';
    if (
      typeof Cesium?.PointPrimitiveCollection === 'function' &&
      owner instanceof Cesium.PointPrimitiveCollection
    )
      return 'point-primitive-collection';
    if (
      typeof Cesium?.PrimitiveCollection === 'function' &&
      owner instanceof Cesium.PrimitiveCollection
    )
      return 'primitive-collection';
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

function pointTargetMatches(collection, candidates, pointLimit) {
  const matches = [];
  let count = null;
  let inspected = 0;
  let scanStatus = 'unavailable';
  try {
    count = collection.length;
    if (!Number.isSafeInteger(count) || count < 0)
      return { matches, count: null, inspected, scanStatus };
    if (typeof collection.get !== 'function')
      return { matches, count, inspected, scanStatus };
    const limit = Math.min(count, pointLimit);
    for (let index = 0; index < limit; index++) {
      inspected++;
      const point = collection.get(index);
      for (const candidate of candidates) {
        if (candidate.entityRef && point?.id === candidate.entityRef)
          matches.push({
            entityId: candidate.entityId,
            show: safeFlag(point, 'show'),
          });
      }
    }
    scanStatus = count > pointLimit ? 'truncated' : 'complete';
  } catch {
    scanStatus = 'read-error';
  }
  return { matches, count, inspected, scanStatus };
}

function instanceTargetMatches(owner, kind, candidates) {
  const ready = safeFlag(owner, 'ready');
  const show = safeFlag(owner, 'show');
  return {
    ready,
    show,
    targetAttributes: candidates.map((candidate) => {
      if (ready !== true)
        return { entityId: candidate.entityId, status: 'not-read-until-ready' };
      if (!candidate.entityRef)
        return {
          entityId: candidate.entityId,
          status: 'entity-reference-unavailable',
        };
      if (typeof owner?.getGeometryInstanceAttributes !== 'function')
        return { entityId: candidate.entityId, status: 'api-unavailable' };
      try {
        const attributes = owner.getGeometryInstanceAttributes(
          candidate.entityRef,
        );
        return {
          entityId: candidate.entityId,
          status: attributes ? 'attributes-present' : 'not-found',
        };
      } catch (error) {
        return {
          entityId: candidate.entityId,
          status: 'read-error',
          errorName: errorName(error),
        };
      }
    }),
    attributeReadSemantics:
      'public getGeometryInstanceAttributes called only when ready; Cesium may cache returned attributes',
    kind,
  };
}

/** Read bounded public scene collections without retaining Cesium objects. */
export function collectInfrastructurePrimitiveReadiness({
  Cesium,
  viewer,
  candidates,
  entityById,
  ownerIds = { values: new WeakMap(), next: 1 },
  maxOwners = INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS,
  maxDepth = INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH,
  maxPointChildren = INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN,
}) {
  const ownerLimit =
    Number.isSafeInteger(maxOwners) && maxOwners >= 0
      ? Math.min(maxOwners, INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS)
      : INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS;
  const depthLimit =
    Number.isSafeInteger(maxDepth) && maxDepth >= 0
      ? Math.min(maxDepth, INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH)
      : INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH;
  const pointChildLimit =
    Number.isSafeInteger(maxPointChildren) && maxPointChildren >= 0
      ? Math.min(
          maxPointChildren,
          INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN,
        )
      : INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN;
  const targets = boundedCandidates(candidates, entityById);
  const version =
    typeof Cesium?.VERSION === 'string' && Cesium.VERSION.length <= 32
      ? Cesium.VERSION
      : null;
  let sourceReady = null;
  try {
    const ready = viewer?.dataSourceDisplay?.ready;
    sourceReady = typeof ready === 'boolean' ? ready : null;
  } catch {
    sourceReady = null;
  }
  const result = {
    schema: INFRASTRUCTURE_PRIMITIVE_READINESS_SCHEMA,
    version,
    versionStatus: supportedCesiumVersions.has(version)
      ? 'supported'
      : 'unsupported',
    latchedDataSourceDisplayReady: sourceReady,
    instrumentationOnly: true,
    attributeReadSemantics:
      'public getGeometryInstanceAttributes called only when ready; Cesium may cache returned attributes',
    status: 'unknown',
    truncated: false,
    visitedNodeCount: 0,
    maxVisitedNodes: INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES,
    pointChildrenInspected: 0,
    owners: [],
    roots: [
      {
        path: 'scene.primitives',
        status: 'version-unsupported',
        childCount: null,
      },
      {
        path: 'scene.groundPrimitives',
        status: 'version-unsupported',
        childCount: null,
      },
    ],
    unindexedCollectionCount: 0,
    unknownOwnerCount: 0,
    readErrorCount: 0,
    targets: targets.map((candidate) => ({
      entityId: candidate.entityId,
      sourceRecordId: candidate.sourceRecordId,
      visible: true,
      pointStatus: 'unknown',
      stemStatus: 'unknown',
    })),
  };
  if (result.versionStatus !== 'supported') return result;
  result.roots.length = 0;

  let unindexedCollectionCount = 0;
  let unknownOwnerCount = 0;
  let scanErrorCount = 0;
  const matchedPointIds = new Set();
  const matchedStemIds = new Set();
  const collectionType = Cesium?.PrimitiveCollection;
  const isCollection = (owner) =>
    typeof collectionType === 'function' && owner instanceof collectionType;

  const addUnknownCollection = (owner, path) => {
    unindexedCollectionCount++;
    if (result.owners.length < ownerLimit) {
      result.owners.push({
        ownerId: safeOwnerId(owner, ownerIds),
        path,
        kind: 'unsupported-nested-collection',
        typeName: 'OrderedGroundPrimitiveCollection',
        status: 'unavailable-public-indexing',
        ready: null,
        show: safeFlag(owner, 'show'),
        targetAttributes: [],
      });
    } else result.truncated = true;
  };

  const visitedCollections = new WeakSet();
  const walk = (collection, path, depth, root = null) => {
    if (
      result.visitedNodeCount >=
      INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES
    ) {
      result.truncated = true;
      if (root) root.status = 'visit-budget-exhausted';
      return;
    }
    result.visitedNodeCount++;
    if (root) root.status = 'observed';
    if (!isCollection(collection)) {
      if (root) root.status = 'unsupported-root-shape';
      unknownOwnerCount++;
      return;
    }
    if (visitedCollections.has(collection)) {
      result.truncated = true;
      if (root) root.status = 'cycle';
      return;
    }
    visitedCollections.add(collection);
    let length;
    try {
      length = collection.length;
    } catch {
      if (root) root.status = 'read-error';
      scanErrorCount++;
      return;
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      if (root) root.status = 'invalid-count';
      scanErrorCount++;
      return;
    }
    if (root) root.childCount = length;
    if (typeof collection.get !== 'function') {
      if (root) root.status = 'unsupported-indexing';
      unindexedCollectionCount++;
      return;
    }
    for (let index = 0; index < length; index++) {
      if (
        result.owners.length >= ownerLimit ||
        result.visitedNodeCount >=
          INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES
      ) {
        result.truncated = true;
        break;
      }
      result.visitedNodeCount++;
      const childPath = `${path}/${index}`;
      let owner;
      try {
        owner = collection.get(index);
      } catch {
        scanErrorCount++;
        continue;
      }
      if (!owner) {
        scanErrorCount++;
        continue;
      }
      const kind = classifyOwner(owner, Cesium);
      if (kind === 'primitive-collection') {
        if (depth >= depthLimit) {
          result.truncated = true;
          continue;
        }
        walk(owner, childPath, depth + 1);
        continue;
      }
      if (kind === 'unknown') {
        let typeName = null;
        try {
          typeName = owner?.constructor?.name;
        } catch {
          // A changing/private shape remains explicitly unavailable.
        }
        if (typeName === 'OrderedGroundPrimitiveCollection')
          addUnknownCollection(owner, childPath);
        else unknownOwnerCount++;
        continue;
      }
      const ownerRecord = {
        ownerId: safeOwnerId(owner, ownerIds),
        path: childPath,
        kind,
        status: 'observed',
        ready: null,
        show: safeFlag(owner, 'show'),
        targetAttributes: [],
      };
      if (kind === 'point-primitive-collection') {
        const pointScan = pointTargetMatches(
          owner,
          targets,
          Math.max(0, pointChildLimit - result.pointChildrenInspected),
        );
        result.pointChildrenInspected += pointScan.inspected;
        ownerRecord.childCount = pointScan.count;
        ownerRecord.inspectedChildren = pointScan.inspected;
        ownerRecord.childScanStatus = pointScan.scanStatus;
        if (pointScan.scanStatus === 'truncated') result.truncated = true;
        if (pointScan.scanStatus === 'read-error') scanErrorCount++;
        for (const match of pointScan.matches) {
          matchedPointIds.add(match.entityId);
          ownerRecord.targetAttributes.push({
            entityId: match.entityId,
            status: 'point-child-observed',
            show: match.show,
          });
        }
      } else {
        const instanceRead = instanceTargetMatches(owner, kind, targets);
        ownerRecord.ready = instanceRead.ready;
        ownerRecord.show = instanceRead.show;
        ownerRecord.targetAttributes = instanceRead.targetAttributes;
        if (
          instanceRead.targetAttributes.some(
            (entry) => entry.status === 'read-error',
          )
        )
          scanErrorCount++;
        for (const entry of instanceRead.targetAttributes) {
          if (entry.status === 'attributes-present')
            matchedStemIds.add(entry.entityId);
        }
      }
      result.owners.push(ownerRecord);
    }
  };

  let primitivesRoot = null;
  let groundRoot = null;
  try {
    primitivesRoot = viewer?.scene?.primitives;
  } catch {
    scanErrorCount++;
  }
  try {
    groundRoot = viewer?.scene?.groundPrimitives;
  } catch {
    scanErrorCount++;
  }
  const primitivesRootRecord = {
    path: 'scene.primitives',
    status: 'observed',
    childCount: null,
  };
  const groundRootRecord = {
    path: 'scene.groundPrimitives',
    status: 'observed',
    childCount: null,
  };
  result.roots.push(primitivesRootRecord, groundRootRecord);
  walk(primitivesRoot, 'scene.primitives', 0, primitivesRootRecord);
  walk(groundRoot, 'scene.groundPrimitives', 0, groundRootRecord);
  const pendingStemOwner = result.owners.some(
    (owner) =>
      ['primitive', 'ground-polyline-primitive'].includes(owner.kind) &&
      owner.ready === false,
  );
  for (const target of result.targets) {
    target.pointStatus = matchedPointIds.has(target.entityId)
      ? 'observed'
      : result.truncated
        ? 'truncated'
        : pendingStemOwner
          ? 'pending-owner-unmapped'
          : result.owners.some(
                (owner) => owner.kind === 'point-primitive-collection',
              )
            ? 'unknown'
            : unknownOwnerCount + unindexedCollectionCount > 0
              ? 'unknown-unindexed-owner'
              : 'not-found';
    target.stemStatus = matchedStemIds.has(target.entityId)
      ? 'observed'
      : result.truncated
        ? 'truncated'
        : pendingStemOwner
          ? 'pending-owner-unmapped'
          : unknownOwnerCount + unindexedCollectionCount > 0
            ? 'unknown-unindexed-owner'
            : 'not-found';
  }
  result.unindexedCollectionCount = unindexedCollectionCount;
  result.unknownOwnerCount = unknownOwnerCount;
  result.readErrorCount = scanErrorCount;
  result.status =
    result.truncated || scanErrorCount > 0
      ? 'partial'
      : unindexedCollectionCount > 0 || unknownOwnerCount > 0
        ? 'partially-indexable'
        : 'observed';
  return result;
}

/** One bounded later frame; this result can never alter the failed gate. */
export async function observePrimitiveReadinessAfterFailure({
  gateFailure,
  capture,
  now = () => performance.now(),
  maxDurationMs = INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS,
}) {
  const startedAt = now();
  const record = {
    phase: 'post-failure-later-frame-observation',
    originalGateFailed: gateFailure?.status === 'failed',
    acceptanceEligible: false,
    originalGate: gateFailure || null,
    requestedDiagnosticRender: false,
    additionalPickCalls: 0,
    durationBudgetMs: INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS,
    elapsedMs: 0,
    overBudget: false,
    status: 'unavailable',
    frame: null,
  };
  if (
    record.originalGateFailed !== true ||
    typeof capture !== 'function' ||
    !Number.isFinite(maxDurationMs) ||
    maxDurationMs < 1 ||
    maxDurationMs > INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS
  ) {
    record.status = 'diagnostic-error';
    record.errorName = 'TypeError';
    record.elapsedMs = Math.max(0, now() - startedAt);
    record.overBudget = record.elapsedMs > record.durationBudgetMs;
    return record;
  }
  record.durationBudgetMs = maxDurationMs;
  let timer;
  let framePromise;
  const controller = new AbortController();
  const timeoutResult = Symbol('diagnostic-timeout');
  try {
    const remaining = Math.min(
      maxDurationMs,
      INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS,
    );
    framePromise = Promise.resolve().then(() =>
      capture({
        timeoutMs: remaining,
        signal: controller.signal,
        markRenderRequested() {
          record.requestedDiagnosticRender = true;
        },
      }),
    );
    framePromise.catch(() => {});
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(timeoutResult);
      }, remaining);
    });
    const frame = await Promise.race([framePromise, timedOut]);
    if (frame === timeoutResult) {
      record.status = 'capture-budget-expired';
    } else if (frame) {
      const sourcePngBase64 =
        typeof frame.pngBase64 === 'string' ? frame.pngBase64 : null;
      const pngBase64 = isBoundedBase64(sourcePngBase64)
        ? sourcePngBase64
        : null;
      record.frame = {
        width:
          Number.isSafeInteger(frame.width) && frame.width > 0
            ? frame.width
            : null,
        height:
          Number.isSafeInteger(frame.height) && frame.height > 0
            ? frame.height
            : null,
        pixelSha256: /^[a-f0-9]{64}$/.test(frame.pixelSha256 || '')
          ? frame.pixelSha256
          : null,
        pngBase64,
        pngStatus: pngBase64
          ? 'retained'
          : sourcePngBase64 === null
            ? 'unavailable'
            : sourcePngBase64.length >
                INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_PNG_BASE64
              ? 'omitted-over-limit'
              : 'invalid',
        completedFrameState: frame.completedFrameState || null,
        completedFrameStateErrorName:
          frame.completedFrameStateErrorName || null,
      };
      record.status = 'completed-frame-observed';
    } else record.status = 'no-completed-frame';
  } catch (error) {
    record.status = 'diagnostic-error';
    record.errorName = errorName(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    record.elapsedMs = Math.max(0, now() - startedAt);
    record.overBudget = record.elapsedMs > record.durationBudgetMs;
    if (record.overBudget && record.status === 'completed-frame-observed')
      record.status = 'late-frame-observed';
    if (framePromise) {
      framePromise
        .then((frame) => {
          if (frame?.pixels) frame.pixels = null;
        })
        .catch(() => {});
    }
  }
  return record;
}

export function validateInfrastructurePrimitiveReadinessEnvelope(envelope) {
  const fail = () => {
    throw new Error(
      'Infrastructure primitive-readiness diagnostic is malformed.',
    );
  };
  const onlyKeys = (value, allowed) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key));
  if (
    !onlyKeys(envelope, [
      'schema',
      'enabled',
      'instrumented',
      'diagnosticOnly',
      'performanceAcceptanceEligible',
      'pickAcceptanceEligible',
      'scope',
      'maxOwners',
      'maxVisitedNodes',
      'maxTargets',
      'maxDepth',
      'maxPointChildren',
      'maxPostFailureMs',
      'status',
      'lifetimes',
    ]) ||
    envelope.schema !== INFRASTRUCTURE_PRIMITIVE_READINESS_SCHEMA ||
    envelope.enabled !== true ||
    envelope.instrumented !== true ||
    envelope.diagnosticOnly !== true ||
    envelope.performanceAcceptanceEligible !== false ||
    envelope.pickAcceptanceEligible !== false ||
    envelope.scope !==
      'post-failure-only public Cesium primitive readiness snapshot; no during-gate timeline or native-pick calls; later observation never changes or satisfies the original gate' ||
    envelope.maxOwners !== INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS ||
    envelope.maxVisitedNodes !==
      INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES ||
    envelope.maxTargets !== INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS ||
    envelope.maxDepth !== INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_DEPTH ||
    envelope.maxPointChildren !==
      INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN ||
    envelope.maxPostFailureMs !==
      INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS ||
    !['not-triggered', 'partial-or-diagnostic-error'].includes(
      envelope.status,
    ) ||
    !Array.isArray(envelope.lifetimes) ||
    envelope.lifetimes.length > 2
  )
    fail();
  const triggered = envelope.lifetimes.some(
    (lifetime) => lifetime.status !== 'not-triggered',
  );
  if (
    (triggered && envelope.status !== 'partial-or-diagnostic-error') ||
    (!triggered && envelope.status !== 'not-triggered')
  )
    fail();
  const modes = ['entities', 'primitive-collections'];
  for (let index = 0; index < envelope.lifetimes.length; index++) {
    const lifetime = envelope.lifetimes[index];
    if (
      !onlyKeys(lifetime, [
        'mode',
        'status',
        'originalGate',
        'targets',
        'initialSnapshot',
        'postFailureObservation',
        'renderRevisionObserver',
      ]) ||
      lifetime.mode !== modes[index] ||
      !['not-triggered', 'observed', 'partial-or-diagnostic-error'].includes(
        lifetime.status,
      ) ||
      !Array.isArray(lifetime.targets) ||
      lifetime.targets.length > INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS
    )
      fail();
    if (
      !onlyKeys(lifetime.renderRevisionObserver, [
        'available',
        'cleanupConfirmed',
        'errorName',
      ]) ||
      typeof lifetime.renderRevisionObserver.available !== 'boolean' ||
      typeof lifetime.renderRevisionObserver.cleanupConfirmed !== 'boolean'
    )
      fail();
    for (const target of lifetime.targets) {
      if (
        !onlyKeys(target, [
          'entityId',
          'sourceRecordId',
          'visible',
          'pointStatus',
          'stemStatus',
        ]) ||
        typeof target.entityId !== 'string' ||
        !target.entityId ||
        target.entityId.length > 160 ||
        typeof target.sourceRecordId !== 'string' ||
        !target.sourceRecordId ||
        target.sourceRecordId.length > 160 ||
        target.visible !== true ||
        !targetStatuses.has(target.pointStatus) ||
        !targetStatuses.has(target.stemStatus)
      )
        fail();
    }
    if (lifetime.status === 'not-triggered') {
      if (
        lifetime.originalGate !== null ||
        lifetime.initialSnapshot !== null ||
        lifetime.postFailureObservation !== null ||
        lifetime.renderRevisionObserver.available !== false ||
        lifetime.renderRevisionObserver.cleanupConfirmed !== false
      )
        fail();
      continue;
    }
    const gate = lifetime.originalGate;
    if (
      !onlyKeys(gate, [
        'caseId',
        'pair',
        'status',
        'stableFrames',
        'completedCaptures',
        'pickSearches',
        'geometryReady',
        'sourceReady',
        'pointPickObserved',
        'stemPickObserved',
      ]) ||
      gate.status !== 'failed' ||
      !['default-style', 'camera-lod-update'].includes(gate.caseId) ||
      !Number.isSafeInteger(gate.pair) ||
      gate.pair < 0 ||
      gate.pair >= 5 ||
      !Number.isSafeInteger(gate.stableFrames) ||
      gate.stableFrames < 0 ||
      !Number.isSafeInteger(gate.completedCaptures) ||
      gate.completedCaptures < 0 ||
      !Number.isSafeInteger(gate.pickSearches) ||
      gate.pickSearches < 0 ||
      typeof gate.geometryReady !== 'boolean' ||
      (gate.sourceReady !== null && typeof gate.sourceReady !== 'boolean') ||
      typeof gate.pointPickObserved !== 'boolean' ||
      typeof gate.stemPickObserved !== 'boolean'
    )
      fail();
    if (
      lifetime.initialSnapshot !== null &&
      !validSnapshot(lifetime.initialSnapshot)
    )
      fail();
    const later = lifetime.postFailureObservation;
    if (
      later !== null &&
      (!onlyKeys(later, [
        'phase',
        'originalGateFailed',
        'acceptanceEligible',
        'originalGate',
        'requestedDiagnosticRender',
        'additionalPickCalls',
        'durationBudgetMs',
        'elapsedMs',
        'overBudget',
        'status',
        'frame',
        'errorName',
      ]) ||
        later.phase !== 'post-failure-later-frame-observation' ||
        later.originalGateFailed !== true ||
        later.acceptanceEligible !== false ||
        JSON.stringify(later.originalGate) !== JSON.stringify(gate) ||
        typeof later.requestedDiagnosticRender !== 'boolean' ||
        later.additionalPickCalls !== 0 ||
        !Number.isFinite(later.durationBudgetMs) ||
        later.durationBudgetMs < 1 ||
        later.durationBudgetMs > INFRASTRUCTURE_PRIMITIVE_READINESS_WINDOW_MS ||
        !Number.isFinite(later.elapsedMs) ||
        later.elapsedMs < 0 ||
        later.elapsedMs > MAX_DIAGNOSTIC_ELAPSED_MS ||
        typeof later.overBudget !== 'boolean' ||
        later.overBudget !== later.elapsedMs > later.durationBudgetMs ||
        ![
          'completed-frame-observed',
          'late-frame-observed',
          'capture-budget-expired',
          'no-completed-frame',
          'diagnostic-error',
        ].includes(later.status) ||
        (later.status === 'completed-frame-observed' &&
          (later.overBudget ||
            !later.requestedDiagnosticRender ||
            !validLaterFrame(later.frame))) ||
        (later.status === 'late-frame-observed' &&
          (!later.overBudget ||
            !later.requestedDiagnosticRender ||
            !validLaterFrame(later.frame))) ||
        (later.status !== 'completed-frame-observed' &&
          later.status !== 'late-frame-observed' &&
          later.frame !== null) ||
        (later.status === 'diagnostic-error' &&
          !['Error', 'TypeError', 'DeveloperError', 'RangeError'].includes(
            later.errorName,
          )))
    )
      fail();
  }
  return envelope;
}

export function validateInfrastructurePrimitiveReadinessReport(report) {
  const envelope =
    report?.instrumentation?.primitiveReadinessDiagnostic || null;
  if (!envelope)
    throw new Error(
      'Infrastructure primitive-readiness report is missing its diagnostic envelope.',
    );
  return validateInfrastructurePrimitiveReadinessEnvelope(envelope);
}

function validSnapshot(snapshot) {
  const onlyKeys = (value, allowed) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key));
  if (
    !onlyKeys(snapshot, [
      'schema',
      'version',
      'versionStatus',
      'latchedDataSourceDisplayReady',
      'instrumentationOnly',
      'attributeReadSemantics',
      'status',
      'truncated',
      'visitedNodeCount',
      'maxVisitedNodes',
      'pointChildrenInspected',
      'owners',
      'roots',
      'targets',
      'unindexedCollectionCount',
      'unknownOwnerCount',
      'readErrorCount',
    ]) ||
    snapshot.schema !== INFRASTRUCTURE_PRIMITIVE_READINESS_SCHEMA ||
    (snapshot.version !== null &&
      (typeof snapshot.version !== 'string' || snapshot.version.length > 32)) ||
    !['supported', 'unsupported'].includes(snapshot.versionStatus) ||
    (snapshot.versionStatus === 'supported' &&
      !['1.138', '1.138.0'].includes(snapshot.version)) ||
    (snapshot.latchedDataSourceDisplayReady !== null &&
      typeof snapshot.latchedDataSourceDisplayReady !== 'boolean') ||
    snapshot.instrumentationOnly !== true ||
    snapshot.attributeReadSemantics !==
      'public getGeometryInstanceAttributes called only when ready; Cesium may cache returned attributes' ||
    !['unknown', 'partial', 'partially-indexable', 'observed'].includes(
      snapshot.status,
    ) ||
    typeof snapshot.truncated !== 'boolean' ||
    !Number.isSafeInteger(snapshot.visitedNodeCount) ||
    snapshot.visitedNodeCount < 0 ||
    snapshot.visitedNodeCount >
      INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES ||
    snapshot.maxVisitedNodes !==
      INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_VISITED_NODES ||
    !Number.isSafeInteger(snapshot.pointChildrenInspected) ||
    snapshot.pointChildrenInspected < 0 ||
    snapshot.pointChildrenInspected >
      INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_POINT_CHILDREN ||
    !Array.isArray(snapshot.owners) ||
    snapshot.owners.length > INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_OWNERS ||
    !Array.isArray(snapshot.roots) ||
    snapshot.roots.length !== 2 ||
    !Array.isArray(snapshot.targets) ||
    snapshot.targets.length > INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS ||
    !Number.isSafeInteger(snapshot.unindexedCollectionCount) ||
    snapshot.unindexedCollectionCount < 0 ||
    !Number.isSafeInteger(snapshot.unknownOwnerCount) ||
    snapshot.unknownOwnerCount < 0 ||
    !Number.isSafeInteger(snapshot.readErrorCount) ||
    snapshot.readErrorCount < 0
  )
    return false;
  if (
    snapshot.versionStatus === 'unsupported' &&
    (snapshot.status !== 'unknown' ||
      snapshot.owners.length !== 0 ||
      snapshot.truncated !== false ||
      snapshot.roots.some((root) => root.status !== 'version-unsupported'))
  )
    return false;
  const expectedRootPaths = ['scene.primitives', 'scene.groundPrimitives'];
  if (
    !snapshot.roots.every(
      (root, index) =>
        onlyKeys(root, ['path', 'status', 'childCount']) &&
        root.path === expectedRootPaths[index] &&
        [
          'observed',
          'unsupported-root-shape',
          'read-error',
          'invalid-count',
          'unsupported-indexing',
          'cycle',
          'version-unsupported',
          'visit-budget-exhausted',
        ].includes(root.status) &&
        (root.childCount === null ||
          (Number.isSafeInteger(root.childCount) && root.childCount >= 0)),
    )
  )
    return false;
  if (
    !snapshot.targets.every(
      (target) =>
        onlyKeys(target, [
          'entityId',
          'sourceRecordId',
          'visible',
          'pointStatus',
          'stemStatus',
        ]) &&
        validText(target.entityId, 160) &&
        validText(target.sourceRecordId, 160) &&
        target.visible === true &&
        targetStatuses.has(target.pointStatus) &&
        targetStatuses.has(target.stemStatus),
    )
  )
    return false;
  for (const owner of snapshot.owners) {
    if (
      !owner ||
      !ownerKinds.has(owner.kind) ||
      !Number.isSafeInteger(owner.ownerId) ||
      owner.ownerId < 1 ||
      !ownerPaths.test(owner.path || '') ||
      !Array.isArray(owner.targetAttributes) ||
      owner.targetAttributes.length >
        INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_TARGETS
    )
      return false;
    const allowedOwnerKeys = [
      'ownerId',
      'path',
      'kind',
      'status',
      'ready',
      'show',
      'targetAttributes',
      'childCount',
      'inspectedChildren',
      'childScanStatus',
      'typeName',
    ];
    if (
      !onlyKeys(owner, allowedOwnerKeys) ||
      (owner.status !== 'observed' &&
        owner.status !== 'unavailable-public-indexing') ||
      (owner.ready !== null && typeof owner.ready !== 'boolean') ||
      (owner.show !== null && typeof owner.show !== 'boolean')
    )
      return false;
    if (owner.kind === 'unsupported-nested-collection') {
      if (
        owner.status !== 'unavailable-public-indexing' ||
        owner.typeName !== 'OrderedGroundPrimitiveCollection' ||
        owner.ready !== null ||
        owner.targetAttributes.length !== 0
      )
        return false;
    } else if (owner.kind === 'point-primitive-collection') {
      if (
        !Number.isSafeInteger(owner.childCount) ||
        owner.childCount < 0 ||
        !Number.isSafeInteger(owner.inspectedChildren) ||
        owner.inspectedChildren < 0 ||
        owner.inspectedChildren > owner.childCount ||
        !['complete', 'truncated', 'unavailable', 'read-error'].includes(
          owner.childScanStatus,
        )
      )
        return false;
    } else if (
      owner.childCount !== undefined ||
      owner.inspectedChildren !== undefined ||
      owner.childScanStatus !== undefined ||
      owner.typeName !== undefined
    )
      return false;
    if (
      !owner.targetAttributes.every((target) =>
        owner.kind === 'point-primitive-collection'
          ? onlyKeys(target, ['entityId', 'status', 'show']) &&
            validText(target.entityId, 160) &&
            target.status === 'point-child-observed' &&
            (target.show === null || typeof target.show === 'boolean')
          : onlyKeys(target, ['entityId', 'status', 'errorName']) &&
            validText(target.entityId, 160) &&
            [
              'attributes-present',
              'not-found',
              'not-read-until-ready',
              'entity-reference-unavailable',
              'api-unavailable',
              'read-error',
            ].includes(target.status) &&
            (target.errorName === undefined ||
              ['Error', 'TypeError', 'DeveloperError', 'RangeError'].includes(
                target.errorName,
              )),
      )
    )
      return false;
  }
  return true;
}

function validText(value, maxLength) {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= maxLength
  );
}

function isBoundedBase64(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= INFRASTRUCTURE_PRIMITIVE_READINESS_MAX_PNG_BASE64 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  );
}

function validLaterFrame(frame) {
  const onlyKeys = (value, allowed) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key));
  return (
    onlyKeys(frame, [
      'width',
      'height',
      'pixelSha256',
      'pngBase64',
      'pngStatus',
      'completedFrameState',
      'completedFrameStateErrorName',
    ]) &&
    frame &&
    Number.isSafeInteger(frame.width) &&
    frame.width > 0 &&
    frame.width <= 4096 &&
    Number.isSafeInteger(frame.height) &&
    frame.height > 0 &&
    frame.height <= 4096 &&
    frame.width * frame.height <= 16_000_000 &&
    (frame.pixelSha256 === null || sha256Pattern.test(frame.pixelSha256)) &&
    (frame.pngBase64 === null || isBoundedBase64(frame.pngBase64)) &&
    ['retained', 'omitted-over-limit', 'unavailable', 'invalid'].includes(
      frame.pngStatus,
    ) &&
    (frame.completedFrameStateErrorName === null ||
      ['Error', 'TypeError', 'DeveloperError', 'RangeError'].includes(
        frame.completedFrameStateErrorName,
      )) &&
    ((frame.pngStatus === 'retained' && frame.pngBase64 !== null) ||
      (frame.pngStatus === 'unavailable' && frame.pngBase64 === null) ||
      (frame.pngStatus === 'omitted-over-limit' && frame.pngBase64 === null) ||
      (frame.pngStatus === 'invalid' && frame.pngBase64 === null)) &&
    (frame.completedFrameState === null ||
      (onlyKeys(frame.completedFrameState, [
        'completedRenderRevision',
        'cameraPosition',
        'renderClockIso',
        'primitiveReadiness',
      ]) &&
        Number.isSafeInteger(
          frame.completedFrameState.completedRenderRevision,
        ) &&
        frame.completedFrameState.completedRenderRevision > 0 &&
        Array.isArray(frame.completedFrameState.cameraPosition) &&
        frame.completedFrameState.cameraPosition.length === 3 &&
        frame.completedFrameState.cameraPosition.every(Number.isFinite) &&
        (frame.completedFrameState.renderClockIso === null ||
          (typeof frame.completedFrameState.renderClockIso === 'string' &&
            frame.completedFrameState.renderClockIso.length <= 64)) &&
        validSnapshot(frame.completedFrameState.primitiveReadiness)))
  );
}
