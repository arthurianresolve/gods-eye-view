import { classifyRenderer } from './rendererEvidence.mjs';

export const DEFAULT_CAPTURE_RENDERER_BACKEND = 'swiftshader';
export const NATIVE_MACOS_DIAGNOSTIC_BACKEND = 'macos-native-diagnostic';
export const CAPTURE_RENDERER_BACKENDS = Object.freeze([
  DEFAULT_CAPTURE_RENDERER_BACKEND,
  NATIVE_MACOS_DIAGNOSTIC_BACKEND,
]);

export function validateNativeRendererDiagnosticHost({
  platform = process.platform,
  githubActions = process.env.GITHUB_ACTIONS,
} = {}) {
  if (platform !== 'darwin' || githubActions !== 'true')
    throw new Error(
      'The native renderer diagnostic is available only on a GitHub Actions macOS runner.',
    );
  return true;
}

export function rendererLaunchArgs(backend = DEFAULT_CAPTURE_RENDERER_BACKEND) {
  if (backend === null) return [];
  if (!CAPTURE_RENDERER_BACKENDS.includes(backend))
    throw new TypeError(`Unknown capture renderer backend: ${backend}`);
  return backend === DEFAULT_CAPTURE_RENDERER_BACKEND
    ? [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ]
    : [];
}

export function captureCliRendererArgs(
  backend = DEFAULT_CAPTURE_RENDERER_BACKEND,
) {
  if (!CAPTURE_RENDERER_BACKENDS.includes(backend))
    throw new TypeError(`Unknown capture renderer backend: ${backend}`);
  return backend === DEFAULT_CAPTURE_RENDERER_BACKEND
    ? ['--software-rendering']
    : ['--native-rendering-diagnostic'];
}

export function nativeRendererDiagnosticEvidence({
  renderer,
  vendor,
  graphics,
}) {
  const classification = classifyRenderer(renderer, graphics);
  const featureStatus = Object.fromEntries(
    ['webgl', 'webgl2', 'gpu_compositing', 'opengl'].map((key) => [
      key,
      graphics?.featureStatus?.[key] ?? null,
    ]),
  );
  return {
    schema: 'gev-hosted-renderer-diagnostic/v1',
    requestedBackend: NATIVE_MACOS_DIAGNOSTIC_BACKEND,
    observedRenderer: String(renderer || '').slice(0, 240) || null,
    observedWebglVendor: String(vendor || '').slice(0, 160) || null,
    kind: classification.kind,
    accelerationVerified: classification.accelerationVerified,
    status: classification.accelerationVerified ? 'verified' : 'unverified',
    featureStatus,
    physicalDesktopCoverage: false,
    hostedEnvironment: 'github-actions-macos',
    comparisonEligible: false,
    performanceAcceptanceEligible: false,
  };
}

export function assertVerifiedNativeRendererEvidence(
  evidence,
  expectedRenderer,
  expectedWebglVendor,
) {
  const expectedKeys = [
    'schema',
    'requestedBackend',
    'observedRenderer',
    'observedWebglVendor',
    'kind',
    'accelerationVerified',
    'status',
    'featureStatus',
    'physicalDesktopCoverage',
    'hostedEnvironment',
    'comparisonEligible',
    'performanceAcceptanceEligible',
  ];
  const featureKeys = ['webgl', 'webgl2', 'gpu_compositing', 'opengl'];
  const classification = classifyRenderer(evidence?.observedRenderer, {
    featureStatus: evidence?.featureStatus,
  });
  if (
    !evidence ||
    typeof evidence !== 'object' ||
    Array.isArray(evidence) ||
    Object.keys(evidence).sort().join(',') !== expectedKeys.sort().join(',') ||
    !evidence.featureStatus ||
    typeof evidence.featureStatus !== 'object' ||
    Array.isArray(evidence.featureStatus) ||
    Object.keys(evidence.featureStatus).sort().join(',') !==
      featureKeys.sort().join(',') ||
    Object.values(evidence.featureStatus).some(
      (value) =>
        value !== null && (typeof value !== 'string' || value.length > 64),
    ) ||
    evidence?.schema !== 'gev-hosted-renderer-diagnostic/v1' ||
    evidence.requestedBackend !== NATIVE_MACOS_DIAGNOSTIC_BACKEND ||
    !['native-gpu', 'apple-paravirtual-metal'].includes(classification.kind) ||
    classification.kind !== evidence.kind ||
    classification.accelerationVerified !== true ||
    evidence.accelerationVerified !== classification.accelerationVerified ||
    evidence.observedRenderer !== expectedRenderer ||
    (expectedWebglVendor !== null &&
      (typeof expectedWebglVendor !== 'string' ||
        expectedWebglVendor.length > 160)) ||
    evidence.observedWebglVendor !== expectedWebglVendor ||
    typeof evidence.observedRenderer !== 'string' ||
    evidence.observedRenderer.length < 1 ||
    evidence.observedRenderer.length > 240 ||
    (evidence.observedWebglVendor !== null &&
      (typeof evidence.observedWebglVendor !== 'string' ||
        evidence.observedWebglVendor.length > 160)) ||
    evidence.hostedEnvironment !== 'github-actions-macos' ||
    evidence.status !== 'verified' ||
    evidence.physicalDesktopCoverage !== false ||
    evidence.comparisonEligible !== false ||
    evidence.performanceAcceptanceEligible !== false
  )
    throw new Error(
      'Native renderer diagnostic requires observed accelerated graphics; software and unknown renderers are rejected.',
    );
  return evidence;
}
