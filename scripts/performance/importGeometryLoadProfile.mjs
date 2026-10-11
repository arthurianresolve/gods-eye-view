import {
  normalizeImportHeapProfile,
  summarizeImportHeapProfile,
} from './importLoadProfile.mjs';
import { summarizeCpuProfile } from './sampledCpuProfile.mjs';
import { createHash } from 'node:crypto';

export const IMPORT_GEOMETRY_LOAD_PROFILE_SCHEMA =
  'gev-import-geometry-load-profile/v1';
export const IMPORT_GEOMETRY_LOAD_PROFILE_PHASES = Object.freeze([
  'record-selection',
  'coordinate-conversion',
  'entity-publication',
  'evidence-envelope',
  'context-registration',
  'overlay-publication',
  'render-request',
  'clear',
]);
const ALLOWED_PHASES = new Set(IMPORT_GEOMETRY_LOAD_PROFILE_PHASES);
const MAX_PHASE_EVENTS = 100_000;
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const REQUIRED_SOURCE_HASHES = Object.freeze([
  'runtimeLayerSha256',
  'cooperativeSha256',
  'fixtureSha256',
  'fixtureHtmlSha256',
  'viteEntryConfigSha256',
  'viteConfigSha256',
  'runnerSha256',
  'profileHelperSha256',
  'cpuHeapHelperSha256',
  'traceHelperSha256',
  'traceSummarySha256',
  'sampledCpuProfileSha256',
  'rendererEvidenceSha256',
  'pageOwnershipSha256',
  'sourceProvenanceSha256',
  'packageLockSha256',
  'cesiumEntrySha256',
  'cesiumSceneSha256',
]);

export function createImportGeometryPhaseRecorder() {
  const phases = Object.fromEntries(
    IMPORT_GEOMETRY_LOAD_PROFILE_PHASES.map((name) => [
      name,
      { count: 0, totalMs: 0, maxMs: 0, over4Ms: 0 },
    ]),
  );
  let eventCount = 0;
  let invalidCount = 0;
  return {
    record({ phase, durationMs } = {}) {
      eventCount++;
      if (
        eventCount > MAX_PHASE_EVENTS ||
        !ALLOWED_PHASES.has(phase) ||
        !Number.isFinite(durationMs) ||
        durationMs < 0
      ) {
        invalidCount++;
        return;
      }
      const row = phases[phase];
      row.count++;
      row.totalMs += durationMs;
      row.maxMs = Math.max(row.maxMs, durationMs);
      if (durationMs > 4) row.over4Ms++;
    },
    snapshot() {
      return {
        schema: 'gev-import-geometry-phase-summary/v1',
        eventCount,
        invalidCount,
        phases: structuredClone(phases),
      };
    },
  };
}

export function summarizeGeometryLoadProfile({ mode, profile }) {
  if (mode !== 'cpu' && mode !== 'heap')
    throw new TypeError('Geometry profile mode must be cpu or heap.');
  const base =
    profile?.mode === mode
      ? profile
      : mode === 'cpu'
        ? summarizeCpuProfile(profile)
        : summarizeImportHeapProfile(profile);
  const retainedInput =
    mode === 'cpu'
      ? base.profile
      : profile?.mode === 'heap'
        ? profile.profile
        : normalizeImportHeapProfile(profile);
  if (!retainedInput || typeof retainedInput !== 'object')
    throw new Error('Profiler did not retain a bounded raw input.');
  const rawInputSha256 = createHash('sha256')
    .update(JSON.stringify(retainedInput))
    .digest('hex');
  return {
    ...base,
    profile: retainedInput,
    rawInputSha256,
    recomputation:
      'A bounded normalized CPU or sampled heap profile is retained with fixture paths sanitized so the profile summary can be independently recomputed.',
    mode,
    profileScope:
      'Profile surrounds one actual createImportedGeometryLayer.loadAsync call and its bounded application conversion/publication hooks. It includes profiler control and any browser idle or garbage collection in the window; capture, geometry hashing, native picks and teardown occur after profiler stop. Sampled weights/bytes are diagnostic estimates, not exact costs or acceptance measurements.',
    performanceAcceptanceEligible: false,
  };
}

