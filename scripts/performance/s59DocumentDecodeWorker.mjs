import { parentPort } from 'node:worker_threads';
import { previewCSV, previewGeoJSON } from '../../src/imports/geojsonCsv.js';
import { previewKML } from '../../src/imports/kmlGpx.js';
import { packPreviewCoordinates } from './s59CoordinateTransfer.mjs';

if (!parentPort) throw new Error('This module must run inside a worker.');

const active = new Map();

parentPort.on('message', (message) => {
  if (message?.type === 'cancel') {
    active.get(message.id)?.abort();
    return;
  }
  if (message?.type === 'crashForTest') {
    process.exit(73);
    return;
  }
  if (message?.type === 'exitForTest') {
    process.exit(0);
    return;
  }
  if (message?.type !== 'run' || !Number.isSafeInteger(message.id)) return;
  if (active.size > 0) {
    parentPort.postMessage({
      type: 'error',
      id: message.id,
      name: 'Error',
      code: 'worker-busy',
      message: 'Diagnostic worker accepts one task at a time.',
      durationMs: 0,
      maxEventLoopGapMs: 0,
    });
    return;
  }
  void run(message);
});

parentPort.postMessage({ type: 'ready' });

async function run({ id, kind, input, options, transport = 'clone' }) {
  const controller = new AbortController();
  active.set(id, controller);
  let previousTick = performance.now();
  let maxEventLoopGapMs = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxEventLoopGapMs = Math.max(maxEventLoopGapMs, now - previousTick);
    previousTick = now;
  }, 1);
  const startedAt = performance.now();
  try {
    const previewStartedAt = performance.now();
    const preview = await decodePreview(kind, input, {
      ...options,
      signal: controller.signal,
    });
    const previewDurationMs = performance.now() - previewStartedAt;
    let payload = { type: 'result', preview };
    let packDurationMs = 0;
    let transferList = [];
    if (transport === 'transfer') {
      const packStartedAt = performance.now();
      const packet = packPreviewCoordinates(preview);
      packDurationMs = performance.now() - packStartedAt;
      payload = { type: 'transfer-result', ...packet };
      transferList = [
        packet.packedRecords.buffer,
        packet.shapeBuffer.buffer,
        packet.coordinateBuffer.buffer,
      ];
    } else if (transport !== 'clone') {
      throw Object.assign(new Error('Unsupported diagnostic transport.'), {
        code: 'unsupported-transport',
      });
    }
    const durationMs = performance.now() - startedAt;
    // Let the timer observe any long synchronous segment before stopping it;
    // the extra checkpoint is excluded from the reported task duration.
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearInterval(heartbeat);
    active.delete(id);
    parentPort.postMessage(
      {
        ...payload,
        id,
        durationMs,
        previewDurationMs,
        packDurationMs,
        maxEventLoopGapMs,
      },
      transferList,
    );
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearInterval(heartbeat);
    active.delete(id);
    parentPort.postMessage({
      type: 'error',
      id,
      name: String(error?.name || 'Error').slice(0, 80),
      code: typeof error?.code === 'string' ? error.code.slice(0, 80) : null,
      message: String(error?.message || error).slice(0, 240),
      durationMs,
      maxEventLoopGapMs,
    });
  }
}

function decodePreview(kind, input, options) {
  switch (kind) {
    case 'geojson':
      return previewGeoJSON(input, options);
    case 'csv':
      return previewCSV(input, options);
    case 'kml':
      return previewKML(input, options);
    case 'diagnostic-busy': {
      const durationMs = Math.max(
        0,
        Math.min(100, Number(options?.durationMs) || 0),
      );
      const deadline = performance.now() + durationMs;
      while (performance.now() < deadline) {}
      return {
        kind,
        accepted: 0,
        rejected: 0,
        records: [],
      };
    }
    default:
      throw Object.assign(new Error('Unsupported diagnostic import kind.'), {
        code: 'unsupported-kind',
      });
  }
}
