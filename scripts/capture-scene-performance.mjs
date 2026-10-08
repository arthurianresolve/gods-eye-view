#!/usr/bin/env node
/** Capture comparable scene timings from an already running app. */
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';

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
const out = option('--out', null);
const hardwareRequired = args.includes('--hardware-required');

const browser = await puppeteer.launch({
  headless: args.includes('--headless') ? 'new' : false,
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
  const page = await browser.newPage();
  const navigationStart = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__godsEyeView?.viewer, {
    timeout: 90_000,
  });
  const readyMs = Date.now() - navigationStart;
  if (warmupMs) await new Promise((resolve) => setTimeout(resolve, warmupMs));

  await page.evaluate(() => {
    const camera = window.__godsEyeView.viewer.camera;
    window.__gevPerformanceHome = {
      position: camera.position.clone(),
      direction: camera.direction.clone(),
      up: camera.up.clone(),
      transform: camera.transform.clone(),
    };
  });

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
      startup: {
        navigationMs:
          performance.getEntriesByType('navigation')[0]?.duration ?? null,
        appReadyMs: null,
      },
      layers,
      totalObjects: layers.reduce(
        (total, layer) => total + (layer.count || 0),
        0,
      ),
    };
  });
  environment.startup.appReadyMs = readyMs;
  const softwareRenderer =
    /swiftshader|software|llvmpipe|mesa offscreen|angle \(.*software/i.test(
      environment.renderer || '',
    );
  environment.hardwareEligible =
    Boolean(environment.renderer) && !softwareRenderer;

  const captures = [];
  for (const scenario of ['idle', 'scripted-motion']) {
    for (let run = 1; run <= runs; run += 1) {
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
  const report = {
    schema: 'gev-performance-capture/v1',
    capturedAt: new Date().toISOString(),
    url: new URL(url).origin,
    environment,
    workload: {
      warmupMs,
      durationPerSampleMs: seconds * 1000,
      runsPerScenario: runs,
      scenarios: ['idle', 'scripted-motion'],
      injectedDelayMs: delayMs,
      populationStableAcrossSamples: populations.size === 1,
      note: 'Repeat base and candidate with the same browser, renderer, source population, camera path, viewport, warmup and foreground state.',
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
  if (
    maxP95Ms > 0 &&
    captures.some((sample) => sample.frameIntervalMs.p95 > maxP95Ms)
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