export function summarizeGeometryGcOverlap({ trace, anchor, startMs, endMs }) {
  if (
    !trace ||
    !Array.isArray(trace.events) ||
    !anchor ||
    typeof anchor.name !== 'string' ||
    !Number.isFinite(anchor.pageNowMs) ||
    !Number.isFinite(anchor.uncertaintyMs) ||
    anchor.uncertaintyMs < 0 ||
    anchor.uncertaintyMs > 2 ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs < startMs
  )
    throw new TypeError('Invalid geometry trace attribution input.');
  const markers = trace.events.filter(
    (event) => event.kind === 'marker' && event.name === anchor.name,
  );
  const marker = markers.length === 1 ? markers[0] : null;
  const gc = trace.events.filter((event) => event.kind === 'gc');
  const traceAccountingComplete =
    Number.isInteger(trace.relevantCount) &&
    Number.isInteger(trace.omittedCount) &&
    trace.relevantCount === trace.events.length + trace.omittedCount &&
    trace.omittedCount === 0 &&
    trace.flowEventCount === 0 &&
    trace.stopError === null &&
    Number.isFinite(trace.bufferUsagePeak) &&
    trace.bufferUsagePeak < 0.95;
  if (
    !marker ||
    !Number.isFinite(marker.tsUs) ||
    !Number.isInteger(marker.pid) ||
    !Number.isInteger(marker.tid)
  )
    return {
      schema: 'gev-import-geometry-gc-overlap/v1',
      complete: false,
      error: markers.length === 0 ? 'missing-anchor' : 'duplicate-anchor',
      performanceAcceptanceEligible: false,
    };
  const offsetUs = marker.tsUs - anchor.pageNowMs * 1000;
  const loadStartUs = offsetUs + startMs * 1000;
  const loadEndUs = offsetUs + endMs * 1000;
  let sameThreadGcOverlapUs = 0;
  let otherThreadGcOverlapUs = 0;
  const sameThreadIntervals = [];
  const otherThreadIntervals = [];
  let sameThreadSlices = 0;
  let otherThreadSlices = 0;
  for (const event of gc) {
    if (
      !Number.isFinite(event.tsUs) ||
      !Number.isFinite(event.durationUs) ||
      event.durationUs < 0 ||
      !Number.isInteger(event.pid) ||
      !Number.isInteger(event.tid)
    )
      continue;
    const overlap = Math.max(
      0,
      Math.min(loadEndUs, event.tsUs + event.durationUs) -
        Math.max(loadStartUs, event.tsUs),
    );
    if (!overlap) continue;
    if (event.pid === marker.pid && event.tid === marker.tid) {
      sameThreadIntervals.push([
        Math.max(loadStartUs, event.tsUs),
        Math.min(loadEndUs, event.tsUs + event.durationUs),
      ]);
      sameThreadSlices++;
    } else {
      otherThreadIntervals.push([
        Math.max(loadStartUs, event.tsUs),
        Math.min(loadEndUs, event.tsUs + event.durationUs),
      ]);
      otherThreadSlices++;
    }
  }
  const unionDuration = (intervals) => {
    intervals.sort((left, right) => left[0] - right[0]);
    let total = 0;
    let start = null;
    let end = null;
    for (const [nextStart, nextEnd] of intervals) {
      if (start === null) {
        start = nextStart;
        end = nextEnd;
      } else if (nextStart <= end) {
        end = Math.max(end, nextEnd);
      } else {
        total += end - start;
        start = nextStart;
        end = nextEnd;
      }
    }
    if (start !== null) total += end - start;
    return total;
  };
  sameThreadGcOverlapUs = unionDuration(sameThreadIntervals);
  otherThreadGcOverlapUs = unionDuration(otherThreadIntervals);
  return {
    schema: 'gev-import-geometry-gc-overlap/v1',
    complete: traceAccountingComplete,
    ...(traceAccountingComplete ? {} : { error: 'trace-data-incomplete' }),
    anchorUncertaintyMs: anchor.uncertaintyMs,
    loadingWindowMs: endMs - startMs,
    gcSlicesObserved: gc.length,
    sameThreadGcSlicesOverlappingLoad: sameThreadSlices,
    otherThreadGcSlicesOverlappingLoad: otherThreadSlices,
    sameThreadGcOverlapMs: sameThreadGcOverlapUs / 1000,
    otherThreadGcOverlapMs: otherThreadGcOverlapUs / 1000,
    instantGcObservations: trace.events.filter(
      (event) => event.kind === 'gc-instant',
    ).length,
    traceOmittedCount: trace.omittedCount,
    bufferUsagePeak: trace.bufferUsagePeak,
    caveat:
      'Time overlap is correlational and does not establish that GC caused a slow load step. A profile window can include idle/control time. Instant GC markers are not pauses; unsupported or omitted trace events make this result incomplete.',
    performanceAcceptanceEligible: false,
  };
}

