#!/usr/bin/env node
/**
 * Diagnostic-only comparison of the current public import preview APIs on the
 * main thread and in a persistent Node worker_threads worker. This is not a
 * browser Web Worker or rendering benchmark.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { previewCSV, previewGeoJSON } from '../../src/imports/geojsonCsv.js';
import { previewKML } from '../../src/imports/kmlGpx.js';
import { rehydratePreviewCoordinates } from './s59CoordinateTransfer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_URL = new URL('./s59DocumentDecodeWorker.mjs', import.meta.url);
const DEFAULT_PAIRS = 5;
const TASK_TIMEOUT_MS = 45_000;
const COMPARISON_TIMEOUT_MS = 10 * 60_000;

function git(args) {
  return execFileSync('git', args, {
    cwd: path.resolve(HERE, '../..'),
    encoding: 'utf8',
  }).trim();
}

function gitBuffer(args) {
  return execFileSync('git', args, {
    cwd: path.resolve(HERE, '../..'),
    encoding: 'buffer',
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stablePreviewHash(preview) {
  return sha256(JSON.stringify(preview));
}

function ring(count, centerLon, centerLat, radius) {
  const points = Array.from({ length: count - 1 }, (_, index) => {
    const angle = (index / (count - 1)) * Math.PI * 2;
    return [
      Number((centerLon + Math.cos(angle) * radius).toFixed(9)),
      Number((centerLat + Math.sin(angle) * radius).toFixed(9)),
      25,
    ];
  });
  points.push([...points[0]]);
  return points;
}

function buildWorkloads(vertexCount = 50_000, rowCount = 50_000) {
  assert.ok(
    Number.isSafeInteger(vertexCount) &&
      vertexCount >= 4 &&
      vertexCount <= 50_000,
    'Diagnostic geometry is bounded to 50,000 vertices.',
  );
  assert.ok(
    Number.isSafeInteger(rowCount) && rowCount >= 1 && rowCount <= 50_000,
    'Diagnostic documents are bounded to 50,000 rows.',
  );
  const lineCoordinates = ring(vertexCount, -97, 30, 0.2);
  const outerCount = Math.floor(vertexCount / 2);
  const innerCount = vertexCount - outerCount;
  const polygonCoordinates = [
    ring(outerCount, -97, 30, 0.2),
    ring(innerCount, -97, 30, 0.05),
  ];
  const geojson = (id, type, coordinates) =>
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id,
          properties: { name: id, observed_at: '2026-10-10T12:00:00Z' },
          geometry: { type, coordinates },
        },
      ],
    });
  const lineText = geojson('line-50k', 'LineString', lineCoordinates);
  const polygonText = geojson(
    'polygon-hole-50k',
    'Polygon',
    polygonCoordinates,
  );
  const csvRows = ['id,latitude,longitude,observed_at,note'];
  const placemarks = [];
  for (let index = 0; index < rowCount; index++) {
    const id = `row-${index + 1}`;
    const latitude = (30 + (index % 8000) / 100_000).toFixed(6);
    const longitude = (-97 - (index % 9000) / 100_000).toFixed(6);
    csvRows.push(`${id},${latitude},${longitude},2026-10-10T12:00:00Z,fixture`);
    if (index === 0)
      placemarks.push(
        `<Placemark><name>xml-line-${vertexCount}</name><LineString><coordinates>${lineCoordinates
          .map(([lon, lat]) => `${lon},${lat},25`)
          .join(' ')}</coordinates></LineString></Placemark>`,
      );
  }
  const csvText = csvRows.join('\n');
  const kmlText = `<?xml version="1.0"?><kml><Document>${placemarks.join('')}</Document></kml>`;
  const workload = (id, kind, input, expected) => ({
    id,
    kind,
    input,
    inputBytes: Buffer.byteLength(input),
    expected,
    options:
      kind === 'csv'
        ? {
            mapping: {
              id: 'id',
              latitude: 'latitude',
              longitude: 'longitude',
              time: 'observed_at',
            },
          }
        : {},
  });
  return [
    workload('geojson-line-50k-vertices', 'geojson', lineText, {
      accepted: 1,
      rejected: 0,
      vertexCount,
      firstId: 'line-50k',
      lastId: 'line-50k',
    }),
    workload('geojson-polygon-hole-50k-vertices', 'geojson', polygonText, {
      accepted: 1,
      rejected: 0,
      vertexCount,
      ringCount: 2,
      firstId: 'polygon-hole-50k',
      lastId: 'polygon-hole-50k',
    }),
    workload('csv-50k-rows', 'csv', csvText, {
      accepted: rowCount,
      rejected: 0,
      firstId: 'row-1',
      lastId: `row-${rowCount}`,
    }),
    workload('kml-line-50k-vertices', 'kml', kmlText, {
      accepted: 1,
      rejected: 0,
      vertexCount,
      firstId: `xml-line-${vertexCount}`,
      lastId: `xml-line-${vertexCount}`,
    }),
  ];
}

function countVertices(preview) {
  let count = 0;
  const visit = (value) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      value.length <= 3 &&
      value.every((part) => typeof part === 'number')
    ) {
      count++;
      return;
    }
    if (Array.isArray(value)) for (const part of value) visit(part);
  };
  for (const record of preview.records) visit(record.geometry.coordinates);
  return count;
}

function summarizePreview(preview) {
  return {
    kind: preview.kind,
    accepted: preview.accepted,
    rejected: preview.rejected,
    firstId: preview.records[0]?.id ?? null,
    lastId: preview.records.at(-1)?.id ?? null,
    vertexCount: countVertices(preview),
    ringCount:
      preview.records[0]?.geometry?.type === 'Polygon'
        ? preview.records[0].geometry.coordinates.length
        : null,
    outputSha256: stablePreviewHash(preview),
  };
}

function decodePreview(kind, input, options) {
  switch (kind) {
    case 'geojson':
      return previewGeoJSON(input, options);
    case 'csv':
      return previewCSV(input, options);
    case 'kml':
      return previewKML(input, options);
    default:
      throw Object.assign(new Error('Unsupported diagnostic import kind.'), {
        code: 'unsupported-kind',
      });
  }
}

function createDecodeWorker() {
  const worker = new Worker(WORKER_URL, { type: 'module' });
  const pending = new Map();
  let nextId = 1;
  let disposed = false;
  let terminalError = null;
  let termination = null;
  let readyReceived = false;
  let readyPromise = null;
  let readyResolve = null;
  let readyReject = null;
  let readyTimeout = null;
  worker.on('message', async (message) => {
    if (message?.type === 'ready') {
      readyReceived = true;
      clearTimeout(readyTimeout);
      readyTimeout = null;
      readyResolve?.();
      return;
    }
    const entry = pending.get(message?.id);
    if (!entry) return;
    if (entry.signal?.aborted) {
      finishEntry(message.id, entry);
      entry.reject(
        entry.signal.reason || new DOMException('Aborted', 'AbortError'),
      );
      return;
    }
    try {
      if (
        message.type === 'transfer-result' &&
        entry.transport === 'transfer'
      ) {
        const rehydrationStartedAt = performance.now();
        entry.onRehydrationStart?.();
        const restored = await rehydratePreviewCoordinates(
          {
            metadata: message.metadata,
            packedRecords: message.packedRecords,
            shapeBuffer: message.shapeBuffer,
            coordinateBuffer: message.coordinateBuffer,
          },
          {
            signal: entry.rehydrationController.signal,
            budgetMs: 4,
            scheduleTimer: entry.rehydrationScheduleTimer,
          },
        );
        if (pending.get(message.id) !== entry) return;
        if (entry.signal?.aborted)
          throw (
            entry.signal.reason || new DOMException('Aborted', 'AbortError')
          );
        finishEntry(message.id, entry);
        entry.resolve({
          preview: restored.preview,
          workerDurationMs: message.durationMs,
          workerPreviewDurationMs: message.previewDurationMs,
          workerPackDurationMs: message.packDurationMs,
          workerMaxEventLoopGapMs: message.maxEventLoopGapMs,
          rehydrationDurationMs: performance.now() - rehydrationStartedAt,
          rehydrationBatches: restored.batches,
          maximumRehydrationBatchDurationMs: restored.maximumBatchDurationMs,
        });
      } else if (message.type === 'result' && entry.transport === 'clone') {
        finishEntry(message.id, entry);
        entry.resolve({
          preview: message.preview,
          workerDurationMs: message.durationMs,
          workerPreviewDurationMs: message.previewDurationMs,
          workerPackDurationMs: message.packDurationMs,
          workerMaxEventLoopGapMs: message.maxEventLoopGapMs,
        });
      } else {
        finishEntry(message.id, entry);
        entry.reject(
          Object.assign(
            new Error(message.message || 'Worker preview failed.'),
            {
              name: message.name || 'Error',
              code: message.code || undefined,
              workerDurationMs: message.durationMs,
              workerMaxEventLoopGapMs: message.maxEventLoopGapMs,
            },
          ),
        );
      }
    } catch (error) {
      finishEntry(message.id, entry);
      entry.reject(error);
    }
  });

  function finishEntry(id, entry) {
    if (pending.get(id) !== entry) return;
    pending.delete(id);
    clearTimeout(entry.timeout);
    entry.signal?.removeEventListener('abort', entry.onAbort);
  }
  worker.on('error', (error) => {
    terminalError = error;
    clearTimeout(readyTimeout);
    readyTimeout = null;
    readyReject?.(error);
    rejectAll(error);
  });
  worker.on('exit', (code) => {
    if (!disposed) {
      terminalError = new Error(`Decode worker exited with code ${code}.`);
      clearTimeout(readyTimeout);
      readyTimeout = null;
      readyReject?.(terminalError);
      rejectAll(terminalError);
    }
  });

  function rejectAll(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.signal?.removeEventListener('abort', entry.onAbort);
      entry.rehydrationController.abort(error);
      entry.reject(error);
    }
    pending.clear();
  }

  return {
    async ready() {
      if (terminalError) throw terminalError;
      if (disposed) throw new Error('Decode worker is disposed.');
      if (readyReceived) return;
      if (!readyPromise) {
        readyPromise = new Promise((resolve, reject) => {
          readyResolve = resolve;
          readyReject = reject;
          readyTimeout = setTimeout(() => {
            terminalError = new Error('Decode worker startup timed out.');
            readyReject(terminalError);
          }, TASK_TIMEOUT_MS);
        });
      }
      await readyPromise;
    },
    run(
      kind,
      input,
      options = {},
      {
        signal,
        timeoutMs = TASK_TIMEOUT_MS,
        transport = 'clone',
        onRehydrationStart = null,
        rehydrationScheduleTimer = null,
      } = {},
    ) {
      if (terminalError) return Promise.reject(terminalError);
      if (disposed)
        return Promise.reject(new Error('Decode worker is disposed.'));
      if (pending.size > 0)
        return Promise.reject(
          new Error('Decode worker accepts one owned task at a time.'),
        );
      if (signal?.aborted)
        return Promise.reject(
          signal.reason || new DOMException('Aborted', 'AbortError'),
        );
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const error = new Error('Decode worker task timed out.');
          terminalError = error;
          disposed = true;
          rejectAll(error);
          termination = worker.terminate();
        }, timeoutMs);
        const rehydrationController = new AbortController();
        const onAbort = () => {
          rehydrationController.abort(
            signal.reason || new DOMException('Aborted', 'AbortError'),
          );
          worker.postMessage({ type: 'cancel', id });
        };
        const entry = {
          resolve,
          reject,
          timeout,
          signal,
          onAbort,
          transport,
          rehydrationController,
          onRehydrationStart,
          rehydrationScheduleTimer,
        };
        pending.set(id, entry);
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
          worker.postMessage({
            type: 'run',
            id,
            kind,
            input,
            options,
            transport,
          });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timeout);
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        }
      });
    },
    crashForTest() {
      if (!disposed) worker.postMessage({ type: 'crashForTest' });
    },
    exitForTest() {
      if (disposed)
        return Promise.reject(new Error('Decode worker is disposed.'));
      return new Promise((resolve) => {
        worker.once('exit', resolve);
        worker.postMessage({ type: 'exitForTest' });
      });
    },
    async dispose() {
      if (termination) {
        await termination;
        return;
      }
      if (disposed) return;
      disposed = true;
      clearTimeout(readyTimeout);
      readyTimeout = null;
      readyReject?.(new Error('Decode worker disposed before ready.'));
      rejectAll(new Error('Decode worker disposed.'));
      termination = worker.terminate();
      await termination;
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

async function measured(operation) {
  let previousTick = performance.now();
  let maxMainThreadGapMs = 0;
  let timerObservations = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    timerObservations++;
    maxMainThreadGapMs = Math.max(maxMainThreadGapMs, now - previousTick);
    previousTick = now;
  }, 1);
  await new Promise((resolve) => setImmediate(resolve));
  const startedAt = performance.now();
  try {
    const value = await operation();
    const totalCompletionMs = performance.now() - startedAt;
    // Flush the observer once, after the operation, so a long synchronous
    // operation that resolves through microtasks is still represented.
    await new Promise((resolve) => setImmediate(resolve));
    return {
      value,
      totalCompletionMs,
      maxMainThreadGapMs: timerObservations ? maxMainThreadGapMs : null,
      timerObservations,
    };
  } finally {
    clearInterval(heartbeat);
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function runComparison({ outputPath, pairs = DEFAULT_PAIRS } = {}) {
  assert.ok(Number.isSafeInteger(pairs) && pairs >= 1 && pairs <= 5);
  const workloads = buildWorkloads();
  const sourceFiles = [
    'src/imports/geojsonCsv.js',
    'src/imports/kmlGpx.js',
    'src/imports/cooperative.js',
    'src/director/packs/geojson.js',
    'scripts/performance/s59CoordinateTransfer.mjs',
  ];
  const report = {
    schema: 'gev-s59-document-decode-comparison/v2',
    status: 'running',
    capturedAt: new Date().toISOString(),
    candidateCommit: git(['rev-parse', 'HEAD']),
    sourceClean: git(['status', '--porcelain']).length === 0,
    sourceFiles: Object.fromEntries(
      await Promise.all(
        sourceFiles.map(async (file) => [
          file,
          {
            workingTreeSha256: sha256(
              await readFile(path.resolve(HERE, '../..', file)),
            ),
            headSha256: sha256(gitBuffer(['show', `HEAD:${file}`])),
          },
        ]),
      ),
    ),
    harnessSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    workerScriptSha256: sha256(await readFile(fileURLToPath(WORKER_URL))),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? null,
      memoryBytes: os.totalmem(),
    },
    workerStartupMs: null,
    warmup: [],
    scope:
      'Diagnostic comparison of public preview APIs on the main thread and in a persistent Node worker_threads worker using structured clone or transferable coordinate buffers. Transfer mode clones record metadata and rehydrates coordinates on the main thread in consumeInBatches with a 4ms target. Total completion minus worker execution is combined clone, delivery, main-thread reconstruction, and scheduling; it is not clone-only attribution. Maximum 1ms timer gap is a responsiveness observation, not application CPU duration. Not a browser, rendering, GPU, or production-default comparison.',
    bounds: {
      maxVerticesPerGeometry: 50_000,
      maxCsvRows: 50_000,
      maxPairs: 5,
      maxWorkerTasksInFlight: 1,
      maxRecords: 50_000,
      maxCoordinates: 50_000,
      maxTransferValues: 150_000,
      maxShapeInstructions: 200_000,
      rehydrationBatchTargetMs: 4,
      taskTimeoutMs: TASK_TIMEOUT_MS,
      comparisonTimeoutMs: COMPARISON_TIMEOUT_MS,
      timerIntervalMs: 1,
    },
    fixture: {
      vertices: 50_000,
      csvRows: 50_000,
      deterministic: true,
      workloads: workloads.map(({ id, kind, input, expected }) => ({
        id,
        kind,
        inputBytes: Buffer.byteLength(input),
        inputSha256: sha256(input),
        expected,
      })),
    },
    samples: [],
    summaries: [],
  };
  const worker = createDecodeWorker();
  const comparisonStartedAt = performance.now();
  try {
    const workerStartupStartedAt = performance.now();
    await worker.ready();
    report.workerStartupMs = performance.now() - workerStartupStartedAt;
    for (const workload of workloads) {
      // Warm both paths once before collecting alternating paired observations.
      const mainWarmupStartedAt = performance.now();
      const warmMain = await decodePreview(
        workload.kind,
        workload.input,
        workload.options,
      );
      const mainWarmupMs = performance.now() - mainWarmupStartedAt;
      const workerWarmupStartedAt = performance.now();
      const warmWorker = await worker.run(
        workload.kind,
        workload.input,
        workload.options,
      );
      const workerWarmupMs = performance.now() - workerWarmupStartedAt;
      const transferWarmupStartedAt = performance.now();
      const warmTransfer = await worker.run(
        workload.kind,
        workload.input,
        workload.options,
        { transport: 'transfer' },
      );
      const transferWarmupMs = performance.now() - transferWarmupStartedAt;
      const warmHash = stablePreviewHash(warmMain);
      assert.equal(stablePreviewHash(warmWorker.preview), warmHash);
      assert.equal(stablePreviewHash(warmTransfer.preview), warmHash);
      report.warmup.push({
        workload: workload.id,
        mainCompletionMs: mainWarmupMs,
        workerCompletionMs: workerWarmupMs,
        workerExecutionMs: warmWorker.workerDurationMs,
        transferCompletionMs: transferWarmupMs,
        transferWorkerExecutionMs: warmTransfer.workerDurationMs,
        transferPreviewExecutionMs: warmTransfer.workerPreviewDurationMs,
        transferPackExecutionMs: warmTransfer.workerPackDurationMs,
        transferRehydrationMs: warmTransfer.rehydrationDurationMs,
        transferRehydrationMaximumBatchMs:
          warmTransfer.maximumRehydrationBatchDurationMs,
        outputSha256: warmHash,
      });
      for (let pair = 0; pair < pairs; pair++) {
        assert.ok(
          performance.now() - comparisonStartedAt <= COMPARISON_TIMEOUT_MS,
          'S59 comparison exceeded its overall 10-minute bound.',
        );
        const baseOrder = ['main', 'clone', 'transfer'];
        const order = baseOrder.map(
          (_, index) => baseOrder[(index + pair) % baseOrder.length],
        );
        const pairSamples = {};
        for (const variant of order) {
          const sample = await measured(async () =>
            variant === 'main'
              ? {
                  preview: await decodePreview(
                    workload.kind,
                    workload.input,
                    workload.options,
                  ),
                }
              : await worker.run(
                  workload.kind,
                  workload.input,
                  workload.options,
                  { transport: variant === 'transfer' ? 'transfer' : 'clone' },
                ),
          );
          const preview = sample.value.preview;
          const observed = summarizePreview(preview);
          assert.equal(observed.outputSha256, warmHash);
          for (const [key, expected] of Object.entries(workload.expected))
            assert.equal(observed[key], expected, `${workload.id} ${key}`);
          const row = {
            pair,
            order,
            variant,
            totalCompletionMs: sample.totalCompletionMs,
            maxMainThreadGapMs: sample.maxMainThreadGapMs,
            workerDurationMs:
              variant === 'main' ? null : sample.value.workerDurationMs,
            workerPreviewDurationMs:
              variant === 'main'
                ? null
                : (sample.value.workerPreviewDurationMs ??
                  sample.value.workerDurationMs),
            workerPackDurationMs:
              variant === 'transfer' ? sample.value.workerPackDurationMs : null,
            combinedCloneDeliveryReconstructionSchedulingMs:
              variant !== 'main'
                ? sample.totalCompletionMs - sample.value.workerDurationMs
                : null,
            rehydrationDurationMs:
              variant === 'transfer'
                ? sample.value.rehydrationDurationMs
                : null,
            rehydrationBatches:
              variant === 'transfer' ? sample.value.rehydrationBatches : null,
            maximumRehydrationBatchDurationMs:
              variant === 'transfer'
                ? sample.value.maximumRehydrationBatchDurationMs
                : null,
            workerMaxEventLoopGapMs:
              variant !== 'main' ? sample.value.workerMaxEventLoopGapMs : null,
            ...observed,
          };
          report.samples.push({ workload: workload.id, ...row });
          pairSamples[variant] = row;
        }
        for (const variant of ['clone', 'transfer']) {
          assert.equal(
            pairSamples.main.outputSha256,
            pairSamples[variant].outputSha256,
            `${workload.id} pair ${pair} ${variant} output parity`,
          );
          assert.equal(
            pairSamples.main.accepted,
            pairSamples[variant].accepted,
            `${workload.id} pair ${pair} ${variant} accepted parity`,
          );
        }
      }
      const samplesFor = (variant, field) =>
        report.samples
          .filter(
            (sample) =>
              sample.workload === workload.id && sample.variant === variant,
          )
          .map((sample) => sample[field]);
      report.summaries.push({
        workload: workload.id,
        inputBytes: workload.inputBytes,
        outputSha256: warmHash,
        mainMedianCompletionMs: median(samplesFor('main', 'totalCompletionMs')),
        cloneMedianCompletionMs: median(
          samplesFor('clone', 'totalCompletionMs'),
        ),
        transferMedianCompletionMs: median(
          samplesFor('transfer', 'totalCompletionMs'),
        ),
        mainMedianMaxTaskGapMs: median(
          samplesFor('main', 'maxMainThreadGapMs'),
        ),
        cloneMedianMaxMainTaskGapMs: median(
          samplesFor('clone', 'maxMainThreadGapMs'),
        ),
        transferMedianMaxMainTaskGapMs: median(
          samplesFor('transfer', 'maxMainThreadGapMs'),
        ),
        cloneMedianWorkerTaskGapMs: median(
          samplesFor('clone', 'workerMaxEventLoopGapMs'),
        ),
        transferMedianWorkerTaskGapMs: median(
          samplesFor('transfer', 'workerMaxEventLoopGapMs'),
        ),
        transferMedianWorkerExecutionMs: median(
          samplesFor('transfer', 'workerDurationMs'),
        ),
        transferMedianPackMs: median(
          samplesFor('transfer', 'workerPackDurationMs'),
        ),
        transferMedianRehydrationMs: median(
          samplesFor('transfer', 'rehydrationDurationMs'),
        ),
        transferMaximumBatchMs: Math.max(
          ...samplesFor('transfer', 'maximumRehydrationBatchDurationMs'),
        ),
      });
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = {
      name: String(error?.name || 'Error').slice(0, 80),
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
      message: String(error?.message || error).slice(0, 300),
    };
  } finally {
    await worker.dispose();
    report.workerPendingAtCleanup = worker.pendingCount;
    report.cleanup = {
      workerTerminated: true,
      pendingJobs: worker.pendingCount,
    };
  }
  report.candidateCommitAtEnd = git(['rev-parse', 'HEAD']);
  report.sourceCleanAtEnd = git(['status', '--porcelain']).length === 0;
  report.sourceIdentityStable =
    report.candidateCommitAtEnd === report.candidateCommit &&
    report.sourceClean &&
    report.sourceCleanAtEnd;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, {
      flag: 'wx',
    });
  }
  return report;
}

export {
  buildWorkloads,
  createDecodeWorker,
  decodePreview,
  measured,
  runComparison,
  stablePreviewHash,
  summarizePreview,
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outIndex = process.argv.indexOf('--out');
  const pairsIndex = process.argv.indexOf('--pairs');
  const report = await runComparison({
    outputPath: outIndex >= 0 ? process.argv[outIndex + 1] : undefined,
    pairs:
      pairsIndex >= 0 ? Number(process.argv[pairsIndex + 1]) : DEFAULT_PAIRS,
  });
  console.log(
    JSON.stringify(
      {
        status: report.status,
        candidateCommit: report.candidateCommit,
        sourceClean: report.sourceClean,
        workloads: report.summaries,
        outputPath:
          outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : null,
      },
      null,
      2,
    ),
  );
  if (report.status !== 'passed') process.exitCode = 1;
}
