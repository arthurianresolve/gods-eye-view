import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareImportPointRepresentationReports } from './importPointRepresentationComparison.mjs';
import { stopOwnedRecoveryProcessTree } from './profileRecoveryPageOwnership.mjs';

const SCHEMA = 'gev-import-point-representation-benefit/v1';
const EXPECTED_ORDER = [
  ['entity', 'primitive-collection'],
  ['primitive-collection', 'entity'],
];
const OUTER_PAIR_COUNT = 5;
const CHILD_TIMEOUT_MS = 240_000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fixtureOf(run) {
  return run?.importBatches || null;
}

function metricForMode(fixture, mode) {
  const samples = fixture?.samples?.filter((sample) => sample?.mode === mode);
  if (
    !Array.isArray(samples) ||
    samples.length !== 5 ||
    samples.some(
      (sample) =>
        !Number.isFinite(sample?.elapsedMs) ||
        sample.elapsedMs <= 0 ||
        !Number.isFinite(sample?.clearCallElapsedMs) ||
        sample.clearCallElapsedMs < 0 ||
        !Number.isFinite(sample?.resetDrainElapsedMs) ||
        sample.resetDrainElapsedMs <= 0 ||
        !Number.isFinite(sample?.clearAndDrainElapsedMs) ||
        sample.clearAndDrainElapsedMs <= 0 ||
        !Number.isFinite(sample?.captureElapsedMs) ||
        sample.captureElapsedMs <= 0 ||
        !Number.isFinite(sample?.maxHeartbeatGapMs) ||
        sample.maxHeartbeatGapMs < 0 ||
        sample?.features !== 5000 ||
        sample?.resources?.importedFeatureCount !== 5000 ||
        sample?.resources?.pointPrimitiveCount !== 5000 ||
        !Number.isFinite(sample?.resourcesAfterClear?.pointPrimitiveCount) ||
        sample.resourcesAfterClear.pointPrimitiveCount < 0 ||
        sample?.resourcesAfterClear?.importedFeatureCount !== 0,
    )
  )
    return null;
  if (
    fixture.pointRepresentation === 'entity' &&
    samples.some(
      (sample) =>
        sample.resourcesAfterClear?.entityPointCensus?.available !== true ||
        sample.resourcesAfterClear.pointPrimitiveCount !== 5000 ||
        sample.resourcesAfterClear.entityPointCensus.pointCount !== 5000 ||
        sample.resourcesAfterClear.entityPointCensus.activeEntityCount !== 0,
    )
  )
    return null;
  if (
    fixture.pointRepresentation === 'primitive-collection' &&
    samples.some(
      (sample) => sample.resourcesAfterClear.pointPrimitiveCount !== 0,
    )
  )
    return null;
  let cooperativeBatch = null;
  if (mode === 'cooperative') {
    const attribution = samples.map(
      (sample) => sample?.cooperativeBatchMetrics,
    );
    const unavailableReason =
      'The production cooperative loader exposes no batch-completion observer; no batch duration or wake values are inferred.';
    if (
      attribution.some(
        (item) =>
          item?.available !== false || item?.reason !== unavailableReason,
      )
    )
      return null;
    cooperativeBatch = { available: false, reason: unavailableReason };
  }
  return {
    loadMs: median(samples.map((sample) => sample.elapsedMs)),
    clearCallMs: median(samples.map((sample) => sample.clearCallElapsedMs)),
    resetDrainMs: median(samples.map((sample) => sample.resetDrainElapsedMs)),
    clearAndDrainMs: median(
      samples.map((sample) => sample.clearAndDrainElapsedMs),
    ),
    captureMs: median(samples.map((sample) => sample.captureElapsedMs)),
    maximumHeartbeatGapMs: median(
      samples.map((sample) => sample.maxHeartbeatGapMs),
    ),
    cooperativeBatch,
    loadedPointPrimitives: median(
      samples.map((sample) => sample.resources.pointPrimitiveCount),
    ),
    clearedPointPrimitives: median(
      samples.map((sample) => sample.resourcesAfterClear.pointPrimitiveCount),
    ),
  };
}

