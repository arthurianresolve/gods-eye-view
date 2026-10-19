import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertStartupCpuAttributionMode,
  beginStartupCpuAttribution,
  STARTUP_CPU_ATTRIBUTION_SCHEMA,
} from './startupCpuAttribution.mjs';

const validMode = {
  enabled: true,
  startupOnlyShard: true,
  startupAttributionEnabled: true,
  startupPageObservedEnabled: false,
  firstMotionCpuProfileEnabled: false,
  artifactDirectory: 'profiles',
};

test('startup CPU profiling is limited to attributed startup-only diagnostics', () => {
  assert.equal(assertStartupCpuAttributionMode(validMode), true);
  assert.equal(
    assertStartupCpuAttributionMode({
      ...validMode,
      enabled: false,
      artifactDirectory: null,
    }),
    false,
  );
  for (const override of [
    { startupOnlyShard: false },
    { startupAttributionEnabled: false },
    { startupPageObservedEnabled: true },
    { firstMotionCpuProfileEnabled: true },
    { artifactDirectory: null },
  ])
    assert.throws(
      () => assertStartupCpuAttributionMode({ ...validMode, ...override }),
      /startup-only|startup-attribution|startup-page-observed|first-motion|artifact-directory/,
    );
  assert.throws(
    () =>
      assertStartupCpuAttributionMode({
        ...validMode,
        enabled: false,
        artifactDirectory: 'profiles',
      }),
    /requires a CPU profile mode/,
  );
});

test('startup profile spans navigation readiness and closes only at both boundaries', async () => {
  const events = [];
  const profileRunner = async (options) => {
    assert.equal(options.maxWindowMs, 30_000);
    assert.equal(options.label.includes('navigation'), true);
    events.push('profiler-started');
    options.onStarted({ profilerStarted: true });
    const result = await options.operation();
    events.push(`profiler-stopped:${result.outcome}`);
    return {
      value: result,
      profile: {
        status: 'complete',
        performanceAcceptanceEligible: false,
        fileName: options.fileName,
        sha256: 'a'.repeat(64),
        profileWindowMs: 4321,
      },
    };
  };
  const window = await beginStartupCpuAttribution({
    page: { createCDPSession() {} },
    artifactDirectory: 'profiles',
    profileRunner,
  });
  assert.deepEqual(await window.started, { profilerStarted: true });
  events.push('navigate-and-wait-ready');
  const report = await window.finish({
    outcome: 'ready',
    viewerBoundary: {
      pageObservedMsFromNavigationStart: 4400.25,
      hostObservedElapsedMs: 4481,
    },
    loadingHiddenBoundary: {
      pageObservedMsFromNavigationStart: 5100.5,
      hostObservedElapsedMs: 5187,
    },
  });
  assert.deepEqual(events, [
    'profiler-started',
    'navigate-and-wait-ready',
    'profiler-stopped:ready',
  ]);
  assert.equal(report.schema, STARTUP_CPU_ATTRIBUTION_SCHEMA);
  assert.equal(report.outcome, 'ready');
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.profile.status, 'complete');
  assert.equal(
    Number.isFinite(report.profilerStopAndPersistenceElapsedMs),
    true,
  );
  assert.deepEqual(report.boundaries.viewerExistence, {
    pageObservedMsFromNavigationStart: 4400.3,
    hostObservedElapsedMs: 4481,
  });
  assert.deepEqual(
    await window.finish({ outcome: 'failed' }),
    report,
    'repeated cleanup returns the same closed profile record',
  );
});

test('startup CPU profile rejects an unbounded window before attaching a session', async () => {
  let runnerCalled = false;
  await assert.rejects(
    beginStartupCpuAttribution({
      page: { createCDPSession() {} },
      artifactDirectory: 'profiles',
      maxWindowMs: 30_001,
      profileRunner: async () => {
        runnerCalled = true;
      },
    }),
    /exceeds its fixed bound/,
  );
  assert.equal(runnerCalled, false);
});

