import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  validatePortableBuildProvenanceReceipt,
  verifyServedBuildAssets,
} from './buildProvenance.mjs';
import { assertNativeSharpnessProfile } from './nativeSharpnessProfile.mjs';
import {
  assertNativeWindowViewportEvidence,
  assertNativeWindowViewportPair,
} from './nativeWindowViewport.mjs';

export const QUALIFICATION_BUILD_IDENTITY_SCHEMA =
  'gev-qualification-build-identity-plan/v1';
export const QUALIFICATION_BUILD_IDENTITY_KIND =
  'predeclared-build-receipt-identity-only-v1';
const VERIFICATION_SCHEMA = 'gev-qualification-build-identity-verification/v1';
const LIVE_SCHEMA = 'gev-qualification-live-build-identity/v1';
const MODE = 'native-window-viewport-v1';
const ROLES = ['baseline', 'candidate'];
const SHA1 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const LIMIT = 1024 * 1024;
const SCOPE =
  'Explicit application/build/browser identity only; no startup, performance or comparison credit.';
const ELIGIBILITY = Object.freeze({
  comparisonEligible: false,
  coldStartupEligible: false,
  performanceEligible: false,
});
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);
const timestamp = (value) => {
  assert.equal(typeof value, 'string');
  const time = Date.parse(value);
  assert.ok(Number.isFinite(time), 'Identity timestamp is invalid');
  return time;
};
const keys = (value, expected, label) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label);
};
const absolute = (value) => {
  assert.ok(
    typeof value === 'string' &&
      (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)),
    'Identity path must be absolute',
  );
};
const pathKey = (value) =>
  /^[a-z]:[\\/]|^\\\\/i.test(value)
    ? path.win32.normalize(value).toLowerCase()
    : path.posix.normalize(value);
const roleKey = (role) =>
  assert.ok(ROLES.includes(role), 'Identity role is invalid');

/** This source kind is opt-in; existing capture and weather readers keep their inputs. */
export function resolveQualificationIdentitySource({
  baselineCapturePath,
  candidateCapturePath,
  weatherIdentityEnvelopePath,
  buildIdentityPlanPath,
  buildIdentityPlanSha256,
  nativeWindowViewport = false,
} = {}) {
  if (
    buildIdentityPlanPath !== undefined ||
    buildIdentityPlanSha256 !== undefined
  ) {
    assert.ok(
      buildIdentityPlanPath && buildIdentityPlanSha256,
      'Identity plan path and hash are both required',
    );
    assert.equal(
      nativeWindowViewport,
      true,
      'Direct identity requires the native-window mode',
    );
    assert.equal(
      baselineCapturePath,
      undefined,
      'Identity sources cannot be mixed',
    );
    assert.equal(
      candidateCapturePath,
      undefined,
      'Identity sources cannot be mixed',
    );
    assert.equal(
      weatherIdentityEnvelopePath,
      undefined,
      'Identity sources cannot be mixed',
    );
    assert.match(buildIdentityPlanSha256, SHA256);
    return {
      kind: QUALIFICATION_BUILD_IDENTITY_KIND,
      path: buildIdentityPlanPath,
      sha256: buildIdentityPlanSha256,
    };
  }
  assert.ok(
    baselineCapturePath && candidateCapturePath,
    'Both source capture paths are required',
  );
  return {
    kind: weatherIdentityEnvelopePath
      ? 'validated-weather-balanced-pair'
      : 'performance-capture-pair',
    baselineCapturePath,
    candidateCapturePath,
    ...(weatherIdentityEnvelopePath ? { weatherIdentityEnvelopePath } : {}),
  };
}

