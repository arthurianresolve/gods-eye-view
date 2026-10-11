import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
  readHostEnvironment,
} from './performance/rendererEvidence.mjs';
import { interceptFixtureSession } from './performance/fixtureInterception.mjs';
import {
  closeRecoveryBrowser,
  stopOwnedRecoveryProcessTree,
} from './performance/profileRecoveryPageOwnership.mjs';
import {
  validateFleetComparison,
  validateFleetRepeat,
  validateFleetEmptyLifecycle,
} from './performance/fleetComparison.mjs';
import { summarizeFleetTiming } from './performance/fleetTiming.mjs';

// A local user's Chrome is controlled exclusively through the visible browser
// tool. This driver owns only the disposable browser in a standard hosted job.
if (process.env.GITHUB_ACTIONS !== 'true')
  throw new Error(
    'Run the comparison in GitHub Actions; use the visible fixture locally.',
  );
const BASELINE = 'e6ab561ad0e77a49219627e97573199f1db0af62';
const git = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = [
  'scripts/fixtures/fleet-render-demand.html',
  'scripts/fixtures/fleet-render-demand.mjs',
  'scripts/fixtures/fleet-draw-state.mjs',
  'scripts/fixtures/fleet-empty-lifecycle.mjs',
  'scripts/fixtures/fleet-program-state.mjs',
  'scripts/fixtures/fleet-timing-trace.mjs',
];