test('startup profile failure remains diagnostic and preserves failed readiness', async () => {
  const window = await beginStartupCpuAttribution({
    page: { createCDPSession() {} },
    artifactDirectory: 'profiles',
    profileRunner: async (options) => {
      options.onStarted({ profilerStarted: false });
      await options.operation();
      return {
        value: null,
        profile: {
          status: 'incomplete',
          profilerErrors: ['Profiler.start timed out.'],
          performanceAcceptanceEligible: false,
        },
      };
    },
  });
  assert.deepEqual(await window.started, { profilerStarted: false });
  const report = await window.finish({
    outcome: 'failed',
    viewerBoundary: null,
    loadingHiddenBoundary: null,
  });
  assert.equal(report.outcome, 'failed');
  assert.equal(report.profile.status, 'incomplete');
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.boundaries.viewerExistence, null);
  assert.equal(report.boundaries.loadingScreenHidden, null);
});

test('startup profile session setup failure still releases the bounded operation', async () => {
  const window = await beginStartupCpuAttribution({
    page: { createCDPSession() {} },
    artifactDirectory: 'profiles',
    profileRunner: async () => {
      throw Object.assign(new Error('sensitive detail'), {
        name: 'ProtocolError',
      });
    },
  });
  assert.deepEqual(await window.started, { profilerStarted: false });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const report = await window.finish({ outcome: 'failed' });
  assert.equal(report.outcome, 'failed');
  assert.equal(report.profileErrorName, 'ProtocolError');
  assert.equal(JSON.stringify(report).includes('sensitive detail'), false);
  assert.equal(report.performanceAcceptanceEligible, false);
});

test('startup profile window cap still stops and detaches the real CDP session', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-startup-cpu-profile-'),
  );
  try {
    const calls = [];
    const session = {
      async send(method) {
        calls.push(method);
        return method === 'Profiler.stop'
          ? {
              profile: {
                startTime: 1000,
                endTime: 3000,
                nodes: [
                  { id: 1, callFrame: { functionName: 'startup', url: '' } },
                ],
                samples: [1, 1],
                timeDeltas: [1000, 1000],
              },
            }
          : {};
      },
      async detach() {
        calls.push('detach');
      },
    };
    const window = await beginStartupCpuAttribution({
      page: {
        async createCDPSession() {
          return session;
        },
      },
      artifactDirectory,
      maxWindowMs: 10,
      operationTimeoutMs: 100,
    });
    assert.deepEqual(await window.started, { profilerStarted: true });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const report = await window.finish({ outcome: 'ready' });
    assert.equal(report.status, 'incomplete');
    assert.equal(report.profile.windowCapReached, true);
    assert.deepEqual(calls, [
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
      'Profiler.stop',
      'Profiler.disable',
      'detach',
    ]);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('startup profiler timeout is bounded and keeps the late readiness result diagnostic', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-startup-cpu-profile-'),
  );
  try {
    const calls = [];
    const session = {
      async send(method) {
        calls.push(method);
        if (method === 'Profiler.enable') return new Promise(() => {});
        return {};
      },
      async detach() {
        calls.push('detach');
      },
    };
    const window = await beginStartupCpuAttribution({
      page: {
        async createCDPSession() {
          return session;
        },
      },
      artifactDirectory,
      maxWindowMs: 50,
      operationTimeoutMs: 10,
    });
    assert.deepEqual(await window.started, { profilerStarted: false });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const report = await window.finish({ outcome: 'ready' });
    assert.equal(report.outcome, 'ready');
    assert.equal(report.status, 'incomplete');
    assert.equal(report.profile.windowCapReached, true);
    assert.match(report.profile.profilerErrors.join(' '), /Profiler\.enable/);
    assert.deepEqual(calls, ['Profiler.enable', 'Profiler.disable', 'detach']);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});
