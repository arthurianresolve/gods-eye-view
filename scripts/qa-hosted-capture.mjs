import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

if (process.env.GITHUB_ACTIONS !== 'true')
  throw new Error(
    'Run this hosted-renderer probe in GitHub Actions. Local Chrome validation uses the visible fixture.',
  );
const commit = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(commit || ''))
  throw new Error('Exact source revision required');
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    '--host',
    '127.0.0.1',
    '--port',
    '4184',
    '--strictPort',
  ],
  {
    env: { ...process.env, GEV_APP_COMMIT: commit },
    stdio: ['ignore', 'ignore', 'ignore'],
  },
);
let serverError = null;
server.on('error', (error) => {
  serverError = error;
});
const url = 'http://127.0.0.1:4184/scripts/fixtures/capture-matrix.html';
let browser;
const report = {
  schema: 'gev-hosted-native-renderer/v1',
  commit,
  platform: process.platform,
  timestamp: new Date().toISOString(),
  status: 'pending',
  hardwareRenderingAvailable: false,
  captureMatrix: null,
};
try {
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (serverError) throw serverError;
    if (server.exitCode !== null)
      throw new Error(`Fixture server exited ${server.exitCode}`);
    if (
      await fetch(url)
        .then((response) => response.ok)
        .catch(() => false)
    )
      break;
    if (Date.now() > deadline) throw new Error('Fixture server timeout');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
    timeout: 30_000,
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0' });
  report.webglAvailable = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const available = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return available;
  });
  if (!report.webglAvailable) {
    report.reason =
      'Standard runner exposes no WebGL 2 context; hardware evidence remains pending.';
  } else {
    await page.click('#run');
    await page.waitForFunction(
      () => document.querySelector('#result')?.textContent,
      { timeout: 30_000 },
    );
    const matrix = await page.$eval('#result', (element) =>
      JSON.parse(element.textContent),
    );
    if (matrix.applicationCommit !== commit)
      throw new Error('Capture matrix served wrong revision');
    report.captureMatrix = matrix;
    if (
      matrix.status !== 'passed' ||
      matrix.checks?.length !== 12 ||
      matrix.checks.some((check) => check.status !== 'passed')
    )
      throw new Error(
        `Capture correctness failed: ${matrix.error || 'incomplete checks'}`,
      );
    const renderers =
      matrix.environments?.map((environment) => environment.renderer) || [];
    report.hardwareRenderingAvailable =
      renderers.length === 2 &&
      renderers.every(
        (renderer) =>
          /Intel|NVIDIA|AMD|Apple|Radeon/i.test(renderer || '') &&
          !/SwiftShader|llvmpipe|software|basic render|virtual/i.test(renderer),
      );
    report.status = report.hardwareRenderingAvailable
      ? matrix.status
      : 'pending';
    report.reason = report.hardwareRenderingAvailable
      ? 'Native renderer observed; full hardware workloads and soak still required.'
      : 'Standard runner did not expose a verified hardware renderer. Software capture checks do not complete hardware acceptance.';
  }
} catch (error) {
  report.status = 'failed';
  report.reason = `Native renderer probe failed: ${error.message}`;
  process.exitCode = 1;
} finally {
  await browser?.close().catch((error) => {
    report.status = 'failed';
    report.cleanupError = error.message;
    process.exitCode = 1;
  });
  server.kill();
  console.log('QA_EVIDENCE_BEGIN hosted-native-renderer');
  console.log(JSON.stringify(report));
  console.log('QA_EVIDENCE_END hosted-native-renderer');
}
