#!/usr/bin/env node
import { createArchiveLookup } from '../src/evidence/archiveLookup.js';
import { createEvidenceEnvelope } from '../src/evidence/evidence.js';
import {
  createWorkspaceDocument,
  parseWorkspaceDocument,
} from '../src/workspaces/document.js';
import { isCameraEligibleForAutoSelection } from '../src/layers/cctv/healthPolicy.js';

const DEFAULT_DURATION_MS = 60 * 60_000;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
}

/**
 * Run a deterministic mixed-use fixture without live providers. The same
 * state transitions are used by the browser journey; this harness keeps the
 * long soak hermetic and makes failures reproducible from its seed.
 */
export async function runMixedUseSoak({
  durationMs = DEFAULT_DURATION_MS,
  now = () => Date.now(),
  yieldEvery = 32,
} = {}) {
  const startedAt = now();
  const archiveCalls = [];
  let archiveOutage = false;
  const archive = createArchiveLookup({
    now,
    fetchImpl: async (_url, options) => {
      archiveCalls.push(JSON.parse(options.body));
      if (archiveOutage) {
        return new Response(JSON.stringify({ state: 'failed' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          state: 'available',
          reference: {
            kind: 'archive',
            url: 'https://web.archive.org/web/20260101000000/https://example.test',
            originalUrl: 'https://example.test',
            archiveAt: 1_767_225_600_000,
            lookedUpAt: now(),
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  let iterations = 0;
  let sourceToggles = 0;
  let replaySeeks = 0;
  let workspaceReloads = 0;
  let imports = 0;
  let archiveFailures = 0;
  let cameraRecoveries = 0;
  let workspace = createWorkspaceDocument({
    id: 'soak-fixture',
    title: 'Mixed-use soak fixture',
    createdAt: startedAt,
    updatedAt: startedAt,
    view: { camera: { lat: 0, lon: 0, altitude_m: 100_000 }, layers: [] },
    filters: {},
    pinnedEvidence: [],
    annotations: [],
    assetRefs: [],
  });

  const minimumIterations = 11;
  while (
    iterations < minimumIterations ||
    now() - startedAt < Math.max(1, durationMs)
  ) {
    iterations++;
    if (iterations % 5 === 0) sourceToggles++;
    if (iterations % 3 === 0) replaySeeks++;
    if (iterations % 7 === 0) {
      imports++;
      const evidence = createEvidenceEnvelope({
        entityRef: { layerKey: 'fixture', id: `record-${iterations}` },
        sourceId: 'fixture',
        sourceUrl: 'https://example.test/source',
        observedAt: startedAt,
      });
      workspace = parseWorkspaceDocument(
        JSON.stringify(
          createWorkspaceDocument({
            ...workspace,
            updatedAt: Math.max(startedAt, now()),
            pinnedEvidence: [
              {
                id: `record-${iterations}`,
                sourceId: 'fixture',
                capturedAt: startedAt,
                record: { evidence },
              },
            ],
          }),
        ),
      );
      workspaceReloads++;
    }
    archiveOutage = iterations % 11 === 0;
    try {
      await archive.lookup({
        url: `https://example.test/source?iteration=${iterations}`,
        timestamp: '20260101',
      });
    } catch {
      if (archiveOutage) archiveFailures++;
      else throw new Error('Unexpected archive fixture failure.');
    }
    const failedHealth = {
      status: archiveOutage ? 'degraded' : 'ok',
      reasonCode: archiveOutage ? 'upstream-timeout' : 'delivery-ok',
      updatedAt: now(),
    };
    if (!isCameraEligibleForAutoSelection(failedHealth, now())) {
      const recovered = {
        status: 'ok',
        reasonCode: 'delivery-ok',
        updatedAt: now(),
      };
      if (!isCameraEligibleForAutoSelection(recovered, now()))
        throw new Error('Healthy camera was excluded after recovery.');
      cameraRecoveries++;
    }
    if (iterations % Math.max(1, yieldEvery) === 0)
      await new Promise((resolve) => setImmediate(resolve));
  }

  if (!iterations || !sourceToggles || !replaySeeks || !workspaceReloads)
    throw new Error('Mixed-use fixture did not exercise every scenario.');
  return Object.freeze({
    durationMs: now() - startedAt,
    iterations,
    sourceToggles,
    replaySeeks,
    imports,
    workspaceReloads,
    archiveCalls: archiveCalls.length,
    archiveFailures,
    cameraRecoveries,
  });
}

if (process.argv[1]?.endsWith('qa-mixed-use-soak.mjs'))
  console.log(
    JSON.stringify(
      await runMixedUseSoak({
        durationMs: argument('--duration-ms', DEFAULT_DURATION_MS),
      }),
      null,
      2,
    ),
  );