export function validateImportGeometryLoadProfileReport(report, expected = {}) {
  const errors = [];
  const source = report?.source;
  const fixture = report?.fixture;
  const profile = report?.profile;
  const sample = report?.sample;
  if (report?.schema !== IMPORT_GEOMETRY_LOAD_PROFILE_SCHEMA)
    errors.push('invalid diagnostic schema');
  if (report?.status !== 'passed') errors.push('diagnostic did not pass');
  if (!['cpu', 'heap'].includes(report?.mode))
    errors.push('invalid profile mode');
  if (
    ![
      'whole-feature-timer',
      'chunked-timer',
      'chunked-message-channel',
    ].includes(report?.arm)
  )
    errors.push('invalid geometry arm');
  if (!['LineString', 'Polygon'].includes(report?.geometryType))
    errors.push('invalid geometry type');
  if (
    !COMMIT.test(source?.applicationCommit || '') ||
    source?.applicationCommit !== expected.commit ||
    source?.harnessCommit !== expected.commit ||
    source?.sourceDirtyAtStart !== false ||
    source?.harnessDirtyAtStart !== false ||
    source?.sourceChangedDuringRun !== false ||
    source?.harnessChangedDuringRun !== false ||
    !source?.hashes ||
    !source?.hashesAtFinish ||
    REQUIRED_SOURCE_HASHES.some(
      (key) => !HASH.test(source.hashes[key] || ''),
    ) ||
    Object.keys(source.hashes).length !== REQUIRED_SOURCE_HASHES.length ||
    REQUIRED_SOURCE_HASHES.some(
      (key) => source.hashesAtFinish[key] !== source.hashes[key],
    )
  )
    errors.push('source provenance is incomplete or dirty');
  if (
    !HASH.test(fixture?.runtimeLayerSha256 || '') ||
    !HASH.test(fixture?.fixtureSha256 || '') ||
    !HASH.test(fixture?.runnerSha256 || '') ||
    !HASH.test(fixture?.packageLockSha256 || '') ||
    !HASH.test(fixture?.cesiumEngineSha256 || '') ||
    !HASH.test(fixture?.profileHelperSha256 || '') ||
    !HASH.test(fixture?.cpuHeapHelperSha256 || '') ||
    !HASH.test(fixture?.traceHelperSha256 || '') ||
    !HASH.test(fixture?.traceSummarySha256 || '') ||
    !HASH.test(fixture?.sampledCpuProfileSha256 || '') ||
    !HASH.test(fixture?.rendererEvidenceSha256 || '') ||
    !HASH.test(fixture?.pageOwnershipSha256 || '') ||
    !HASH.test(fixture?.sourceProvenanceSha256 || '')
  )
    errors.push('source hash inventory is incomplete');
  if (
    fixture?.applicationCommit !== expected.commit ||
    fixture?.harnessCommit !== expected.commit ||
    fixture?.geometry !== 's59-50k-line-polygon/v1' ||
    fixture?.profileWindow !==
      'actual-load-async-call-and-runtime-phase-observers' ||
    fixture?.captureAfterProfileStop !== true ||
    fixture?.positionCount !== 50_000 ||
    fixture?.geometrySha256 !== expected.geometrySha256
  )
    errors.push('fixture identity, fidelity or profile separation is invalid');
  if (
    fixture?.geometrySha256 !== expected.geometrySha256 ||
    report?.sample?.geometrySha256 !== expected.geometrySha256
  )
    errors.push('independent fixture geometry identity does not match');
  if (
    !Number.isFinite(fixture?.profileStartedAtMs) ||
    !Number.isFinite(fixture?.loadStartedAtMs) ||
    !Number.isFinite(fixture?.loadCompletedAtMs) ||
    !Number.isFinite(fixture?.profileStoppedAtMs) ||
    fixture.profileStartedAtMs > fixture.loadStartedAtMs ||
    fixture.loadStartedAtMs > fixture.loadCompletedAtMs ||
    fixture.loadCompletedAtMs > fixture.profileStoppedAtMs ||
    !Number.isFinite(fixture?.loadElapsedMs) ||
    fixture.loadElapsedMs <= 0
  )
    errors.push('profile and actual load timestamps are invalid');
  if (
    fixture?.geometryPhaseSummary?.schema !==
      'gev-import-geometry-phase-summary/v1' ||
    !Number.isInteger(fixture.geometryPhaseSummary.eventCount) ||
    fixture.geometryPhaseSummary.eventCount < 1 ||
    fixture.geometryPhaseSummary.eventCount > MAX_PHASE_EVENTS ||
    fixture.geometryPhaseSummary.invalidCount !== 0 ||
    !fixture.geometryPhaseSummary.phases ||
    Object.keys(fixture.geometryPhaseSummary.phases).length !==
      IMPORT_GEOMETRY_LOAD_PROFILE_PHASES.length
  )
    errors.push('bounded runtime phase summary is incomplete');
  for (const [name, phase] of Object.entries(
    fixture?.geometryPhaseSummary?.phases || {},
  )) {
    if (
      !ALLOWED_PHASES.has(name) ||
      !Number.isInteger(phase?.count) ||
      phase.count < 0 ||
      !Number.isFinite(phase?.totalMs) ||
      phase.totalMs < 0 ||
      !Number.isFinite(phase?.maxMs) ||
      phase.maxMs < 0 ||
      !Number.isInteger(phase?.over4Ms) ||
      phase.over4Ms < 0 ||
      phase.over4Ms > phase.count
    )
      errors.push('runtime phase summary contains invalid values');
  }
  if (
    sample?.capture?.completed !== true ||
    !HASH.test(sample?.pixelSha256 || '') ||
    sample?.geometrySha256 !== fixture?.geometrySha256 ||
    sample?.positionCount !== 50_000 ||
    sample?.readiness?.pickedEntityId !== sample?.entityId ||
    sample?.cleanup?.featureCount !== 0 ||
    sample?.cleanup?.pendingJobs !== 0 ||
    sample?.cleanup?.schedulerPendingCount !== 0
  )
    errors.push('post-profile fidelity or cleanup witness is invalid');
  if (
    profile?.mode !== report?.mode ||
    profile?.performanceAcceptanceEligible !== false ||
    profile?.trace?.complete !== true ||
    !Number.isFinite(profile?.profileWindowMs) ||
    profile.profileWindowMs <= 0 ||
    !Number.isFinite(profile?.trace?.sameThreadGcOverlapMs) ||
    profile.trace.sameThreadGcOverlapMs < 0 ||
    !Number.isFinite(profile?.trace?.otherThreadGcOverlapMs) ||
    profile.trace.otherThreadGcOverlapMs < 0 ||
    !HASH.test(profile?.rawInputSha256 || '') ||
    !profile?.profile ||
    createHash('sha256')
      .update(JSON.stringify(profile.profile))
      .digest('hex') !== profile.rawInputSha256 ||
    !HASH.test(profile?.traceInputSha256 || '') ||
    !profile?.traceInput ||
    createHash('sha256')
      .update(JSON.stringify(profile.traceInput))
      .digest('hex') !== profile.traceInputSha256
  )
    errors.push('sampled profiler or trace diagnostic is incomplete');
  if (profile?.mode === 'cpu' && profile?.profile) {
    try {
      const recomputed = summarizeCpuProfile(profile.profile);
      for (const key of [
        'profileWindowMs',
        'totalSampleWeightMs',
        'nodeCount',
        'sampleCount',
        'groupedLocations',
        'omittedLocations',
      ]) {
        if (recomputed[key] !== profile[key])
          errors.push('CPU profile summary does not match retained raw input');
      }
      if (
        JSON.stringify(recomputed.topLocations) !==
        JSON.stringify(profile.topLocations)
      )
        errors.push('CPU ranked locations do not match retained raw input');
    } catch {
      errors.push('retained CPU profile input cannot be summarized');
    }
  } else if (profile?.mode === 'heap' && profile?.profile) {
    try {
      const recomputed = summarizeImportHeapProfile(profile.profile);
      for (const key of [
        'nodeCount',
        'sampleCount',
        'sampledAllocationBytes',
        'groupedLocations',
        'omittedLocations',
        'truncated',
      ]) {
        if (recomputed[key] !== profile[key])
          errors.push('heap profile summary does not match retained raw input');
      }
      if (
        JSON.stringify(recomputed.topLocations) !==
        JSON.stringify(profile.topLocations)
      )
        errors.push('heap ranked locations do not match retained raw input');
    } catch {
      errors.push('retained heap profile input cannot be summarized');
    }
  }
  if (profile?.traceInput && fixture?.anchor) {
    try {
      const recomputedTrace = summarizeGeometryGcOverlap({
        trace: profile.traceInput,
        anchor: fixture.anchor,
        startMs: fixture.loadStartedAtMs,
        endMs: fixture.loadCompletedAtMs,
      });
      for (const key of [
        'complete',
        'loadingWindowMs',
        'gcSlicesObserved',
        'sameThreadGcSlicesOverlappingLoad',
        'otherThreadGcSlicesOverlappingLoad',
        'sameThreadGcOverlapMs',
        'otherThreadGcOverlapMs',
        'instantGcObservations',
        'traceOmittedCount',
        'bufferUsagePeak',
      ]) {
        if (recomputedTrace[key] !== profile.trace[key])
          errors.push('GC overlap summary does not match retained trace input');
      }
    } catch {
      errors.push('retained trace input cannot be summarized');
    }
  } else {
    errors.push('trace input or load anchor is missing');
  }
  if (
    report?.pageErrors?.length ||
    report?.cleanupError ||
    report?.profileCleanupError ||
    report?.traceCleanupError ||
    report?.pageCleanup?.closeCompleted !== true ||
    report?.pageCleanup?.openPageCount !== 0 ||
    report?.browserCleanup?.closeCompleted !== true ||
    report?.browserCleanup?.forcedProcessTermination !== false ||
    report?.serverCleanup?.confirmed !== true
  )
    errors.push('page or resource cleanup failed');
  if (
    !report?.environment?.host?.hosted ||
    !Number.isInteger(report?.environment?.host?.logicalCpus) ||
    report?.environment?.host?.logicalCpus < 1 ||
    !report?.environment?.scene?.renderer ||
    report?.environment?.scene?.contextLost !== false ||
    !report?.environment?.graphics?.featureStatus ||
    !['native-gpu', 'apple-paravirtual-metal', 'software', 'unknown'].includes(
      report?.environment?.rendererClassification?.kind,
    )
  )
    errors.push('observed host or renderer environment is incomplete');
  return { valid: errors.length === 0, errors };
}
