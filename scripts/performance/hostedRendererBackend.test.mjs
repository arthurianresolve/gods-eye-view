import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCaptureFailureReport } from './captureFailureReport.mjs';
import {
  assertVerifiedNativeRendererEvidence,
  captureCliRendererArgs,
  DEFAULT_CAPTURE_RENDERER_BACKEND,
  nativeRendererDiagnosticEvidence,
  NATIVE_MACOS_DIAGNOSTIC_BACKEND,
  rendererLaunchArgs,
  validateNativeRendererDiagnosticHost,
} from './hostedRendererBackend.mjs';

const metalRenderer =
  'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
const virtualMetalRenderer =
  'ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)';
const enabledGraphics = {
  featureStatus: {
    webgl: 'enabled',
    webgl2: 'enabled',
    gpu_compositing: 'enabled',
    opengl: 'enabled_on',
  },
  devices: [{ vendor: 'Apple', device: 'Apple M2', driver: 'fixture' }],
};

test('backend defaults preserve SwiftShader and ordinary hardware launch arguments', () => {
  assert.equal(DEFAULT_CAPTURE_RENDERER_BACKEND, 'swiftshader');
  assert.deepEqual(rendererLaunchArgs(), [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ]);
  assert.deepEqual(rendererLaunchArgs(null), []);
  assert.deepEqual(rendererLaunchArgs(NATIVE_MACOS_DIAGNOSTIC_BACKEND), []);
  assert.deepEqual(captureCliRendererArgs(), ['--software-rendering']);
  assert.deepEqual(captureCliRendererArgs(NATIVE_MACOS_DIAGNOSTIC_BACKEND), [
    '--native-rendering-diagnostic',
  ]);
});

test('native diagnostic host guard permits only GitHub Actions macOS', () => {
  assert.equal(
    validateNativeRendererDiagnosticHost({
      platform: 'darwin',
      githubActions: 'true',
    }),
    true,
  );
  for (const host of [
    { platform: 'linux', githubActions: 'true' },
    { platform: 'win32', githubActions: 'true' },
    { platform: 'darwin', githubActions: 'false' },
    { platform: 'darwin', githubActions: null },
  ])
    assert.throws(
      () => validateNativeRendererDiagnosticHost(host),
      /GitHub Actions macOS/,
    );
  if (process.platform === 'darwin' && process.env.GITHUB_ACTIONS === 'true')
    assert.equal(validateNativeRendererDiagnosticHost(), true);
  else
    assert.throws(
      () => validateNativeRendererDiagnosticHost(),
      /GitHub Actions macOS/,
    );
});

test('capture child rejects native mode on this host before launching Chrome', () => {
  const script = fileURLToPath(
    new URL('../capture-scene-performance.mjs', import.meta.url),
  );
  const child = spawnSync(
    process.execPath,
    [script, '--native-rendering-diagnostic', '--headless'],
    {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: 'false' },
    },
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /only on a GitHub Actions macOS runner/);
});

test('native evidence accepts verified Metal and labels hosted coverage nonphysical', () => {
  for (const renderer of [metalRenderer, virtualMetalRenderer]) {
    const evidence = nativeRendererDiagnosticEvidence({
      renderer,
      graphics: enabledGraphics,
    });
    assert.equal(evidence.status, 'verified');
    assert.equal(evidence.accelerationVerified, true);
    assert.equal(evidence.physicalDesktopCoverage, false);
    assert.equal(evidence.comparisonEligible, false);
    assert.equal(evidence.performanceAcceptanceEligible, false);
    assert.deepEqual(evidence.featureStatus, enabledGraphics.featureStatus);
    assert.equal(
      assertVerifiedNativeRendererEvidence(
        evidence,
        renderer,
        evidence.observedWebglVendor,
      ),
      evidence,
    );
  }
});

test('native evidence rejects software, unknown, absent and contradictory graphics', () => {
  const invalid = [
    nativeRendererDiagnosticEvidence({
      renderer: 'Google SwiftShader',
      graphics: enabledGraphics,
    }),
    nativeRendererDiagnosticEvidence({
      renderer: 'ANGLE (Unknown Vendor, Unknown Renderer)',
      graphics: enabledGraphics,
    }),
    nativeRendererDiagnosticEvidence({
      renderer: metalRenderer,
      graphics: null,
    }),
    nativeRendererDiagnosticEvidence({
      renderer: metalRenderer,
      graphics: { featureStatus: { webgl: 'disabled' } },
    }),
  ];
  for (const evidence of invalid)
    assert.throws(
      () =>
        assertVerifiedNativeRendererEvidence(
          evidence,
          evidence.observedRenderer,
          evidence.observedWebglVendor,
        ),
      /accelerated graphics/,
    );
  assert.ok(invalid.every((evidence) => evidence.status === 'unverified'));
  const forged = nativeRendererDiagnosticEvidence({
    renderer: metalRenderer,
    graphics: enabledGraphics,
  });
  forged.observedRenderer = 'Google SwiftShader';
  assert.throws(
    () =>
      assertVerifiedNativeRendererEvidence(
        forged,
        'Google SwiftShader',
        forged.observedWebglVendor,
      ),
    /accelerated graphics/,
  );
  const mismatchedCapture = nativeRendererDiagnosticEvidence({
    renderer: metalRenderer,
    graphics: enabledGraphics,
  });
  assert.throws(
    () =>
      assertVerifiedNativeRendererEvidence(
        mismatchedCapture,
        'different',
        mismatchedCapture.observedWebglVendor,
      ),
    /accelerated graphics/,
  );
});

test('unverified native renderer evidence remains in bounded failed-capture metadata', () => {
  const evidence = nativeRendererDiagnosticEvidence({
    renderer: 'Google SwiftShader',
    vendor: 'Google Inc.',
    graphics: { featureStatus: { webgl: 'enabled' } },
  });
  const report = createCaptureFailureReport({
    source: null,
    fixture: null,
    workload: { nativeRendererDiagnostic: evidence },
    phase: 'native-renderer-verification',
    error: new Error('Native renderer was not verified.'),
  });
  assert.equal(report.comparisonEligible, false);
  assert.deepEqual(report.workload.nativeRendererDiagnostic, evidence);
  assert.equal(report.failure.phase, 'native-renderer-verification');
});
