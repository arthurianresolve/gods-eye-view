import { IMPORT_LIMITS, previewCSV, previewGeoJSON } from '../../src/imports/geojsonCsv.js';
import { createImportInputComparisonFixtures } from './import-input-comparison-fixtures.mjs';

const RUN_LIMIT_MS = 60_000;
const TRIALS = 5;
const runButton = document.querySelector('#run');
const cancelButton = document.querySelector('#cancel');
const downloadButton = document.querySelector('#download');
const statusNode = document.querySelector('#status');
const reportNode = document.querySelector('#report');
let activeController = null;
let latestReport = null;

function appCommit() {
  return typeof __GEV_APP_COMMIT__ === 'string'
    ? __GEV_APP_COMMIT__
    : null;
}

function ensureTime(signal, deadlineAt) {
  signal.throwIfAborted();
  if (performance.now() >= deadlineAt)
    throw new DOMException('The 60-second run limit was reached.', 'TimeoutError');
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function runPreview(fixture, mode, signal, deadlineAt) {
  ensureTime(signal, deadlineAt);
  const startedAt = performance.now();
  let pending;
  if (fixture.kind === 'csv') {
    pending = previewCSV(fixture.text, {
      signal,
      mapping: { id: 'id', latitude: 'latitude', longitude: 'longitude' },
      cooperativeParsing: mode === 'cooperative',
    });
  } else {
    pending = previewGeoJSON(fixture.text, {
      signal,
      workerParsing: mode === 'worker',
    });
  }
  const synchronousPrefixMs = performance.now() - startedAt;
  const preview = await pending;
  const totalMs = performance.now() - startedAt;
  ensureTime(signal, deadlineAt);
  const first = preview.records[0]?.id ?? null;
  const last = preview.records.at(-1)?.id ?? null;
  if (
    preview.accepted !== fixture.count ||
    preview.rejected !== 0 ||
    first !== fixture.firstId ||
    last !== fixture.lastId
  )
    throw new Error(`${fixture.kind}/${mode} preview failed its record contract.`);
  const resultSha256 = await sha256(
    new TextEncoder().encode(JSON.stringify(preview)),
  );
  ensureTime(signal, deadlineAt);
  return {
    mode,
    synchronousPrefixMs,
    totalMs,
    accepted: preview.accepted,
    rejected: preview.rejected,
    firstId: first,
    lastId: last,
    resultSha256,
  };
}

async function compareFixture(fixture, signal, deadlineAt) {
  const defaultMode = 'synchronous';
  const alternateMode = fixture.kind === 'csv' ? 'cooperative' : 'worker';
  const warmup = {
    synchronous: await runPreview(fixture, defaultMode, signal, deadlineAt),
    alternate: await runPreview(fixture, alternateMode, signal, deadlineAt),
  };
  if (warmup.synchronous.resultSha256 !== warmup.alternate.resultSha256)
    throw new Error(`${fixture.kind} warmup outputs differ.`);
  const pairs = [];
  for (let trial = 0; trial < TRIALS; trial++) {
    const order =
      trial % 2 === 0
        ? [defaultMode, alternateMode]
        : [alternateMode, defaultMode];
    const observed = {};
    for (const mode of order)
      observed[mode] = await runPreview(fixture, mode, signal, deadlineAt);
    const equal =
      observed[defaultMode].resultSha256 === observed[alternateMode].resultSha256;
    pairs.push({ trial: trial + 1, order, equal, ...observed });
    if (!equal) throw new Error(`${fixture.kind} trial ${trial + 1} outputs differ.`);
  }
  return { warmup, pairs };
}

function publish(report) {
  latestReport = report;
  reportNode.textContent = JSON.stringify(report, null, 2);
  downloadButton.disabled = false;
}

async function run() {
  if (activeController) return;
  const startedAt = performance.now();
  const deadlineAt = startedAt + RUN_LIMIT_MS;
  const controller = new AbortController();
  activeController = controller;
  const deadlineTimer = setTimeout(
    () => controller.abort(new DOMException('The 60-second run limit was reached.', 'TimeoutError')),
    RUN_LIMIT_MS,
  );
  runButton.disabled = true;
  cancelButton.disabled = false;
  downloadButton.disabled = true;
  statusNode.textContent = 'Building and hashing fixed inputs…';
  const buildCommit = appCommit();
  const report = {
    schema: 'gev-import-input-comparison/v1',
    applicationCommit: buildCommit,
    harnessCommit: buildCommit,
    browserUserAgent: navigator.userAgent,
    capturedAt: new Date().toISOString(),
    diagnosticOnly: true,
    performanceAcceptanceEligible: false,
    runLimitMs: RUN_LIMIT_MS,
    trialsPerPair: TRIALS,
    warmupTrialsPerMode: 1,
    scope:
      'Synthetic parser comparison only; no Cesium, GPU, rendering, user-file data, or performance acceptance claim.',
    status: 'running',
    workloads: [],
  };
  try {
    if (!/^[a-f0-9]{40}$/i.test(buildCommit || ''))
      throw new Error('A full Vite build commit is required for this comparison.');
    const fixtures = createImportInputComparisonFixtures();
    for (const fixture of fixtures) {
      ensureTime(controller.signal, deadlineAt);
      const bytes = new TextEncoder().encode(fixture.text);
      if (bytes.byteLength > IMPORT_LIMITS.bytes)
        throw new Error(`${fixture.kind} fixture exceeds the import byte limit.`);
      const workload = {
        kind: fixture.kind,
        records: fixture.count,
        bytes: bytes.byteLength,
        fixtureSha256: await sha256(bytes),
        firstId: fixture.firstId,
        lastId: fixture.lastId,
        modeNames:
          fixture.kind === 'csv'
            ? { synchronous: 'synchronous', alternate: 'cooperative' }
            : { synchronous: 'synchronous', alternate: 'worker' },
        status: 'running',
      };
      report.workloads.push(workload);
      statusNode.textContent = `Comparing ${fixture.kind}…`;
      const samples = await compareFixture(fixture, controller.signal, deadlineAt);
      workload.warmup = samples.warmup;
      workload.pairs = samples.pairs;
      workload.status = 'passed';
    }
    report.status = 'completed';
  } catch (error) {
    report.status =
      error?.name === 'TimeoutError'
        ? 'timed-out'
        : error?.name === 'AbortError'
          ? 'cancelled'
          : 'failed';
    report.failure = {
      name: String(error?.name || 'Error').slice(0, 40),
      code: String(error?.code || '').slice(0, 60) || null,
      message: String(error?.message || 'Input comparison failed.').slice(0, 180),
    };
    const last = report.workloads.at(-1);
    if (last?.status === 'running') last.status = 'failed';
  } finally {
    clearTimeout(deadlineTimer);
    report.wallTimeMs = performance.now() - startedAt;
    report.status = report.status === 'running' ? 'failed' : report.status;
    publish(report);
    statusNode.textContent = `${report.status} (${Math.round(report.wallTimeMs)} ms).`;
    activeController = null;
    runButton.disabled = false;
    cancelButton.disabled = true;
  }
}

runButton.addEventListener('click', run);
cancelButton.addEventListener('click', () => {
  activeController?.abort(new DOMException('Cancelled by user.', 'AbortError'));
});
downloadButton.addEventListener('click', () => {
  if (!latestReport) return;
  const blob = new Blob([JSON.stringify(latestReport, null, 2) + '\n'], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'gev-import-input-comparison.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