function summarizeRun(run) {
  const fixture = fixtureOf(run);
  const allSamples = fixture?.samples;
  const clearedCounts = Array.isArray(allSamples)
    ? allSamples.map(
        (sample) => sample?.resourcesAfterClear?.pointPrimitiveCount,
      )
    : [];
  if (
    !Number.isFinite(fixture?.coldActivationMs) ||
    fixture.coldActivationMs <= 0 ||
    fixture?.pointBenefitDiagnosticsRequested !== true ||
    fixture?.performanceAcceptanceEligible !== false ||
    clearedCounts.length !== 10 ||
    clearedCounts.some((count) => !Number.isFinite(count) || count < 0) ||
    new Set(clearedCounts).size !== 1
  )
    return null;
  const synchronous = metricForMode(fixture, 'synchronous');
  const cooperative = metricForMode(fixture, 'cooperative');
  if (!synchronous || !cooperative) return null;
  return {
    pointRepresentation: fixture.pointRepresentation,
    coldActivationMs: fixture.coldActivationMs,
    synchronous,
    cooperative,
  };
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function runSha(run) {
  if (!run || typeof run !== 'object') return null;
  const serialized = JSON.stringify(run);
  return typeof serialized === 'string' ? sha256(serialized) : null;
}

export function buildImportPointRepresentationBenefitReport({
  applicationCommit,
  harnessCommit,
  packageLockSha256,
  nodeVersion,
  pairs,
  createdAt = new Date().toISOString(),
}) {
  const report = {
    schema: SCHEMA,
    status: 'passed',
    protocol: {
      pairs: OUTER_PAIR_COUNT,
      freshBrowserPerRun: true,
      order: 'entity/collection on even pairs; collection/entity on odd pairs',
      samplesPerRun: { synchronous: 5, cooperative: 5 },
      noForcedGc: true,
      hardwareScope:
        'verified hosted renderer only; not physical desktop acceptance',
      performanceAcceptanceEligible: false,
      metricsScope:
        'Per-run cold activation, synchronous/cooperative load, clear call, reset/drain, capture, heartbeat gap and live point resource counts are separate. Cooperative batch durations and wake timing are unavailable from this production runtime. No forced GC or GPU timing; nested samples are summarized within each fresh run before the five outer pairs are compared.',
    },
    provenance: {
      applicationCommit,
      harnessCommit,
      packageLockSha256,
      nodeVersion,
    },
    createdAt,
    pairs,
    summary: null,
  };
  const validation = validateImportPointRepresentationBenefitReport(report, {
    expectedCommit: applicationCommit,
  });
  report.validation = validation;
  report.summary = validation.summary;
  if (!validation.valid) report.status = 'failed';
  return report;
}

export function validateImportPointRepresentationBenefitReport(
  report,
  {
    expectedCommit,
    compareReports = compareImportPointRepresentationReports,
  } = {},
) {
  const errors = [];
  const add = (valid, message) => {
    if (!valid) errors.push(message);
  };
  add(report?.schema === SCHEMA, 'benefit report schema is invalid');
  add(report?.status === 'passed', 'benefit report did not pass');
  add(
    report?.protocol?.pairs === 5 &&
      report.protocol.freshBrowserPerRun === true &&
      report.protocol.noForcedGc === true &&
      report.protocol.performanceAcceptanceEligible === false,
    'benefit protocol or scope is incomplete',
  );
  add(
    Array.isArray(report?.pairs) && report.pairs.length === 5,
    'benefit report must contain five outer pairs',
  );
  add(
    typeof report?.provenance?.applicationCommit === 'string' &&
      /^[a-f0-9]{40}$/.test(report.provenance.applicationCommit) &&
      report.provenance.harnessCommit === report.provenance.applicationCommit &&
      isSha(report.provenance.packageLockSha256) &&
      typeof report.provenance.nodeVersion === 'string' &&
      report.provenance.nodeVersion.startsWith('v'),
    'benefit provenance is incomplete',
  );
  if (expectedCommit)
    add(
      report?.provenance?.applicationCommit === expectedCommit &&
        report?.provenance?.harnessCommit === expectedCommit,
      'benefit report does not match the requested immutable commit',
    );
  add(
    Array.isArray(report?.pairs) && report.pairs.length === 5,
    'benefit pair inventory is missing',
  );

  const normalizedConfigurations = [];
  const environments = [];
  const pairMetrics = [];
  for (let index = 0; index < (report?.pairs?.length || 0); index++) {
    const pair = report.pairs[index];
    const expectedOrder = EXPECTED_ORDER[index % 2];
    add(
      pair?.pair === index &&
        JSON.stringify(pair?.executionOrder) === JSON.stringify(expectedOrder),
      `pair ${index} did not use the required alternating order`,
    );
    const entityRun = pair?.entityRun;
    const collectionRun = pair?.collectionRun;
    add(
      isSha(pair?.entityReportSha256) &&
        pair.entityReportSha256 === runSha(entityRun),
      `pair ${index} Entity report hash is missing or stale`,
    );
    add(
      isSha(pair?.collectionReportSha256) &&
        pair.collectionReportSha256 === runSha(collectionRun),
      `pair ${index} collection report hash is missing or stale`,
    );
    let parity;
    try {
      parity = compareReports(entityRun, collectionRun);
    } catch (error) {
      parity = {
        valid: false,
        errors: [`comparison rejected malformed nested report: ${error}`],
      };
    }
    add(
      parity.valid,
      `pair ${index} parity failed: ${parity.errors.join('; ')}`,
    );
    const entityFixture = fixtureOf(entityRun);
    const collectionFixture = fixtureOf(collectionRun);
    const nestedCommit =
      expectedCommit || report?.provenance?.applicationCommit;
    for (const [nestedRun, nestedFixture, label] of [
      [entityRun, entityFixture, 'Entity'],
      [collectionRun, collectionFixture, 'collection'],
    ]) {
      add(
        nestedRun?.commit === nestedCommit &&
          nestedFixture?.applicationCommit === nestedCommit &&
          nestedFixture?.harnessCommit === nestedCommit &&
          nestedFixture?.environment?.appCommit === nestedCommit &&
          nestedFixture?.environment?.harnessCommit === nestedCommit &&
          nestedRun?.captureMatrix?.applicationCommit === nestedCommit &&
          nestedRun?.captureMatrix?.harnessCommit === nestedCommit,
        `pair ${index} ${label} nested source identities do not match immutable provenance`,
      );
    }
    add(
      entityFixture?.pointBenefitDiagnosticsRequested === true &&
        collectionFixture?.pointBenefitDiagnosticsRequested === true,
      `pair ${index} lacks benefit-only instrumentation`,
    );
    const entityMetrics = summarizeRun(entityRun);
    const collectionMetrics = summarizeRun(collectionRun);
    add(
      Boolean(entityMetrics && collectionMetrics),
      `pair ${index} has incomplete load/clear/capture timing or live-resource observations`,
    );
    if (!entityMetrics || !collectionMetrics) continue;
    normalizedConfigurations.push(
      JSON.stringify({
        ...entityFixture.renderConfiguration,
        pointRepresentation: '<renderer-mode>',
      }),
      JSON.stringify({
        ...collectionFixture.renderConfiguration,
        pointRepresentation: '<renderer-mode>',
      }),
    );
    environments.push(JSON.stringify(entityFixture.environment));
    environments.push(JSON.stringify(collectionFixture.environment));
    pairMetrics.push({
      pair: index,
      entity: entityMetrics,
      collection: collectionMetrics,
      synchronousLoadDeltaPercent:
        (collectionMetrics.synchronous.loadMs /
          entityMetrics.synchronous.loadMs -
          1) *
        100,
      cooperativeLoadDeltaPercent:
        (collectionMetrics.cooperative.loadMs /
          entityMetrics.cooperative.loadMs -
          1) *
        100,
    });
  }
  add(
    new Set(normalizedConfigurations).size === 1,
    'effective settings changed across renderer runs',
  );
  add(
    new Set(environments).size === 1,
    'host environment changed across renderer runs',
  );
  const synchronousPairDeltas = pairMetrics.map(
    (row) => row.synchronousLoadDeltaPercent,
  );
  const cooperativePairDeltas = pairMetrics.map(
    (row) => row.cooperativeLoadDeltaPercent,
  );
  const summary = {
    schema: 'gev-import-point-representation-benefit-summary/v1',
    outerPairsCompared: pairMetrics.length,
    synchronousLoadDeltaMedianPercent: median(synchronousPairDeltas),
    cooperativeLoadDeltaMedianPercent: median(cooperativePairDeltas),
    pairMetrics,
    performanceAcceptanceEligible: false,
    physicalDesktopAcceptance: false,
    fullS59Acceptance: false,
  };
  return { valid: errors.length === 0, errors, summary };
}

async function runChild({ renderer, index, artifactDirectory }) {
  const args = [
    'scripts/qa-hosted-capture.mjs',
    '--imports',
    '--import-mixed-parity',
    '--import-point-benefit-diagnostics',
    renderer === 'entity'
      ? '--import-point-entity'
      : '--import-point-collection',
  ];
  const rawPath = resolve('qa-artifacts/hosted-native-renderer.json');
  await unlink(rawPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  const startedAtMs = performance.now();
  const child = spawn(process.execPath, args, {
    stdio: 'ignore',
    detached: process.platform !== 'win32',
  });
  const exitPromise = new Promise((resolveExit) => {
    child.once('error', (error) =>
      resolveExit({ code: null, signal: null, error }),
    );
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  let timeout;
  const timedOut = await Promise.race([
    exitPromise.then(() => false),
    new Promise((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout(true), CHILD_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timeout);
  let exit;
  if (timedOut) {
    const cleanup = await stopOwnedRecoveryProcessTree(child, {
      exitTimeoutMs: 5000,
    });
    if (!cleanup.confirmed)
      throw new Error(
        `Timed-out ${renderer} child could not be confirmed stopped; refusing to start another renderer run.`,
      );
    exit = await exitPromise;
    exit.timedOut = true;
  } else exit = await exitPromise;
  const processElapsedMs = performance.now() - startedAtMs;
  const destination = resolve(
    artifactDirectory,
    `pair-${index}-${renderer}.json`,
  );
  let bytes;
  try {
    bytes = await readFile(rawPath);
    await writeFile(destination, bytes);
  } catch (error) {
    throw new Error(
      `Run ${index} ${renderer} produced no preserved hosted report: ${error.message}`,
      { cause: error },
    );
  }
  let run;
  try {
    run = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Run ${index} ${renderer} report is malformed`, {
      cause: error,
    });
  }
  if (
    exit.code !== 0 ||
    exit.signal ||
    exit.error ||
    exit.timedOut ||
    run.status !== 'passed' ||
    run.importPageErrors?.length > 0 ||
    run.importBatchValidation?.valid === false ||
    run.importBatches?.status !== 'passed'
  )
    throw new Error(
      `Run ${index} ${renderer} failed (exit=${exit.code}, signal=${exit.signal || 'none'}); report preserved at ${destination}`,
    );
  return { run, processElapsedMs };
}

async function gitValue(args) {
  const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const code = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', resolveExit);
  });
  if (code !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  return stdout.trim();
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('Run this hosted comparison only in GitHub Actions.');
  const commit = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit || ''))
    throw new Error('Exact immutable GITHUB_SHA is required.');
  const head = await gitValue(['rev-parse', 'HEAD']);
  const dirty = await gitValue([
    'status',
    '--porcelain',
    '--untracked-files=no',
  ]);
  if (head !== commit || dirty)
    throw new Error('Benefit run requires a clean checkout at GITHUB_SHA.');
  const packageLock = await readFile('package-lock.json');
  const artifactDirectory = resolve('qa-artifacts/import-point-benefit');
  await mkdir('qa-artifacts', { recursive: true });
  await mkdir(artifactDirectory);
  const report = {
    schema: SCHEMA,
    status: 'running',
    protocol: {
      pairs: OUTER_PAIR_COUNT,
      freshBrowserPerRun: true,
      executionOrder: EXPECTED_ORDER,
      samplesPerRun: { synchronous: 5, cooperative: 5 },
      noForcedGc: true,
      performanceAcceptanceEligible: false,
    },
    provenance: {
      applicationCommit: commit,
      harnessCommit: head,
      packageLockSha256: sha256(packageLock),
      nodeVersion: process.version,
    },
    pairs: [],
  };
  const reportPath = resolve(artifactDirectory, 'report.json');
  try {
    for (let pairIndex = 0; pairIndex < OUTER_PAIR_COUNT; pairIndex++) {
      const executionOrder = EXPECTED_ORDER[pairIndex % 2];
      const runs = {};
      const processElapsedMs = {};
      for (const renderer of executionOrder) {
        report.currentRun = {
          pair: pairIndex,
          renderer,
          startedAt: new Date().toISOString(),
          processTimeoutMs: CHILD_TIMEOUT_MS,
        };
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
        const completed = await runChild({
          renderer,
          index: pairIndex,
          artifactDirectory,
        });
        runs[renderer] = completed.run;
        processElapsedMs[renderer] = completed.processElapsedMs;
        report.pairs[pairIndex] = {
          pair: pairIndex,
          executionOrder,
          entityRun: runs.entity || null,
          collectionRun: runs['primitive-collection'] || null,
          orchestration: {
            processElapsedMs,
            scope:
              'child QA process wall time; excluded from fixture timing metrics',
          },
        };
        report.currentRun = null;
        await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      }
      const pair = report.pairs[pairIndex];
      pair.entityReportSha256 = runSha(pair.entityRun);
      pair.collectionReportSha256 = runSha(pair.collectionRun);
      const pairParity = compareImportPointRepresentationReports(
        pair.entityRun,
        pair.collectionRun,
      );
      pair.correctness = {
        valid: pairParity.valid,
        errors: pairParity.errors,
      };
      if (!pairParity.valid)
        throw new Error(
          `Renderer parity failed in pair ${pairIndex}: ${pairParity.errors.join('; ')}`,
        );
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    if (
      (await gitValue(['rev-parse', 'HEAD'])) !== commit ||
      (await gitValue(['status', '--porcelain', '--untracked-files=no']))
    )
      throw new Error('Tracked sources changed during the hosted comparison.');
    const built = buildImportPointRepresentationBenefitReport({
      applicationCommit: commit,
      harnessCommit: head,
      packageLockSha256: sha256(packageLock),
      nodeVersion: process.version,
      pairs: report.pairs,
    });
    await writeFile(reportPath, `${JSON.stringify(built, null, 2)}\n`);
    console.log(JSON.stringify(built.validation, null, 2));
    if (!built.validation.valid) process.exitCode = 1;
  } catch (error) {
    report.status = 'failed';
    report.error = String(error?.message || error).slice(0, 1000);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
