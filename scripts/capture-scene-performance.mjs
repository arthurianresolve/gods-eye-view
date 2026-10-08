#!/usr/bin/env node
/** Capture comparable scene timings from an already running app. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { evaluateMotionFrameBudget } from './performance/motionBudget.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const url = option('--url', 'http://localhost:4173');
const seconds = Math.max(1, Number(option('--seconds', '5')) || 5);
const warmupMs = Math.max(0, Number(option('--warmup-ms', '5000')) || 0);
const runs = Math.max(1, Math.min(10, Number(option('--runs', '3')) || 3));
const delayMs = Math.max(0, Number(option('--inject-delay-ms', '0')) || 0);
const maxP95Ms = Number(option('--max-p95-ms', '0')) || 0;
const fixtureAircraftCount = Number(option('--fixture-aircraft', '0'));
const qualityMode = option('--quality-mode', 'manual');
const detectionMode = String(option('--detection-mode', 'DENSE')).toUpperCase();
const mixedLayers = args.includes('--mixed-layers');
const effectiveFixtureAircraftCount =
  fixtureAircraftCount || (mixedLayers ? 2500 : 0);
const startupRuns = Math.max(
  1,
  Math.min(5, Number(option('--startup-runs', String(runs))) || runs),
);
const protocolTimeoutMs = Math.max(
  10_000,
  Math.min(
    600_000,
    Number(option('--protocol-timeout-ms', '300000')) || 300_000,
  ),
);
const fixtureTimeoutMs = Math.max(
  1_000,
  Math.min(180_000, Number(option('--fixture-timeout-ms', '90000')) || 90_000),
);
const out = option('--out', null);
const hardwareRequired = args.includes('--hardware-required');
const appCommitOverride = option('--app-commit', null);
const appWorktreeStateOverride = option('--app-worktree-state', null);
function harnessSourceRevision() {
  try {
    const runGit = (gitArgs) =>
      execFileSync('git', gitArgs, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    return {
      commit: runGit(['rev-parse', 'HEAD']) || null,
      dirtyWorktree: Boolean(runGit(['status', '--porcelain'])),
      reason: null,
    };
  } catch {
    return {
      commit: null,
      dirtyWorktree: null,
      reason: 'Git revision is unavailable outside a readable repository.',
    };
  }
}
const harnessSource = harnessSourceRevision();
const source = {
  harnessCommit: harnessSource.commit,
  harnessDirtyWorktree: harnessSource.dirtyWorktree,
  appCommit: appCommitOverride || harnessSource.commit,
  appWorktreeState:
    appWorktreeStateOverride ||
    (appCommitOverride && appCommitOverride !== harnessSource.commit
      ? 'unknown'
      : harnessSource.dirtyWorktree == null
        ? 'unknown'
        : harnessSource.dirtyWorktree
          ? 'dirty'
          : 'clean'),
  reason: harnessSource.reason,
};
if (
  !Number.isInteger(fixtureAircraftCount) ||
  fixtureAircraftCount < 0 ||
  fixtureAircraftCount > 20_000
)
  throw new Error('--fixture-aircraft must be an integer from 0 to 20000');
if (!['manual', 'auto', 'quality', 'performance'].includes(qualityMode))
  throw new Error(
    '--quality-mode must be manual, auto, quality or performance',
  );
if (!['SPARSE', 'BALANCED', 'DENSE'].includes(detectionMode))
  throw new Error('--detection-mode must be SPARSE, BALANCED or DENSE');

const browser = await puppeteer.launch({
  headless: args.includes('--headless') ? 'new' : false,
  protocolTimeout: protocolTimeoutMs,
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH || (await puppeteer.executablePath()),
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  args: [
    '--window-size=1440,900',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
});

try {
  const startupUrl = new URL(url);
  startupUrl.searchParams.set('welcome', '0');
  const startupSamples = [];
  for (let run = 1; run <= startupRuns; run += 1) {
    process.stdout.write(`[performance] startup ${run}/${startupRuns}\n`);
    const context = await browser.createBrowserContext();
    const startupPage = await context.newPage();
    await startupPage.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
    });
    await startupPage.setCacheEnabled(false);
    const startedAt = Date.now();
    await startupPage.goto(startupUrl.href, { waitUntil: 'domcontentloaded' });
    await startupPage.waitForFunction(() => !!window.__godsEyeView?.viewer, {
      timeout: 90_000,
    });
    const appReadyMs = Date.now() - startedAt;
    await startupPage.waitForFunction(
      () =>
        document.getElementById('loading-screen')?.classList.contains('hidden'),
      { timeout: 90_000 },
    );
    const initialSettleMs = Date.now() - startedAt;
    const details = await startupPage.evaluate(() => {
      const viewer = window.__godsEyeView.viewer;
      const gl =
        viewer.scene.context?._gl ||
        viewer.scene.canvas.getContext('webgl2') ||
        viewer.scene.canvas.getContext('webgl');
      const extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        renderer: extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : gl?.getParameter(gl.RENDERER) || null,
        viewport: {
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        },
        focused: document.hasFocus(),
        visible: !document.hidden,
        navigationMs:
          performance.getEntriesByType('navigation')[0]?.duration ?? null,
        memory: performance.memory
          ? { usedJsHeapBytes: performance.memory.usedJSHeapSize, reason: null }
          : {
              usedJsHeapBytes: null,
              reason: 'performance.memory is unavailable in this browser',
            },
      };
    });
    startupSamples.push({
      run,
      cacheDisabled: true,
      appReadyMs,
      initialSettleMs,
      ...details,
    });
    await context.close();
  }

  process.stdout.write('[performance] preparing measured scene\n');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
    timeout: 90_000,
  });
  const readyMs = Date.now();
  await page.waitForFunction(
    () =>
      document.getElementById('loading-screen')?.classList.contains('hidden'),
    { timeout: 90_000 },
  );
  const mainStartupElapsedMs = Date.now() - readyMs;

  const fixture = effectiveFixtureAircraftCount
    ? await page.evaluate(
        async ({ count, mode, detectionMode }) => {
          const app = window.__godsEyeView;
          const manager = app?.dataManager;
          const entry = manager?.layers?.get('flights');
          if (!entry)
            throw new Error(
              'Aircraft fixture requires the registered flights layer',
            );
          if (!manager.isEnabled('flights'))
            await manager.setEnabled('flights', true);
          const layer = manager.layers.get('flights')?.module;
          const inject = layer?.__focusEvidence?.setAircraft;
          if (typeof inject !== 'function')
            throw new Error(
              'Aircraft fixture injection is available only in a Vite development build',
            );
          const records = Array.from({ length: count }, (_, index) => {
            const angle = index * 2.399963229728653;
            const radius = Math.sqrt((index + 0.5) / count);
            return {
              id: (index + 1).toString(16).padStart(6, '0'),
              callsign: `FX${String(index + 1).padStart(5, '0')}`,
              latitude: 30.2672 + Math.sin(angle) * radius * 0.14,
              longitude: -97.7431 + Math.cos(angle) * radius * 0.18,
              altitudeM: 1_500 + (index % 16) * 850,
              velocityMps: 70 + (index % 90),
              trackDeg: index % 360,
            };
          });
          const result = inject(records);
          if (!result?.ok || result.count !== count)
            throw new Error(
              `Fixture injection failed: ${JSON.stringify(result)}`,
            );
          if (entry.intervalId != null) clearInterval(entry.intervalId);
          entry.intervalId = null;
          const controller = app.styleManager?._adaptiveQuality;
          if (controller && !controller.setMode(mode))
            throw new Error('Presentation quality controller is unavailable');
          if (!controller && mode !== 'manual')
            throw new Error(
              'Auto/Quality/Performance profiles are unavailable in this app revision',
            );
          const services = app.styleManager?.services;
          if (
            typeof services?.setDetectionModeByLabel !== 'function' ||
            typeof services?.getDetectionMode !== 'function' ||
            typeof services?.readDetectionDiagnostics !== 'function'
          )
            throw new Error('Detection workload controls are unavailable');
          services.setDetectionModeByLabel(detectionMode);
          if (services.getDetectionMode() !== detectionMode)
            throw new Error(`Detection mode did not become ${detectionMode}`);
          const viewer = app.viewer;
          const center = { latitude: 30.2672, longitude: -97.7431 };
          const radians = Math.PI / 180;
          const destination =
            viewer.scene.globe.ellipsoid.cartographicToCartesian({
              longitude: center.longitude * radians,
              latitude: center.latitude * radians,
              height: 130_000,
            });
          viewer.camera.cancelFlight?.();
          viewer.camera.setView({
            destination,
            orientation: {
              heading: 0,
              pitch: -Math.PI / 2,
              roll: 0,
            },
          });
          viewer.scene.requestRender();
          return {
            id: 'synthetic-aircraft-ring-v1',
            count,
            center,
            cameraPath: {
              id: 'austin-overhead-v1',
              altitudeM: 130_000,
              headingDeg: 0,
              pitchDeg: -90,
            },
            seed: 1,
            detectionMode,
          };
        },
        {
          count: effectiveFixtureAircraftCount,
          mode: qualityMode,
          detectionMode,
        },
      )
    : null;

  if (fixture) {
    try {
      await page.waitForFunction(
        () => {
          const diagnostics =
            window.__godsEyeView?.styleManager?.services?.readDetectionDiagnostics?.();
          return (
            diagnostics &&
            diagnostics.observationCount > 0 &&
            diagnostics.candidateCount > 0 &&
            Object.values(diagnostics.labelsByLayer || {}).some(
              (count) => count > 0,
            )
          );
        },
        { timeout: fixtureTimeoutMs },
      );
    } catch (error) {
      const diagnostics = await page
        .evaluate(() => {
          const app = window.__godsEyeView;
          const camera = app?.viewer?.camera;
          const position = camera?.positionCartographic;
          return {
            detection:
              app?.styleManager?.services?.readDetectionDiagnostics?.() ?? null,
            camera: position
              ? {
                  latitudeDeg: (position.latitude * 180) / Math.PI,
                  longitudeDeg: (position.longitude * 180) / Math.PI,
                  heightM: position.height,
                  pitchDeg: (camera.pitch * 180) / Math.PI,
                }
              : null,
          };
        })
        .catch(() => null);
      throw new Error(
        `Aircraft fixture did not produce visible labels within ${fixtureTimeoutMs} ms; diagnostics=${JSON.stringify(diagnostics)}`,
        { cause: error },
      );
    }
  }

  const mixedLayerFixture = mixedLayers
    ? await page.evaluate(async () => {
        const manager = window.__godsEyeView?.dataManager;
        if (!manager)
          throw new Error('Mixed-layer fixture needs the data manager');
        const ids = ['local-datacenters', 'local-dams'];
        for (const id of ids) {
          if (!manager.layers?.has(id))
            throw new Error(`Mixed-layer fixture is missing ${id}`);
          if (!manager.isEnabled(id)) await manager.setEnabled(id, true);
        }
        return ids;
      })
    : null;
  if (mixedLayerFixture) {
    await page.waitForFunction(
      (ids) =>
        ids.every((id) => {
          const layer = window.__godsEyeView?.dataManager
            ?.getAll?.()
            ?.find((entry) => entry.id === id);
          return Number.isFinite(layer?.stats?.count) && layer.stats.count > 0;
        }),
      { timeout: 90_000 },
      mixedLayerFixture,
    );
  }
  if (!fixture) {
    const modeSet = await page.evaluate((mode) => {
      const controller = window.__godsEyeView?.styleManager?._adaptiveQuality;
      return controller?.setMode(mode) || false;
    }, qualityMode);
    if (!modeSet)
      throw new Error('Presentation quality controller is unavailable');
  }

  await page.evaluate(() => {
    const camera = window.__godsEyeView.viewer.camera;
    window.__gevPerformanceHome = {
      position: camera.position.clone(),
      direction: camera.direction.clone(),
      up: camera.up.clone(),
      transform: camera.transform.clone(),
    };
  });
  if (warmupMs) {
    await page.evaluate(() =>
      window.__godsEyeView.viewer.scene.requestRender(),
    );
    await new Promise((resolve) => setTimeout(resolve, warmupMs));
  }

  const environment = await page.evaluate(() => {
    const viewer = window.__godsEyeView.viewer;
    const canvas = viewer.scene.canvas;
    const gl =
      viewer.scene.context?._gl ||
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl?.getParameter(gl.RENDERER) || null;
    const layers = (window.__godsEyeView.dataManager?.getAll?.() || []).map(
      (layer) => ({
        id: layer.id,
        enabled: Boolean(layer.enabled),
        count: Number.isFinite(layer.stats?.count) ? layer.stats.count : null,
      }),
    );
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      renderer,
      vendor: extension
        ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
        : gl?.getParameter(gl.VENDOR) || null,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      focused: document.hasFocus(),
      visible: !document.hidden,
      layers,
      totalObjects: layers.reduce(
        (total, layer) => total + (layer.count || 0),
        0,
      ),
    };
  });
  environment.startup = {
    runs: startupSamples,
    runCount: startupSamples.length,
    measurement: 'cache-disabled fresh browser contexts',
    performancePageInitialSettleMs: mainStartupElapsedMs,
  };
  const softwareRenderer =
    /swiftshader|software|llvmpipe|mesa offscreen|angle \(.*software/i.test(
      environment.renderer || '',
    );
  environment.hardwareEligible =
    Boolean(environment.renderer) && !softwareRenderer;

  const captures = [];
  for (const scenario of ['idle', 'scripted-motion']) {
    for (let run = 1; run <= runs; run += 1) {
      process.stdout.write(`[performance] ${scenario} ${run}/${runs}\n`);
      const sample = await page.evaluate(
        async ({ durationMs, scenarioName, delay }) => {
          const viewer = window.__godsEyeView.viewer;
          const scene = viewer.scene;
          const home = window.__gevPerformanceHome;
          viewer.camera.setView({
            destination: home.position,
            orientation: { direction: home.direction, up: home.up },
            endTransform: home.transform,
          });
          const intervals = [];
          const longTasks = [];
          let previous = null;
          const onRender = () => {
            const now = performance.now();
            if (previous != null) intervals.push(now - previous);
            previous = now;
          };
          scene.postRender.addEventListener(onRender);
          let observer = null;
          if (typeof PerformanceObserver !== 'undefined') {
            try {
              observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries())
                  longTasks.push(entry.duration);
              });
              observer.observe({ type: 'longtask', buffered: false });
            } catch {
              observer = null;
            }
          }
          let active = true;
          let moveTimer = null;
          let delayTimer = null;
          if (scenarioName === 'scripted-motion') {
            moveTimer = setInterval(() => {
              if (active) viewer.camera.moveRight(16);
            }, 50);
          }
          if (delay > 0) {
            delayTimer = setInterval(() => {
              const start = performance.now();
              while (performance.now() - start < delay) {}
            }, 1000);
          }
          const startedAt = performance.now();
          await new Promise((resolve) => setTimeout(resolve, durationMs));
          active = false;
          clearInterval(moveTimer);
          clearInterval(delayTimer);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const renderCount = intervals.length;
          const sorted = [...intervals].sort((a, b) => a - b);
          const pick = (p) =>
            sorted.length
              ? sorted[
                  Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)
                ]
              : null;
          const memory = performance.memory
            ? { usedJsHeapBytes: performance.memory.usedJSHeapSize }
            : {
                usedJsHeapBytes: null,
                reason: 'performance.memory is unavailable in this browser',
              };
          const counts = (
            window.__godsEyeView.dataManager?.getAll?.() || []
          ).map((layer) => ({
            id: layer.id,
            enabled: Boolean(layer.enabled),
            count: Number.isFinite(layer.stats?.count)
              ? layer.stats.count
              : null,
          }));
          const detectionDiagnostics =
            window.__godsEyeView?.styleManager?.services?.readDetectionDiagnostics?.();
          observer
            ?.takeRecords?.()
            .forEach((entry) => longTasks.push(entry.duration));
          observer?.disconnect();
          scene.postRender.removeEventListener(onRender);
          return {
            durationMs: performance.now() - startedAt,
            frameCount: renderCount,
            frameIntervalMs: {
              p50: pick(0.5),
              p95: pick(0.95),
              max: sorted.at(-1) ?? null,
              samples: sorted.length,
              reason: sorted.length
                ? null
                : 'no scene postRender samples in this window',
            },
            longTasks: {
              count: longTasks.length,
              maxMs: longTasks.length ? Math.max(...longTasks) : null,
            },
            memory,
            layers: counts,
            totalObjects: counts.reduce(
              (total, layer) => total + (layer.count || 0),
              0,
            ),
            focused: document.hasFocus(),
            visible: !document.hidden,
            injectedDelayMs: delay || 0,
            quality: {
              mode:
                window.__godsEyeView?.styleManager?._adaptiveQuality?.getMode() ||
                null,
              densityPct:
                window.__godsEyeView?.styleManager?.services?.getDetectionTuning?.()
                  ?.densityPct ?? null,
              p95FrameMs:
                window.__godsEyeView?.styleManager?._adaptiveQuality?.policy
                  ?.lastP95Ms ?? null,
            },
            detection: detectionDiagnostics
              ? {
                  mode: detectionDiagnostics.profile,
                  densityPct: detectionDiagnostics.densityPct,
                  observationCount: detectionDiagnostics.observationCount,
                  candidateCount: detectionDiagnostics.candidateCount,
                  selectedCount: detectionDiagnostics.selectedCount,
                  visibleCount: detectionDiagnostics.visibleCount,
                  protectedVisibleCount:
                    detectionDiagnostics.protectedVisibleCount,
                  labelsByLayer: detectionDiagnostics.labelsByLayer,
                }
              : {
                  mode: null,
                  observationCount: null,
                  candidateCount: null,
                  reason: 'detection diagnostics are unavailable',
                },
          };
        },
        { durationMs: seconds * 1000, scenarioName: scenario, delay: delayMs },
      );
      captures.push({ scenario, run, ...sample });
    }
  }

  const populations = new Set(
    captures.map((sample) => JSON.stringify(sample.layers)),
  );
  const motionBudget = evaluateMotionFrameBudget(captures, maxP95Ms);
  const report = {
    schema: 'gev-performance-capture/v1',
    capturedAt: new Date().toISOString(),
    source,
    url: new URL(url).origin,
    environment,
    workload: {
      warmupMs,
      durationPerSampleMs: seconds * 1000,
      runsPerScenario: runs,
      startupRuns: startupSamples.length,
      scenarios: ['idle', 'scripted-motion'],
      fixture,
      mixedLayers: mixedLayerFixture,
      qualityMode,
      detectionMode: fixture ? detectionMode : null,
      injectedDelayMs: delayMs,
      populationStableAcrossSamples: populations.size === 1,
      note: 'Repeat base and candidate with the same browser, renderer, source population, camera path, viewport, warmup and foreground state.',
    },
    motionBudget: {
      ...motionBudget,
      note: 'Idle rendering is intentionally sparse and is excluded from motion frame budgets.',
    },
    captures,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (out) {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fs.writeFile(out, json, 'utf8');
    process.stdout.write(`Wrote ${path.resolve(out)}\n`);
  } else {
    process.stdout.write(json);
  }
  if (hardwareRequired && !environment.hardwareEligible) process.exitCode = 2;
  // Idle governor frames are intentionally sparse and are not a motion
  // performance failure. Apply an explicit frame budget only to the moving
  // workload, as required by the performance acceptance contract.
  if (motionBudget.status === 'failed' || motionBudget.status === 'incomplete')
    process.exitCode = 1;
} finally {
  await browser.close();
}