if (process.argv[2] === '--serve') {
  const [root, commit, port, cacheDir] = process.argv.slice(3);
  if (git(root, ['rev-parse', 'HEAD']) !== commit)
    throw new Error('Wrong server source checkout');
  process.chdir(root);
  const { createBrowserViteConfig } = await import(
    pathToFileURL(path.join(root, 'build/vite.js'))
  );
  const config = createBrowserViteConfig({
    appCommit: commit,
    host: '127.0.0.1',
    port,
    command: 'serve',
  });
  const server = await createServer({
    ...config,
    root,
    configFile: false,
    cacheDir,
    server: {
      ...config.server,
      strictPort: true,
      fs: {
        ...config.server.fs,
        allow: [
          root,
          path.dirname(fileURLToPath(import.meta.url)),
          path.dirname(fileURLToPath(import.meta.url)) + '/../node_modules',
        ],
      },
    },
  });
  await server.listen();
  process.send?.({ ready: true });
  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
} else {
  const candidateRoot = await realpath(path.resolve('.'));
  const candidate = git(candidateRoot, ['rev-parse', 'HEAD']);
  const diagnosticOnly = process.env.FLEET_TIMING_DIAGNOSTIC === '1';
  const extendedCadence = process.env.FLEET_EXTENDED === '1';
  if (diagnosticOnly && extendedCadence)
    throw new Error(
      'Extended acceptance cadence cannot include timing instrumentation.',
    );
  if (!/^[a-f0-9]{40}$/.test(candidate) || candidate !== process.env.GITHUB_SHA)
    throw new Error('Candidate must equal the immutable workflow revision');
  if (git(candidateRoot, ['status', '--porcelain', '--untracked-files=no']))
    throw new Error('Candidate tracked source is dirty');
  // macOS aliases /var to /private/var. Vite resolves module IDs to real paths;
  // its fs allowlist must use the same canonical checkout path.
  const ownedDirectory = await realpath(
    await mkdtemp(path.join(tmpdir(), 'gev-fleet-pair-')),
  );
  const baselineRoot = path.join(ownedDirectory, 'baseline');
  const script = fileURLToPath(import.meta.url);
  const servers = [];
  let browser,
    worktreeAdded = false;
  const report = {
    schema: diagnosticOnly
      ? 'gev-hosted-fleet-timing/v1'
      : extendedCadence
        ? 'gev-hosted-fleet-component-extended/v1'
        : 'gev-hosted-fleet-comparison/v1',
    diagnosticOnly,
    ...(extendedCadence
      ? {
          protocol: {
            id: 'gev-s51-component-cadence/v1',
            warmupMs: 30000,
            measurementMs: 60000,
            repeatPairs: 5,
            scope:
              '20-aircraft component evidence; not S47 full-application acceptance',
            instrumentedTimingTrace: false,
          },
        }
      : {}),
    baseline: BASELINE,
    candidate,
    harness: candidate,
    status: 'running',
    timestamp: new Date().toISOString(),
    environment: readHostEnvironment(),
    pairs: [],
    baselineRepeat: [],
    fixtureHashes: {},
    sourceHashes: {},
    serverErrors: [],
    scope: diagnosticOnly
      ? 'Instrumented timer and CPU attribution only. No latency, visual-equivalence or performance acceptance claim. Both revisions use common candidate dependencies.'
      : extendedCadence
        ? 'Unprofiled 20-aircraft component comparison: exact fixed-time pixels plus five alternating 30-second warmup/60-second cadence pairs. Not S47 full-application, dense-load, or physical-hardware acceptance.'
        : 'Actual fleet layers: fixed-time pixel/position equivalence and real-time untracked render cadence. Hosted acceleration is not physical desktop evidence or full-app motion-p95 acceptance.',
  };
  async function persistReport() {
    await mkdir('qa-artifacts', { recursive: true });
    const temporary = 'qa-artifacts/fleet-render-demand.json.tmp';
    await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
    await rename(temporary, 'qa-artifacts/fleet-render-demand.json');
  }
  async function startServer(root, commit, port, label) {
    const child = spawn(
      process.execPath,
      [
        script,
        '--serve',
        root,
        commit,
        String(port),
        path.join(ownedDirectory, `cache-${label}`),
      ],
      {
        cwd: root,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, GEV_APP_COMMIT: commit },
      },
    );
    servers.push(child);
    child.stderr.on('data', (data) => {
      if (report.serverErrors.length < 30)
        report.serverErrors.push({
          label,
          message: String(data).slice(0, 1000),
        });
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} fixture server timed out`)),
        90000,
      );
      child.once('message', (message) => {
        if (message?.ready) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`${label} server exited ${code}`));
      });
    });
    return `http://127.0.0.1:${port}`;
  }
  async function sample(base, implementation, commit, mode) {
    report.currentSample = { implementation, commit, mode };
    // Keep completed observations even if the hosted job is interrupted during
    // a later sample. A checkpoint remains running and cannot imply acceptance.
    await persistReport();
    const page = await browser.newPage();
    let session;
    const errors = [];
    const failedResponses = [];
    try {
      await page.setViewport({ width: 960, height: 640, deviceScaleFactor: 1 });
      page.on('pageerror', (error) =>
        errors.push(String(error.message).slice(0, 500)),
      );
      page.on('response', (response) => {
        if (response.status() >= 400 && failedResponses.length < 20)
          failedResponses.push({
            path: new URL(response.url()).pathname,
            status: response.status(),
          });
      });
      session = await page.createCDPSession();
      await interceptFixtureSession(session, base, null, (error) =>
        errors.push(String(error.message).slice(0, 500)),
      );
      const query = new URLSearchParams({
        implementation,
        appCommit: commit,
        harness: candidate,
        mode,
      });
      await page.goto(
        `${base}/scripts/fixtures/fleet-render-demand.html?${query}`,
        { waitUntil: 'networkidle0', timeout: 60000 },
      );
      await page.waitForSelector('#run:not([disabled])', { timeout: 15000 });
      await page.click('#run');
      await page.waitForFunction(
        () => document.querySelector('#result')?.textContent,
        // Cold model readiness has its own bounded phases in the fixture.
        // This transport deadline is not a frame-delivery/performance gate.
        { timeout: 300000, polling: 100 },
      );
      const result = await page.$eval('#result', (element) =>
        JSON.parse(element.textContent),
      );
      result.pageErrors = errors;
      return result;
    } catch (error) {
      report.failedSample = {
        implementation,
        mode,
        pageErrors: errors,
        failedResponses,
        statusText: await page
          .$eval('#status', (element) => element.textContent)
          .catch(() => null),
      };
      throw error;
    } finally {
      // Complete page teardown before disposing the browser; never leave a
      // renderer waiting for a detached interception session.
      await session?.send('Fetch.disable').catch(() => {});
      await page.close({ runBeforeUnload: false });
      await session?.detach().catch(() => {});
    }
  }
  try {
    git(candidateRoot, [
      'fetch',
      '--no-tags',
      'https://github.com/arthurianresolve/gods-eye-view.git',
      BASELINE,
    ]);
    git(candidateRoot, ['worktree', 'add', '--detach', baselineRoot, BASELINE]);
    worktreeAdded = true;
    const lock = await readFile(path.join(candidateRoot, 'package-lock.json'));
    if (
      hash(lock) !==
      hash(await readFile(path.join(baselineRoot, 'package-lock.json')))
    )
      throw new Error('Comparison requires identical locked dependencies');
    report.lockfileSha256 = hash(lock);
    await symlink(
      path.join(candidateRoot, 'node_modules'),
      path.join(baselineRoot, 'node_modules'),
      'dir',
    );
    for (const file of files) {
      await cp(path.join(candidateRoot, file), path.join(baselineRoot, file));
      report.fixtureHashes[file] = hash(
        await readFile(path.join(candidateRoot, file)),
      );
      if (
        report.fixtureHashes[file] !==
        hash(await readFile(path.join(baselineRoot, file)))
      )
        throw new Error('Fixture copy differs');
    }
    for (const [label, root] of Object.entries({
      baseline: baselineRoot,
      candidate: candidateRoot,
    })) {
      report.sourceHashes[label] = {};
      // Hash the complete tracked runtime, not just the proposed helper.
      for (const file of git(root, [
        'ls-files',
        'src',
        'build',
        'public/models',
        'patches',
        'scripts/apply-cesium-patches.mjs',
      ])
        .split('\n')
        .filter(Boolean))
        report.sourceHashes[label][file] = hash(
          await readFile(path.join(root, file)),
        );
    }
    // Both Vite checkouts use the same dependency directory. Record the actual
    // engine bytes, including local pinned corrections, rather than implying
    // that a matching package lock proves an identical installed engine.
    const inertiaManifest = JSON.parse(
      await readFile('patches/cesium-1.138.0-inertia.json', 'utf8'),
    );
    report.sharedDependencies = {
      scope:
        'Both source revisions use this installed dependency set from the candidate checkout; patch source identities for each revision are recorded separately in sourceHashes.',
      cesiumVersion: JSON.parse(
        await readFile('node_modules/cesium/package.json', 'utf8'),
      ).version,
      engineVersion: JSON.parse(
        await readFile('node_modules/@cesium/engine/package.json', 'utf8'),
      ).version,
      files: {},
    };
    for (const { relativePath } of inertiaManifest.files) {
      report.sharedDependencies.files[relativePath] = hash(
        await readFile(path.join(candidateRoot, 'node_modules', relativePath)),
      );
    }
    const baselineUrl = await startServer(
      baselineRoot,
      BASELINE,
      4185,
      'baseline',
    );
    const candidateUrl = await startServer(
      candidateRoot,
      candidate,
      4186,
      'candidate',
    );
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
      timeout: 30000,
    });
    report.browserVersion = await browser.version();
    report.graphics = await readBrowserGraphicsInfo(browser);
    if (diagnosticOnly) {
      report.diagnosticPairs = [];
      for (let i = 0; i < 2; i++) {
        const pair = {
          pair: i + 1,
          order: i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
          samples: {},
          summaries: {},
        };
        report.diagnosticPairs.push(pair);
        for (const implementation of pair.order) {
          const commit = implementation === 'baseline' ? BASELINE : candidate;
          const result = await sample(
            implementation === 'baseline' ? baselineUrl : candidateUrl,
            implementation,
            commit,
            'cadence-diagnostic',
          );
          pair.samples[implementation] = result;
          await persistReport();
          if (
            result.status !== 'passed' ||
            result.pageErrors.length ||
            result.applicationCommit !== commit ||
            result.harnessCommit !== candidate
          )
            throw new Error(
              `${implementation}: timing fixture failed or source identity differs`,
            );
          if (result.mode !== 'cadence-diagnostic')
            throw new Error('Wrong timing diagnostic mode');
          report.rendering = classifyRenderer(
            result.settings?.environment?.renderer,
            report.graphics,
          );
          if (!report.rendering.accelerationVerified)
            throw new Error('Hosted accelerated rendering is unavailable');
          pair.summaries[implementation] = summarizeFleetTiming(
            result.timingTrace,
          );
        }
      }
    } else {
      report.emptyLifecycle = await sample(
        candidateUrl,
        'candidate',
        candidate,
        'empty-lifecycle',
      );
      try {
        report.emptyLifecycleValidation = validateFleetEmptyLifecycle(
          report.emptyLifecycle,
          report,
        );
      } catch (error) {
        // Independent lifecycle evidence must not suppress the baseline draw
        // diagnosis. A failed lifecycle still prevents overall acceptance.
        report.emptyLifecycleValidation = {
          status: 'failed',
          error: String(error.stack || error).slice(0, 2000),
        };
      }
      // Prove the fixed-time protocol can reproduce the unchanged baseline
      // before spending time on candidate comparisons or drawing conclusions.
      for (let i = 0; i < 2; i++) {
        const result = await sample(
          baselineUrl,
          'baseline',
          BASELINE,
          'correctness',
        );
        report.baselineRepeat.push(result);
        await persistReport();
        if (result.status !== 'passed' || result.pageErrors.length)
          throw new Error(
            `Baseline repeat ${i + 1}: ${result.error || 'fixture failed'}`,
          );
      }
      report.baselineRepeatValidation = await validateFleetRepeat(
        ...report.baselineRepeat,
        report,
      );
      for (let i = 0; i < 5; i++) {
        const pair = {
          pair: i + 1,
          order: i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
          correctness: {},
          cadence: {},
        };
        report.pairs.push(pair);
        for (const [slot, mode] of [
          ['correctness', 'correctness'],
          ['cadence', extendedCadence ? 'cadence-extended' : 'cadence'],
        ]) {
          for (const implementation of pair.order) {
            const result = await sample(
              implementation === 'baseline' ? baselineUrl : candidateUrl,
              implementation,
              implementation === 'baseline' ? BASELINE : candidate,
              mode,
            );
            pair[slot][implementation] = result;
            await persistReport();
            if (result.status !== 'passed' || result.pageErrors.length)
              throw new Error(
                `${implementation}/${mode}: ${result.error || result.pageErrors.join('; ') || 'fixture failed'}`,
              );
            const renderer = classifyRenderer(
              result.settings?.environment?.renderer,
              report.graphics,
            );
            report.rendering = renderer;
            if (!renderer.accelerationVerified)
              throw new Error('Hosted accelerated rendering is unavailable');
          }
        }
        process.stdout.write(`Completed actual-source fleet pair ${i + 1}/5\n`);
      }
      report.comparison = await validateFleetComparison(report);
      if (report.emptyLifecycleValidation.status !== 'passed')
        throw new Error('Empty fleet lifecycle validation failed');
    }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = String(error.stack || error).slice(0, 4000);
  } finally {
    if (browser) {
      report.browserCleanup = await closeRecoveryBrowser(browser, {
        timeoutMs: 5000,
        forceProcess: () => stopOwnedRecoveryProcessTree(browser.process()),
      });
      if (!report.browserCleanup.closeCompleted) report.status = 'failed';
    }
    report.serverCleanup = [];
    for (const child of servers)
      report.serverCleanup.push(await stopOwnedRecoveryProcessTree(child));
    const serversStopped = report.serverCleanup.every(
      (result) => result.confirmed,
    );
    if (!serversStopped) report.status = 'failed';
    if (worktreeAdded && serversStopped) {
      // The only extra files are our two fixtures and dependency symlink in
      // this mkdtemp-owned checkout. No user checkout is removed.
      try {
        git(candidateRoot, ['worktree', 'remove', '--force', baselineRoot]);
      } catch (error) {
        report.worktreeCleanupError = String(error.message).slice(0, 500);
        report.status = 'failed';
      }
    }
    if (serversStopped && !report.worktreeCleanupError) {
      const relative = path.relative(await realpath(tmpdir()), ownedDirectory);
      if (
        !relative.startsWith('gev-fleet-pair-') ||
        relative.includes(path.sep)
      )
        throw new Error(
          'Owned temporary directory escaped its expected parent',
        );
      await rm(ownedDirectory, { recursive: true });
      report.temporaryDirectoryRemoved = true;
    }
    await persistReport();
    process.stdout.write(
      `QA_EVIDENCE_BEGIN fleet-render-demand\n${JSON.stringify(report, null, 2)}\nQA_EVIDENCE_END fleet-render-demand\n`,
    );
    if (report.status !== 'passed') process.exitCode = 1;
  }
}