/** Validate a predeclared plan, never infer expected roles or browser identity from a run. */
export function assertQualificationBuildIdentityPlan(
  plan,
  { expectedApplicationCommits } = {},
) {
  keys(
    plan,
    [
      'schema',
      'status',
      'kind',
      'scope',
      ...Object.keys(ELIGIBILITY),
      'createdAt',
      'application',
      'buildHarness',
      'browser',
      'measurementEnvironment',
      'nativeDpr',
      'settings',
      'builds',
    ],
    'Identity plan shape',
  );
  assert.equal(plan.schema, QUALIFICATION_BUILD_IDENTITY_SCHEMA);
  assert.equal(plan.status, 'predeclared');
  assert.equal(plan.kind, QUALIFICATION_BUILD_IDENTITY_KIND);
  assert.equal(plan.scope, SCOPE);
  for (const [key, value] of Object.entries(ELIGIBILITY))
    assert.equal(plan[key], value);
  timestamp(plan.createdAt);
  keys(
    plan.application,
    ROLES,
    'Explicit baseline and candidate commits required',
  );
  for (const role of ROLES) assert.match(plan.application[role], SHA1);
  assert.notEqual(plan.application.baseline, plan.application.candidate);
  if (expectedApplicationCommits)
    assert.deepEqual(
      plan.application,
      expectedApplicationCommits,
      'Identity comparison roles changed',
    );
  keys(plan.buildHarness, ['commit', 'checkout'], 'Build harness');
  assert.match(plan.buildHarness.commit, SHA1);
  absolute(plan.buildHarness.checkout);
  keys(
    plan.browser,
    [
      'executable',
      'executableSha256',
      'product',
      'userAgent',
      'platform',
      'renderer',
    ],
    'Expected browser identity',
  );
  absolute(plan.browser.executable);
  assert.match(plan.browser.executableSha256, SHA256);
  assert.match(plan.browser.product, /^Chrome\/\d+\.\d+\.\d+\.\d+$/);
  const major = plan.browser.product.match(/^Chrome\/(\d+)/)[1];
  assert.ok(
    typeof plan.browser.userAgent === 'string' &&
      plan.browser.userAgent.length <= 2048,
  );
  assert.match(plan.browser.userAgent, new RegExp(`Chrome/${major}\\.`));
  assert.match(plan.browser.userAgent, /Windows NT/);
  assert.equal(plan.browser.platform, 'Win32');
  assert.match(plan.browser.renderer, /^ANGLE \(/);
  assert.match(plan.browser.renderer, /Intel|NVIDIA|AMD|Radeon/);
  assert.doesNotMatch(
    plan.browser.renderer,
    /swiftshader|software|llvmpipe|softpipe|basic render|warp|virtual/i,
  );
  assert.equal(plan.measurementEnvironment, MODE);
  assert.ok(Number.isFinite(plan.nativeDpr) && plan.nativeDpr > 0);
  // Full settings, including effects, must be explicit and match both live builds.
  keys(
    plan.settings,
    [
      'qualityMode',
      'densityPct',
      'detectionMode',
      'resolutionScale',
      'antialias',
      'msaaSamples',
      'fxaa',
      'bloom',
      'bloomIntensity',
      'sharpen',
      'sharpenIntensity',
      'visual',
    ],
    'Complete effective settings',
  );
  assert.equal(plan.settings.qualityMode, 'manual');
  assert.equal(plan.settings.densityPct, 75);
  assert.equal(plan.settings.detectionMode, 'DENSE');
  assert.equal(plan.settings.resolutionScale, 1);
  assert.equal(plan.settings.antialias, true);
  assert.equal(plan.settings.msaaSamples, 4);
  for (const key of ['fxaa', 'bloom', 'sharpen'])
    assert.equal(typeof plan.settings[key], 'boolean');
  for (const key of ['bloomIntensity', 'sharpenIntensity'])
    assert.ok(Number.isFinite(plan.settings[key]));
  assert.ok(
    plan.settings.visual &&
      typeof plan.settings.visual === 'object' &&
      !Array.isArray(plan.settings.visual),
  );
  keys(
    plan.settings.visual,
    [
      'style',
      'bloomEnabled',
      'bloomIntensity',
      'sharpenEnabled',
      'sharpenIntensity',
      'detectionMode',
      'detectionDensityPct',
      'detectionAllocation',
      'detectionFadePct',
      'detectionOutsideOpacityPct',
      'scopeEnabled',
      'scopeFeatherPct',
      'mapStack',
    ],
    'Complete visual settings',
  );
  assert.equal(plan.settings.visual.detectionMode, plan.settings.detectionMode);
  assert.equal(
    plan.settings.visual.detectionDensityPct,
    plan.settings.densityPct,
  );
  assert.equal(plan.settings.visual.bloomEnabled, plan.settings.bloom);
  assert.equal(
    plan.settings.visual.bloomIntensity,
    plan.settings.bloomIntensity,
  );
  assert.equal(plan.settings.visual.sharpenEnabled, plan.settings.sharpen);
  assert.equal(
    plan.settings.visual.sharpenIntensity,
    plan.settings.sharpenIntensity,
  );
  keys(plan.builds, ROLES, 'Build roles');
  for (const role of ROLES) {
    const build = plan.builds[role];
    keys(
      build,
      [
        'checkout',
        'root',
        'receipt',
        'receiptFileSha256',
        'receiptSha256',
        'baseUrl',
        'profile',
      ],
      `${role} build`,
    );
    for (const key of ['checkout', 'root', 'receipt']) absolute(build[key]);
    for (const key of ['receiptFileSha256', 'receiptSha256'])
      assert.match(build[key], SHA256);
    assert.equal(
      build.profile,
      'standard',
      'Formal qualification uses the unchanged standard build',
    );
    const url = new URL(build.baseUrl);
    assert.equal(url.protocol, 'http:');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
    assert.equal(url.pathname, '/');
    assert.equal(url.username + url.password + url.search + url.hash, '');
  }
  assert.notEqual(
    new URL(plan.builds.baseline.baseUrl).origin,
    new URL(plan.builds.candidate.baseUrl).origin,
  );
  return plan;
}

export function createQualificationBuildIdentityPlan(input) {
  const plan = {
    schema: QUALIFICATION_BUILD_IDENTITY_SCHEMA,
    status: 'predeclared',
    kind: QUALIFICATION_BUILD_IDENTITY_KIND,
    scope: SCOPE,
    ...ELIGIBILITY,
    ...clone(input),
  };
  assertQualificationBuildIdentityPlan(plan);
  return plan;
}

/** Raw plan bytes and their externally selected digest stay bound through every helper. */
export function inspectQualificationBuildIdentityPlan(
  planBytes,
  { expectedPlanSha256, expectedApplicationCommits } = {},
) {
  assert.ok(
    Buffer.isBuffer(planBytes) &&
      planBytes.length > 0 &&
      planBytes.length <= LIMIT,
  );
  assert.match(expectedPlanSha256 || '', SHA256);
  assert.equal(
    hash(planBytes),
    expectedPlanSha256,
    'Identity plan hash changed',
  );
  const plan = JSON.parse(planBytes.toString('utf8'));
  assertQualificationBuildIdentityPlan(plan, { expectedApplicationCommits });
  return {
    plan,
    planBytes: Buffer.from(planBytes),
    planSha256: expectedPlanSha256,
  };
}

async function readBoundFile(filename, maximumBytes) {
  const info = await lstat(filename);
  assert.ok(
    info.isFile() && !info.isSymbolicLink(),
    'Identity input must be a regular file',
  );
  assert.ok(
    info.size > 0 && info.size <= maximumBytes,
    'Identity input exceeds its byte bound',
  );
  const bytes = await readFile(filename);
  assert.ok(bytes.length > 0 && bytes.length <= maximumBytes);
  return bytes;
}

export async function readQualificationBuildIdentityPlan({
  planPath,
  expectedPlanSha256,
  expectedApplicationCommits,
} = {}) {
  const context = inspectQualificationBuildIdentityPlan(
    await readBoundFile(planPath, LIMIT),
    { expectedPlanSha256, expectedApplicationCommits },
  );
  return { ...context, path: path.resolve(planPath) };
}

function checkedContext(context) {
  const inspected = inspectQualificationBuildIdentityPlan(context.planBytes, {
    expectedPlanSha256: context.planSha256,
  });
  assert.deepEqual(
    context.plan,
    inspected.plan,
    'Parsed identity plan changed',
  );
  return inspected.plan;
}

export function qualificationBuildExpectedIdentity(context, role) {
  roleKey(role);
  const plan = checkedContext(context);
  return {
    applicationCommit: plan.application[role],
    browserVersion: plan.browser.product,
    renderer: plan.browser.renderer,
    userAgent: plan.browser.userAgent,
    platform: plan.browser.platform,
    nativeDpr: plan.nativeDpr,
  };
}

/** Run only before browser launch or after capture/close, never inside an action or drain. */
export async function verifyQualificationBuildIdentityAssets(
  context,
  role,
  phase,
  {
    verifyAssets = verifyServedBuildAssets,
    now = () => new Date().toISOString(),
  } = {},
) {
  roleKey(role);
  assert.ok(['before', 'after'].includes(phase));
  const plan = checkedContext(context),
    build = plan.builds[role];
  const startedAt = now();
  assert.ok(
    timestamp(startedAt) >= timestamp(plan.createdAt),
    'Identity verification predates the plan',
  );
  const browserBytes = await readBoundFile(
    plan.browser.executable,
    128 * LIMIT,
  );
  assert.equal(
    hash(browserBytes),
    plan.browser.executableSha256,
    'Chrome executable changed',
  );
  const receiptBytes = await readBoundFile(build.receipt, 16 * LIMIT);
  assert.equal(
    hash(receiptBytes),
    build.receiptFileSha256,
    `${role} receipt file changed`,
  );
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  validatePortableBuildProvenanceReceipt(receipt, {
    expectedAppCommit: plan.application[role],
    expectedHarnessCommit: plan.buildHarness.commit,
  });
  assert.equal(receipt.receiptSha256, build.receiptSha256);
  const served = await verifyAssets({
    receipt,
    checkoutRoot: build.checkout,
    harnessRoot: plan.buildHarness.checkout,
    buildRoot: build.root,
    expectedAppCommit: plan.application[role],
    expectedHarnessCommit: plan.buildHarness.commit,
    expectedBuildProfile: null,
    baseUrl: build.baseUrl,
  });
  const proof = {
    schema: VERIFICATION_SCHEMA,
    kind: QUALIFICATION_BUILD_IDENTITY_KIND,
    scope: SCOPE,
    ...ELIGIBILITY,
    planSha256: context.planSha256,
    role,
    phase,
    applicationCommit: plan.application[role],
    startedAt,
    completedAt: now(),
    browserExecutableSha256: hash(browserBytes),
    receiptFileSha256: hash(receiptBytes),
    receipt,
    served,
  };
  assertQualificationBuildIdentityVerification(context, proof, { role, phase });
  return proof;
}

export function assertQualificationBuildIdentityVerification(
  context,
  proof,
  { role, phase } = {},
) {
  roleKey(role);
  assert.ok(['before', 'after'].includes(phase));
  const plan = checkedContext(context),
    build = plan.builds[role];
  keys(
    proof,
    [
      'schema',
      'kind',
      'scope',
      ...Object.keys(ELIGIBILITY),
      'planSha256',
      'role',
      'phase',
      'applicationCommit',
      'startedAt',
      'completedAt',
      'browserExecutableSha256',
      'receiptFileSha256',
      'receipt',
      'served',
    ],
    'Identity verification proof',
  );
  assert.equal(proof.schema, VERIFICATION_SCHEMA);
  assert.equal(proof.kind, plan.kind);
  assert.equal(proof.scope, SCOPE);
  for (const [key, value] of Object.entries(ELIGIBILITY))
    assert.equal(proof[key], value);
  assert.equal(proof.planSha256, context.planSha256);
  assert.equal(proof.role, role);
  assert.equal(proof.phase, phase);
  assert.equal(proof.applicationCommit, plan.application[role]);
  assert.ok(timestamp(proof.startedAt) >= timestamp(plan.createdAt));
  assert.ok(timestamp(proof.completedAt) >= timestamp(proof.startedAt));
  assert.equal(proof.browserExecutableSha256, plan.browser.executableSha256);
  assert.equal(proof.receiptFileSha256, build.receiptFileSha256);
  validatePortableBuildProvenanceReceipt(proof.receipt, {
    expectedAppCommit: plan.application[role],
    expectedHarnessCommit: plan.buildHarness.commit,
  });
  assert.equal(proof.receipt.receiptSha256, build.receiptSha256);
  assert.deepEqual(proof.served, {
    schema: 'gev-served-assets-verification/v1',
    status: 'served-assets-match',
    receiptSha256: build.receiptSha256,
    assetCount: proof.receipt.assetCount,
    totalAssetBytes: proof.receipt.totalAssetBytes,
  });
  return true;
}

/** Independent protocol/page/process binding; timing and fixture acceptance remain separate. */
export function assertQualificationLiveBuildIdentity(
  context,
  role,
  { actual, browserVersion, browserProcess, nativeWindowEvidence } = {},
) {
  roleKey(role);
  const plan = checkedContext(context);
  assert.equal(actual?.applicationCommit, plan.application[role]);
  assert.equal(actual.browserVersion, plan.browser.product);
  assert.equal(browserVersion?.product, plan.browser.product);
  assert.equal(browserVersion.userAgent, plan.browser.userAgent);
  assert.equal(
    actual.userAgent,
    browserVersion.userAgent,
    'Protocol and page user agents differ',
  );
  assert.equal(actual.platform, plan.browser.platform);
  assert.equal(actual.renderer, plan.browser.renderer);
  assert.ok(
    Number.isSafeInteger(browserProcess?.pid) && browserProcess.pid > 0,
  );
  absolute(browserProcess.executable);
  assert.equal(
    pathKey(browserProcess.executable),
    pathKey(plan.browser.executable),
    'Owned browser executable differs',
  );
  assertNativeWindowViewportEvidence(nativeWindowEvidence, {
    expectedDpr: plan.nativeDpr,
  });
  assert.equal(nativeWindowEvidence.browserPid, browserProcess.pid);
  assert.equal(nativeWindowEvidence.page.focused, true);
  assert.equal(nativeWindowEvidence.host.foreground, true);
  assertNativeSharpnessProfile(
    { environment: { nativeSharpnessProfile: actual.nativeSharpnessProfile } },
    `${role} live identity`,
  );
  assert.equal(actual.nativeSharpnessProfile.viewport.dpr, plan.nativeDpr);
  assert.deepEqual(actual.nativeSharpnessProfile.viewport, actual.viewport);
  assert.deepEqual(
    actual.nativeSharpnessProfile.drawingBuffer,
    actual.drawingBuffer,
  );
  assert.deepEqual(actual.viewport, {
    ...nativeWindowEvidence.page.inner,
    dpr: plan.nativeDpr,
  });
  assert.deepEqual(
    actual.drawingBuffer,
    nativeWindowEvidence.page.nativeResolution.sceneDrawingBuffer,
  );
  assert.deepEqual(
    actual.settings,
    plan.settings,
    'Effective qualification settings differ from the explicit plan',
  );
  return {
    schema: LIVE_SCHEMA,
    kind: QUALIFICATION_BUILD_IDENTITY_KIND,
    ...ELIGIBILITY,
    planSha256: context.planSha256,
    role,
    applicationCommit: plan.application[role],
    browserVersion: clone(browserVersion),
    browserProcess: clone(browserProcess),
    identity: clone(actual),
    nativeWindowEvidence: clone(nativeWindowEvidence),
  };
}

export function assertQualificationBuildIdentityBoundaries(
  context,
  boundaries,
  captureSpan,
) {
  checkedContext(context);
  keys(
    captureSpan,
    ['startedAt', 'completedAt'],
    'Complete formal capture span',
  );
  assert.ok(
    timestamp(captureSpan.completedAt) >= timestamp(captureSpan.startedAt),
  );
  keys(boundaries, ROLES, 'Both identity role boundaries required');
  for (const role of ROLES) {
    keys(boundaries[role], ['before', 'after'], `${role} identity boundaries`);
    for (const phase of ['before', 'after'])
      assertQualificationBuildIdentityVerification(
        context,
        boundaries[role][phase],
        { role, phase },
      );
    assert.ok(
      timestamp(boundaries[role].after.startedAt) >=
        timestamp(boundaries[role].before.completedAt),
    );
    assert.ok(
      timestamp(boundaries[role].before.completedAt) <=
        timestamp(captureSpan.startedAt),
      'Asset verification overlapped the measured capture',
    );
    assert.ok(
      timestamp(boundaries[role].after.startedAt) >=
        timestamp(captureSpan.completedAt),
      'Asset verification overlapped the measured capture',
    );
    assert.deepEqual(
      boundaries[role].before.receipt,
      boundaries[role].after.receipt,
    );
  }
  return true;
}

/** Two unmeasured public CDP reads per build; always release only this session. */
export async function readQualificationBrowserVersion(
  page,
  { timeoutMs = 4000, cleanupTimeoutMs = 1000 } = {},
) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 4000);
  assert.ok(
    Number.isInteger(cleanupTimeoutMs) &&
      cleanupTimeoutMs > 0 &&
      cleanupTimeoutMs <= 1000,
  );
  const bounded = async (operation, milliseconds, message) => {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  let session = null,
    finished = false,
    failure = null;
  try {
    return await bounded(
      async () => {
        const acquired = await page.createCDPSession();
        if (finished) {
          acquired.detach().catch(() => {});
          throw new Error('Late identity CDP session');
        }
        session = acquired;
        return session.send('Browser.getVersion', undefined, {
          timeout: timeoutMs,
        });
      },
      timeoutMs,
      'Identity Browser.getVersion timed out',
    );
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    finished = true;
    if (session)
      try {
        await bounded(
          () => session.detach(),
          cleanupTimeoutMs,
          'Identity CDP cleanup timed out',
        );
      } catch (error) {
        if (failure) failure.cleanupError = error;
        else throw error;
      }
  }
}

