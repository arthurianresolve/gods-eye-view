import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { validatePairedPerformanceReports } from './pairedReport.mjs';
import { evaluateSoakStability, FULL_SOAK_MS } from './soakStability.mjs';

export const REQUIRED_PERFORMANCE_WORKLOADS = Object.freeze([
  'operating-view',
  'dense-investigation',
  'selected-aircraft-tracking',
  'infrastructure',
  'weather-effects',
  'lifecycle-stress',
  'map-streaming',
]);

const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const RETENTION_FINAL_CHECKPOINT_TOLERANCE_MS = 1000;

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim())
    throw new TypeError(`${label} is required.`);
  return value.trim();
}

function readBoundArtifact(manifestPath, reference, label) {
  const relativePath = requiredText(reference?.path, `${label} path`);
  const expectedHash = String(reference?.sha256 || '').toLowerCase();
  if (!SHA256.test(expectedHash))
    throw new TypeError(`${label} requires a SHA-256 digest.`);
  if (path.isAbsolute(relativePath) || /^https?:\/\//i.test(relativePath))
    throw new TypeError(`${label} must be a local relative artifact path.`);
  const resolvedPath = path.resolve(path.dirname(manifestPath), relativePath);
  const size = statSync(resolvedPath).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ARTIFACT_BYTES)
    throw new RangeError(`${label} size is outside the accepted bound.`);
  const bytes = readFileSync(resolvedPath);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (actualHash !== expectedHash)
    throw new Error(`${label} SHA-256 does not match its manifest digest.`);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON: ${error.message}`);
  }
  return { value, digest: actualHash, path: relativePath };
}

export function classifyRecordedRenderer(report) {
  const renderer = String(
    report?.environment?.renderer ||
      report?.renderer?.renderer ||
      report?.renderer ||
      '',
  );
  const graphics = report?.graphics || null;
  const hostEnvironment = report?.hostEnvironment || report?.environment || {};
  const hosted = hostEnvironment.hosted;
  const hostIdentityComplete =
    typeof hostEnvironment.cpu === 'string' &&
    hostEnvironment.cpu.trim() !== '' &&
    typeof hostEnvironment.osRelease === 'string' &&
    hostEnvironment.osRelease.trim() !== '' &&
    typeof hostEnvironment.architecture === 'string' &&
    hostEnvironment.architecture.trim() !== '' &&
    Number.isFinite(hostEnvironment.memoryBytes) &&
    hostEnvironment.memoryBytes > 0;
  const software =
    /swiftshader|software|llvmpipe|softpipe|basic render|warp/i.test(renderer);
  const appleVirtual = /ANGLE Metal Renderer: Apple Paravirtual device/i.test(
    renderer,
  );
  const native =
    /Intel|NVIDIA|AMD|Apple|Radeon/i.test(renderer) &&
    !/virtual/i.test(renderer);
  const enabled =
    graphics?.featureStatus?.webgl === 'enabled' &&
    (graphics.featureStatus.webgl2 == null ||
      graphics.featureStatus.webgl2 === 'enabled');
  const kind = software
    ? 'software'
    : appleVirtual
      ? 'apple-paravirtual-metal'
      : native
        ? 'native-gpu'
        : 'unknown';
  return {
    kind,
    renderer: renderer || null,
    accelerationVerified: !software && (native || appleVirtual) && enabled,
    physicalDesktopCoverage:
      typeof hosted === 'boolean'
        ? !hosted && !software && native && enabled && hostIdentityComplete
        : null,
    hosted: typeof hosted === 'boolean' ? hosted : null,
    hostIdentityComplete,
  };
}

function requireEnvironmentMatch(baseline, candidate, environmentId) {
  const left = classifyRecordedRenderer(baseline);
  const right = classifyRecordedRenderer(candidate);
  if (left.kind !== right.kind || left.renderer !== right.renderer)
    throw new Error(
      `${environmentId}: renderer changed between paired reports.`,
    );
  const leftEnvironment =
    baseline.hostEnvironment || baseline.environment || {};
  const rightEnvironment =
    candidate.hostEnvironment || candidate.environment || {};
  for (const field of [
    'platform',
    'hosted',
    'architecture',
    'osRelease',
    'cpu',
    'memoryBytes',
  ]) {
    if (
      leftEnvironment[field] != null &&
      rightEnvironment[field] != null &&
      leftEnvironment[field] !== rightEnvironment[field]
    )
      throw new Error(
        `${environmentId}: recorded ${field} changed between reports.`,
      );
  }
  if (
    baseline.environment?.platform != null &&
    candidate.environment?.platform != null &&
    baseline.environment.platform !== candidate.environment.platform
  )
    throw new Error(
      `${environmentId}: browser platform changed between reports.`,
    );
  if (
    recordedEnvironmentIdentity(baseline) !==
    recordedEnvironmentIdentity(candidate)
  )
    throw new Error(
      `${environmentId}: recorded machine/browser/GPU identity changed between reports.`,
    );
  return right;
}

function recordedEnvironmentIdentity(report) {
  const environment = report?.environment || {};
  const host = report?.hostEnvironment || report?.environment || {};
  const browser = report?.comparisonContract?.browser || {};
  return JSON.stringify({
    platform: host.platform ?? null,
    browserPlatform: environment.platform ?? null,
    architecture: host.architecture ?? null,
    osRelease: host.osRelease ?? null,
    cpu: host.cpu ?? null,
    memoryBytes: host.memoryBytes ?? null,
    hosted: host.hosted ?? null,
    runnerImage: host.runnerImage ?? null,
    runnerImageVersion: host.runnerImageVersion ?? null,
    browserName: browser.name ?? null,
    browserVersion: browser.version ?? null,
    renderer: environment.renderer ?? report?.renderer ?? null,
    vendor: environment.vendor ?? null,
    graphics: report?.graphics ?? null,
    viewport: environment.viewport ?? null,
    drawingBuffer: environment.drawingBuffer ?? null,
  });
}

function comparisonRows(evidence, manifestPath, candidateCommit) {
  if (
    evidence != null &&
    (typeof evidence !== 'object' || Array.isArray(evidence))
  )
    throw new TypeError('performanceEvidence must be an object.');
  const rows = evidence?.comparisons ?? [];
  if (!Array.isArray(rows))
    throw new TypeError('performanceEvidence.comparisons must be an array.');
  if (rows.length > 64)
    throw new RangeError('Too many paired comparison rows.');
  const seen = new Set();
  const identitiesByEnvironment = new Map();
  return rows.map((row, index) => {
    const environmentId = requiredText(
      row?.environmentId,
      `comparison ${index + 1} environmentId`,
    );
    if (!SHA1.test(row?.baselineCommit || ''))
      throw new TypeError(
        `${environmentId}: baselineCommit must be a full SHA.`,
      );
    const baselineArtifact = readBoundArtifact(
      manifestPath,
      row.baseline,
      `${environmentId} baseline report`,
    );
    const candidateArtifact = readBoundArtifact(
      manifestPath,
      row.candidate,
      `${environmentId} candidate report`,
    );
    const workloadId = requiredText(
      baselineArtifact.value?.comparisonContract?.workloadId,
      `${environmentId} workloadId`,
    );
    if (candidateArtifact.value?.comparisonContract?.workloadId !== workloadId)
      throw new Error(`${environmentId}: paired workload identifiers differ.`);
    const key = `${environmentId}\0${workloadId}`;
    if (seen.has(key))
      throw new Error(
        `Duplicate comparison role: ${environmentId}/${workloadId}.`,
      );
    seen.add(key);
    let result;
    let error = null;
    let renderer = null;
    let environmentIdentity = null;
    try {
      renderer = requireEnvironmentMatch(
        baselineArtifact.value,
        candidateArtifact.value,
        environmentId,
      );
      environmentIdentity = recordedEnvironmentIdentity(
        candidateArtifact.value,
      );
      const priorIdentity = identitiesByEnvironment.get(environmentId);
      if (priorIdentity != null && priorIdentity !== environmentIdentity)
        throw new Error(
          `${environmentId}: recorded host/GPU identity changed across workloads.`,
        );
      identitiesByEnvironment.set(environmentId, environmentIdentity);
      result = validatePairedPerformanceReports({
        baseline: baselineArtifact.value,
        candidate: candidateArtifact.value,
        expectedAppCommits: {
          baseline: row.baselineCommit,
          candidate: candidateCommit,
        },
      });
    } catch (caught) {
      error = String(caught?.message || caught).slice(0, 500);
    }
    return {
      environmentId,
      workloadId,
      baselineCommit: row.baselineCommit,
      candidateCommit,
      platform: candidateArtifact.value?.environment?.platform || null,
      hostPlatform:
        (
          candidateArtifact.value?.hostEnvironment ||
          candidateArtifact.value?.environment
        )?.platform || null,
      baselineArtifact: {
        path: baselineArtifact.path,
        sha256: baselineArtifact.digest,
      },
      candidateArtifact: {
        path: candidateArtifact.path,
        sha256: candidateArtifact.digest,
      },
      renderer,
      environmentIdentity,
      validation: result || null,
      error,
    };
  });
}

function validateRetentionReport(report, candidateCommit, environmentId) {
  const errors = [];
  const pending = [];
  if (!report?.candidateCommit)
    pending.push('Raw soak candidateCommit is unavailable.');
  else if (report.candidateCommit !== candidateCommit)
    errors.push('Raw soak candidateCommit does not match the candidate.');
  if (report?.operationStatus === 'failed')
    errors.push('Raw soak operation did not pass.');
  else if (report?.operationStatus !== 'passed')
    pending.push('Raw soak operation did not reach a completed status.');
  for (const field of [
    'iterations',
    'sourceToggles',
    'replaySeeks',
    'imports',
    'workspaceReloads',
    'archiveFailures',
    'cameraRecoveries',
  ]) {
    if (report?.[field] == null)
      pending.push(`Raw soak completed ${field} count is unavailable.`);
    else if (!Number.isSafeInteger(report[field]) || report[field] < 1)
      errors.push(`Raw soak completed ${field} count is invalid.`);
  }
  if (report?.fullSoak !== true || !(report?.durationMs >= FULL_SOAK_MS))
    pending.push('Raw soak did not complete the declared 60-minute duration.');
  if (report?.scope == null) pending.push('Raw soak scope is unavailable.');
  else if (report.scope !== 'rendered-application-fixtures')
    pending.push('Raw soak scope is not an application retention run.');
  if (report?.applicationCommit == null)
    pending.push('Raw soak applicationCommit is unavailable.');
  else if (report.applicationCommit !== candidateCommit)
    errors.push('Raw soak applicationCommit does not match the candidate.');
  if (report?.harnessCommit == null)
    pending.push('Raw soak harnessCommit is unavailable.');
  else if (report.harnessCommit !== candidateCommit)
    errors.push('Raw soak harnessCommit does not match the candidate.');
  if (
    report?.sourceDirtyAtStart === true ||
    report?.sourceChangedDuringRun === true ||
    report?.harnessDirtyAtStart === true ||
    report?.harnessChangedDuringRun === true
  )
    errors.push('Raw soak source was dirty or changed during the run.');
  else if (
    report?.sourceDirtyAtStart !== false ||
    report?.sourceChangedDuringRun !== false ||
    report?.harnessDirtyAtStart !== false ||
    report?.harnessChangedDuringRun !== false
  )
    pending.push('Raw soak source cleanliness is unavailable.');
  if (!Number.isFinite(report?.durationMs) || report.durationMs < 0)
    errors.push('Raw soak duration is invalid.');
  if (!Array.isArray(report?.checkpoints))
    errors.push('Raw soak checkpoints are malformed.');
  const checkpoints = Array.isArray(report?.checkpoints)
    ? report.checkpoints
    : [];
  let previous = -1;
  for (const [index, checkpoint] of checkpoints.entries()) {
    const elapsed = checkpoint?.elapsedMs;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed <= previous) {
      errors.push(
        'Raw soak checkpoint times must be finite and strictly increasing.',
      );
      break;
    }
    previous = elapsed;
    if (elapsed > report.durationMs) {
      errors.push('Raw soak checkpoint exceeds the measured duration.');
      break;
    }
    if (
      checkpoint?.metrics?.garbageCollection?.status !== 'completed' ||
      checkpoint?.metrics?.garbageCollection?.method !==
        'HeapProfiler.collectGarbage'
    )
      pending.push(`Post-GC provenance is missing at checkpoint ${index}.`);
  }
  if (checkpoints.length && checkpoints[0]?.elapsedMs !== 0)
    errors.push('Raw soak must include its warmed zero-time baseline.');
  const retentionComplete =
    report?.fullSoak === true && report.durationMs >= FULL_SOAK_MS;
  if (!retentionComplete)
    pending.push('Raw soak did not complete the declared 60-minute duration.');
  else if (
    checkpoints.length < 4 ||
    Math.abs(report.durationMs - checkpoints.at(-1)?.elapsedMs) >
      RETENTION_FINAL_CHECKPOINT_TOLERANCE_MS
  )
    pending.push(
      'Raw soak final checkpoint is not within one second of the measured duration.',
    );
  const stability = evaluateSoakStability({
    ...report,
    checkpoints: checkpoints.filter(
      (point) =>
        point && typeof point === 'object' && Number.isFinite(point.elapsedMs),
    ),
  });
  if (stability.status === 'failed') errors.push(...stability.failures);
  const renderer = classifyRecordedRenderer(report);
  const primaryEligible =
    renderer.kind === 'native-gpu' &&
    renderer.accelerationVerified === true &&
    renderer.physicalDesktopCoverage === true &&
    report?.environment?.platform === 'win32';
  return {
    environmentId,
    candidateCommit,
    renderer,
    primaryEligible,
    stability,
    errors: [...new Set(errors)],
    pending: [...new Set(pending)],
    status:
      errors.length || stability.status === 'failed'
        ? 'failed'
        : pending.length || stability.status === 'pending'
          ? 'pending'
          : 'passed',
  };
}

function retentionRows(evidence, manifestPath, candidateCommit) {
  if (
    evidence != null &&
    (typeof evidence !== 'object' || Array.isArray(evidence))
  )
    throw new TypeError('performanceEvidence must be an object.');
  const rows = evidence?.retention ?? [];
  if (!Array.isArray(rows))
    throw new TypeError('performanceEvidence.retention must be an array.');
  if (rows.length > 32) throw new RangeError('Too many retention report rows.');
  const seen = new Set();
  return rows.map((row, index) => {
    const environmentId = requiredText(
      row?.environmentId,
      `retention ${index + 1} environmentId`,
    );
    if (seen.has(environmentId))
      throw new Error(`Duplicate retention environment: ${environmentId}.`);
    seen.add(environmentId);
    const artifact = readBoundArtifact(
      manifestPath,
      row.report,
      `${environmentId} soak report`,
    );
    return {
      ...validateRetentionReport(
        artifact.value,
        candidateCommit,
        environmentId,
      ),
      artifact: { path: artifact.path, sha256: artifact.digest },
    };
  });
}

function comparisonOutcome(rows) {
  const primaryWindows = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.renderer?.kind === 'native-gpu' &&
            row.renderer?.accelerationVerified === true &&
            row.renderer?.physicalDesktopCoverage === true &&
            row.hostPlatform === 'win32' &&
            row.platform === 'Win32',
        )
        .map((row) => row.environmentId),
    ),
  ].sort();
  // Capture reports record navigator.platform in `platform`; the paired result
  // also contains the original report environments below when available.
  const primaryEnvironmentId =
    primaryWindows.length === 1 ? primaryWindows[0] : null;
  const eligibleRows = rows.filter(
    (row) => row.environmentId === primaryEnvironmentId && !row.error,
  );
  const canonicalWorkload = (id) =>
    id === 'infrastructure-only' ? 'infrastructure' : id;
  const workloadIds = new Set(
    eligibleRows.map((row) => canonicalWorkload(row.workloadId)),
  );
  const denseRow = eligibleRows.find(
    (row) => row.workloadId === 'dense-investigation',
  );
  if (
    denseRow?.validation?.denseTrackingObjective?.status === 'assessed' &&
    denseRow.validation.denseTrackingObjective.achieved === true
  )
    workloadIds.add('selected-aircraft-tracking');
  const missingWorkloads = REQUIRED_PERFORMANCE_WORKLOADS.filter(
    (id) => !workloadIds.has(id),
  );
  const failures = [];
  const pending = [];
  if (!primaryEnvironmentId)
    pending.push(
      primaryWindows.length > 1
        ? 'Multiple physical Windows comparison environments are present; coverage cannot be combined without a single primary environment.'
        : 'No verified physical Windows comparison environment is recorded.',
    );
  for (const row of rows) {
    if (row.error) {
      failures.push(`${row.environmentId}/${row.workloadId}: ${row.error}`);
      continue;
    }
    const validation = row.validation;
    if (!validation || validation.status !== 'comparable') {
      failures.push(
        `${row.environmentId}/${row.workloadId}: comparison did not validate.`,
      );
      continue;
    }
    if (
      row.environmentId !== primaryEnvironmentId ||
      row.renderer?.kind !== 'native-gpu' ||
      row.renderer?.accelerationVerified !== true ||
      row.renderer?.physicalDesktopCoverage !== true
    ) {
      continue;
    }
    if (validation.regressionsOver10Pct.length)
      failures.push(
        `${row.environmentId}/${row.workloadId}: regression over 10% in ${validation.regressionsOver10Pct.join(', ')}.`,
      );
    if (row.workloadId === 'dense-investigation') {
      for (const objective of [
        validation.workloadObjective,
        validation.denseTrackingObjective,
      ]) {
        if (objective?.status !== 'assessed' || objective?.achieved == null)
          pending.push(
            'Dense motion/tracking 20% objective is not fully assessed.',
          );
        else if (objective.achieved !== true)
          failures.push(
            'Dense investigation and selected tracking must achieve the 20% objective.',
          );
      }
    }
  }
  if (missingWorkloads.length)
    pending.push(
      `Required comparison workloads missing: ${missingWorkloads.join(', ')}.`,
    );
  if (!rows.length)
    pending.push('No raw paired comparison reports were supplied.');
  return {
    status: failures.length ? 'failed' : pending.length ? 'pending' : 'passed',
    failures: [...new Set(failures)],
    pending: [...new Set(pending)],
    missingWorkloads,
    workloadIds: [...workloadIds].sort(),
    environments: rows.map((row) => ({
      environmentId: row.environmentId,
      workloadId: row.workloadId,
      status: row.error
        ? 'failed'
        : row.environmentId !== primaryEnvironmentId ||
            row.renderer?.kind !== 'native-gpu' ||
            row.renderer?.physicalDesktopCoverage !== true
          ? 'supplemental'
          : row.validation?.status === 'comparable'
            ? 'measured'
            : 'failed',
      renderer: row.renderer,
      reason:
        row.error ||
        (row.environmentId !== primaryEnvironmentId ||
        row.renderer?.kind !== 'native-gpu' ||
        row.renderer?.physicalDesktopCoverage !== true
          ? 'Supplemental renderer evidence; not part of primary Windows acceptance.'
          : null),
    })),
  };
}

function retentionOutcome(rows) {
  const primaryRows = rows.filter((row) => row.primaryEligible);
  const failures = rows.flatMap((row) =>
    row.errors.map((message) => `${row.environmentId}: ${message}`),
  );
  const pending = primaryRows
    .filter((row) => row.status === 'pending')
    .flatMap((row) => [
      `${row.environmentId}: ${row.stability.pending.join(' ')}`,
      ...row.pending.map((message) => `${row.environmentId}: ${message}`),
    ]);
  if (!rows.length) pending.push('No raw retention report was supplied.');
  if (!primaryRows.length)
    pending.push(
      'No verified physical Windows native-GPU retention run was supplied.',
    );
  return {
    status: failures.length ? 'failed' : pending.length ? 'pending' : 'passed',
    failures: [...new Set(failures)],
    pending: [...new Set(pending)],
    environments: rows.map((row) => ({
      environmentId: row.environmentId,
      status:
        row.status === 'failed'
          ? 'failed'
          : row.primaryEligible
            ? row.status
            : 'supplemental',
      primaryEligible: row.primaryEligible,
      renderer: row.renderer,
      artifact: row.artifact,
      stability: row.stability,
      errors: row.errors,
      pending: row.pending,
      reason: row.primaryEligible
        ? null
        : 'Supplemental retention evidence; physical Windows native-GPU evidence is required for acceptance.',
    })),
  };
}

export function evaluateManifestPerformanceEvidence(
  evidence,
  { manifestPath, candidateCommit },
) {
  if (!manifestPath) throw new TypeError('Manifest path is required.');
  if (!SHA1.test(candidateCommit || ''))
    throw new TypeError('Performance evidence requires a full candidate SHA.');
  const comparisons = comparisonRows(evidence, manifestPath, candidateCommit);
  const retention = retentionRows(evidence, manifestPath, candidateCommit);
  return {
    comparisons,
    retention,
    comparison: comparisonOutcome(comparisons),
    retentionOutcome: retentionOutcome(retention),
  };
}
