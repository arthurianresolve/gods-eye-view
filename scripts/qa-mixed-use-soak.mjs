#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const DEFAULT_DURATION_MS = 60 * 60_000;

/** Run real component operations in one persistent browser and IndexedDB profile. */
export async function createBrowserSoakDriver(url) {
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (await puppeteer.executablePath()),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => {
      if (errors.length < 8) errors.push(error.message);
    });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const target = new URL(request.url());
      if (
        target.origin !== new URL(url).origin &&
        ['http:', 'https:'].includes(target.protocol)
      )
        void request.abort().catch(() => {});
      else void request.continue().catch(() => {});
    });
    await page.goto(new URL('/src/storage/index.js', url).href);
    await page.setContent(
      '<!doctype html><html><body><section id="evidence"><dl data-evidence-fields></dl><dl data-evidence-technical-fields></dl></section></body></html>',
    );
    await page.evaluate(async () => {
      const { createWorkspaceStorage } = await import('/src/storage/index.js');
      const { createWorkspaceLibrary } =
        await import('/src/workspaces/library.js');
      const {
        createAircraftRecordingService,
        createRecordedAircraftSource,
        createSyntheticAircraftFrames,
        createAircraftSourceRouter,
      } = await import('/src/recording/index.js');
      const { previewGeoJSON } = await import('/src/imports/index.js');
      const { EvidencePanel } = await import('/src/ui/evidencePanel.js');
      const { createArchiveLookup } =
        await import('/src/evidence/archiveLookup.js');
      const { createHealth } = await import('/src/layers/cctv/health.js');
      const { isCameraEligibleForAutoSelection } =
        await import('/src/layers/cctv/healthPolicy.js');
      const { createEvidenceSnapshot } =
        await import('/src/evidence/comparison.js');
      const check = (ok, message) => {
        if (!ok) throw new Error(message);
      };
      const startAt = 1_700_000_000_000;
      const storage = createWorkspaceStorage({
        name: 'gev-soak-' + Date.now(),
      });
      const recorder = createAircraftRecordingService({
        storage,
        now: () => startAt + 180000,
        setInterval: () => 1,
        clearInterval: () => {},
      });
      await recorder.start({
        id: 'recording-synthetic-soak',
        region: { center: { latitude: 0, longitude: 179.7 }, radiusKm: 25 },
      });
      const frames = createSyntheticAircraftFrames({
        startAt,
        sampleCount: 4,
        intervalMs: 60000,
      });
      for (const frame of frames) await recorder.ingest(frame);
      await recorder.stop('fixture-ready');
      const router = createAircraftSourceRouter({
        live: {
          label: 'Synthetic fixture',
          getSnapshot: async () => ({ records: [] }),
        },
        recorded: createRecordedAircraftSource({ storage }),
      });
      const library = createWorkspaceLibrary({ storage });
      const view = {
        camera: { lat: 0, lon: 179.7, altitude_m: 100000 },
        layers: [],
      };
      const saved = await library.save({ title: 'Soak A', view });
      const other = await library.duplicate(saved.document.id, {
        title: 'Soak B',
      });
      const ids = [saved.document.id, other.document.id];
      let outage = false;
      const archive = createArchiveLookup({
        fetchImpl: async () => {
          if (outage)
            return Response.json(
              { state: 'failed', error: 'fixture-outage' },
              { status: 502 },
            );
          return Response.json({ state: 'unavailable' });
        },
      });
      const inspector = new EvidencePanel({
        panel: document.querySelector('#evidence'),
        archiveLookup: archive,
      });
      const healthState = {
        _clientHealthById: new Map(),
        _healthById: new Map(),
      };
      const health = createHealth({
        state: healthState,
        parts: {},
        source: {},
      });
      window.__soakCycle = async (iteration) => {
        const selected = await router.selectRecording(
          'recording-synthetic-soak',
        );
        check(selected.status === 'selected', 'recording not selected');
        router.setTime(startAt + (iteration % 4) * 60000);
        const replay = await router.getSnapshot();
        check(replay.records.length > 0, 'replay seek lost fixture records');
        router.returnLive();
        check(router.getState().mode === 'live', 'source return failed');
        const imported = await previewGeoJSON(
          JSON.stringify({
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                id: 'fixture-point',
                properties: { name: 'Synthetic import' },
                geometry: { type: 'Point', coordinates: [179.7, 0] },
              },
            ],
          }),
          { attribution: 'Synthetic fixture' },
        );
        check(imported.accepted === 1, 'GeoJSON import rejected');
        const id = ids[iteration % 2];
        const record = await library.getWorkspace(id);
        const evidence = {
          entityRef: { layerKey: 'fixture', id: 'point' },
          sourceId: 'synthetic-fixture',
          references: [
            { kind: 'user-linked', url: 'https://example.test/reference' },
          ],
        };
        const snapshot = createEvidenceSnapshot({ records: [evidence] });
        const result = await library.save(
          {
            ...record.document,
            chunks: { imports: [imported] },
            pinnedEvidence: [
              {
                id: 'fixture-evidence',
                sourceId: 'synthetic-fixture',
                capturedAt: Date.now(),
                snapshot,
              },
            ],
          },
          { id, expectedRevision: record.manifest.revision },
        );
        check(result.saved, 'workspace was not persisted');
        const reopened = await library.getWorkspace(id);
        check(
          reopened.chunks.imports[0].records.length === 1,
          'import lost across reopen',
        );
        const bundle = JSON.parse(await library.exportBackup(id));
        check(
          bundle.document.pinnedEvidence[0].snapshot.records[0].record
            .references.length === 1,
          'references lost in export',
        );
        inspector.show({ label: 'Fixture ' + iteration, evidence });
        check(
          document.querySelector('[data-evidence-value="references"] a'),
          'inspector lost reference',
        );
        inspector.clear();
        outage = true;
        let failed = false;
        try {
          await archive.lookup({ url: 'https://example.test/outage' });
        } catch {
          failed = true;
        }
        check(failed, 'archive failure was reported as success');
        outage = false;
        check(
          (await archive.lookup({ url: 'https://example.test/recovery' }))
            .state === 'unavailable',
          'archive recovery failed',
        );
        health.recordClientHealth('camera-a', {
          status: 'failed',
          reasonCode: 'decode-failure',
        });
        check(
          !isCameraEligibleForAutoSelection(
            healthState._healthById.get('camera-a'),
          ),
          'failed camera eligible',
        );
        check(
          isCameraEligibleForAutoSelection(null),
          'unknown alternative excluded',
        );
        health.recordClientHealth('camera-a', {
          status: 'ok',
          reasonCode: 'decode-ok',
        });
        check(
          isCameraEligibleForAutoSelection(
            healthState._healthById.get('camera-a'),
          ),
          'recovered camera excluded',
        );
        return {
          sourceToggles: 2,
          replaySeeks: 1,
          imports: 1,
          workspaceReloads: 1,
          archiveFailures: 1,
          cameraRecoveries: 1,
        };
      };
      window.__soakDispose = () => {
        inspector.destroy();
        router.destroy();
        storage.close?.();
      };
    });
    return {
      browserVersion: await browser.version(),
      async runCycle(iteration) {
        if (errors.length) throw new Error(errors.join('; '));
        return page.evaluate((i) => window.__soakCycle(i), iteration);
      },
      metrics: () => page.metrics(),
      async close() {
        await page.evaluate(() => window.__soakDispose()).catch(() => {});
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** No counters advance until a real operation reports completion. Short runs are smoke tests. */
export async function runMixedUseSoak({
  durationMs = DEFAULT_DURATION_MS,
  now = () => Date.now(),
  driver,
  url = 'http://localhost:4174',
  intervalMs = 250,
  progress = () => {},
} = {}) {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new TypeError('Duration must be positive.');
  const ownsDriver = !driver;
  driver ||= await createBrowserSoakDriver(url);
  const startedAt = now();
  const totals = {
    iterations: 0,
    sourceToggles: 0,
    replaySeeks: 0,
    imports: 0,
    workspaceReloads: 0,
    archiveFailures: 0,
    cameraRecoveries: 0,
  };
  let peakHeapBytes = 0,
    firstMetrics = null,
    lastMetrics = null,
    lastProgress = startedAt;
  try {
    do {
      const result = await driver.runCycle(totals.iterations);
      for (const field of Object.keys(totals).filter(
        (name) => name !== 'iterations',
      )) {
        if (!Number.isInteger(result[field]) || result[field] < 1)
          throw new Error('Soak did not complete ' + field);
        totals[field] += result[field];
      }
      totals.iterations++;
      if (totals.iterations === 1 || totals.iterations % 20 === 0) {
        lastMetrics = (await driver.metrics?.()) || {};
        firstMetrics ||= lastMetrics;
        peakHeapBytes = Math.max(
          peakHeapBytes,
          lastMetrics.JSHeapUsedSize || 0,
        );
      }
      if (now() - lastProgress >= 60000) {
        progress({ elapsedMs: now() - startedAt, ...totals });
        lastProgress = now();
      }
      if (intervalMs)
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (now() - startedAt < durationMs);
    return {
      scope: 'browser-component-fixtures',
      hardwareRenderingValidated: false,
      fullSoak: now() - startedAt >= DEFAULT_DURATION_MS,
      durationMs: now() - startedAt,
      browserVersion: driver.browserVersion || 'test driver',
      ...totals,
      peakHeapBytes,
      firstMetrics,
      lastMetrics,
    };
  } finally {
    if (ownsDriver) await driver.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const value = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1];
  };
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const dirty = () =>
    Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        encoding: 'utf8',
      }).trim(),
    );
  const sourceDirtyAtStart = dirty();
  const report = await runMixedUseSoak({
    durationMs: Number(value('--duration-ms', DEFAULT_DURATION_MS)),
    url: value('--url', 'http://localhost:4174'),
    progress: (report) => console.log(JSON.stringify(report)),
  });
  report.candidateCommit = commit;
  report.sourceDirtyAtStart = sourceDirtyAtStart;
  report.sourceChangedDuringRun =
    dirty() ||
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
      commit;
  const out = value('--out', null);
  if (out) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
    });
  }
  console.log(JSON.stringify(report, null, 2));
}