/** A distinct evidence shape; never manufacture a performance-capture report. */
export function createQualificationBuildIdentityEvidence(
  context,
  { boundaries, live, captureSpan },
) {
  checkedContext(context);
  const evidence = {
    schema: 'gev-qualification-build-identity-evidence/v1',
    kind: QUALIFICATION_BUILD_IDENTITY_KIND,
    scope: SCOPE,
    ...ELIGIBILITY,
    planUtf8: context.planBytes.toString('utf8'),
    planSha256: context.planSha256,
    boundaries: clone(boundaries),
    live: clone(live),
    captureSpan: clone(captureSpan),
  };
  inspectQualificationBuildIdentityEvidence(evidence);
  return evidence;
}

/** Offline raw consumer: all source, protocol, ownership and native proofs stay mandatory. */
export function inspectQualificationBuildIdentityEvidence(
  evidence,
  { expectedApplicationCommits } = {},
) {
  keys(
    evidence,
    [
      'schema',
      'kind',
      'scope',
      ...Object.keys(ELIGIBILITY),
      'planUtf8',
      'planSha256',
      'boundaries',
      'live',
      'captureSpan',
    ],
    'Direct identity evidence',
  );
  assert.equal(evidence.schema, 'gev-qualification-build-identity-evidence/v1');
  assert.equal(evidence.kind, QUALIFICATION_BUILD_IDENTITY_KIND);
  assert.equal(evidence.scope, SCOPE);
  for (const [key, value] of Object.entries(ELIGIBILITY))
    assert.equal(evidence[key], value);
  assert.ok(
    typeof evidence.planUtf8 === 'string' &&
      Buffer.byteLength(evidence.planUtf8) <= LIMIT,
  );
  const context = inspectQualificationBuildIdentityPlan(
    Buffer.from(evidence.planUtf8),
    { expectedPlanSha256: evidence.planSha256, expectedApplicationCommits },
  );
  assertQualificationBuildIdentityBoundaries(
    context,
    evidence.boundaries,
    evidence.captureSpan,
  );
  keys(evidence.live, ROLES, 'Both live identity roles required');
  const identities = {};
  for (const role of ROLES) {
    keys(
      evidence.live[role],
      ['before', 'after'],
      'Both live identity boundaries required',
    );
    for (const phase of ['before', 'after']) {
      const proof = evidence.live[role][phase];
      const verified = assertQualificationLiveBuildIdentity(context, role, {
        actual: proof.identity,
        browserVersion: proof.browserVersion,
        browserProcess: proof.browserProcess,
        nativeWindowEvidence: proof.nativeWindowEvidence,
      });
      assert.deepEqual(proof, verified, 'Live identity proof changed');
      const observedAt = timestamp(proof.nativeWindowEvidence.observedAtUtc);
      assert.ok(
        observedAt >= timestamp(evidence.captureSpan.startedAt) &&
          observedAt <= timestamp(evidence.captureSpan.completedAt),
      );
    }
    const { before, after } = evidence.live[role];
    assert.deepEqual(
      before.browserProcess,
      after.browserProcess,
      'Live owned browser changed',
    );
    assertNativeWindowViewportPair(
      before.nativeWindowEvidence,
      after.nativeWindowEvidence,
    );
    assert.ok(
      timestamp(before.nativeWindowEvidence.observedAtUtc) <=
        timestamp(after.nativeWindowEvidence.observedAtUtc),
    );
    identities[role] = {
      applicationCommit: before.identity.applicationCommit,
      browserVersion: before.identity.browserVersion,
      renderer: before.identity.renderer,
      userAgent: before.identity.userAgent,
      platform: before.identity.platform,
      sourceProfile: before.identity.nativeSharpnessProfile,
    };
  }
  assert.notEqual(
    evidence.live.baseline.before.browserProcess.pid,
    evidence.live.candidate.before.browserProcess.pid,
    'Builds must use independently owned browsers',
  );
  assertNativeWindowViewportPair(
    evidence.live.baseline.before.nativeWindowEvidence,
    evidence.live.candidate.before.nativeWindowEvidence,
  );
  return { context, identities };
}

/** Child timing/heap reports reference one complete envelope in their parent. */
export function qualificationBuildIdentityEvidenceReference(evidence) {
  inspectQualificationBuildIdentityEvidence(evidence);
  return {
    kind: QUALIFICATION_BUILD_IDENTITY_KIND,
    planSha256: evidence.planSha256,
    evidenceSha256: hash(Buffer.from(JSON.stringify(evidence))),
  };
}
