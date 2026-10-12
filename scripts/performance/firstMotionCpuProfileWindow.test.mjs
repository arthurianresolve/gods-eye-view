import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBoundedBoundaryProfile } from './boundedCpuProfile.mjs';
import { createFirstMotionCpuProfileWindow } from './firstMotionCpuProfileWindow.mjs';

test('disabled first-motion profile window performs no profiler or artifact work', async () => {
  let calls = 0;
  const window = createFirstMotionCpuProfileWindow({
    enabled: false,
    profileRunner: () => {
      calls += 1;
    },
  });
  assert.equal(window.record, null);
  assert.equal(await window.started, null);
  assert.equal(await window.stop('capture-finished'), null);
  assert.equal(calls, 0);
});

test('profile operation starts before warmup and ends exactly once at the boundary', async () => {
  const calls = [];
  let release;
  const profileRunner = async (options) => {
    calls.push('setup');
    options.onStarted({ profilerStarted: true });
    const value = await options.operation();
    calls.push(['end', value]);
    options.onProfile({ status: 'complete', sha256: 'a'.repeat(64) });
  };
  const window = createFirstMotionCpuProfileWindow({
    enabled: true,
    profileRunner,
    onRecord: (record) => calls.push(['record', record.status]),
  });
  await window.started;
  assert.equal(window.record.profilerStarted, true);
  assert.deepEqual(calls[0], 'setup');
  await Promise.all([
    window.stop('measurement-boundary-settled'),
    window.stop('duplicate-finally'),
  ]);
  assert.deepEqual(
    calls.filter((entry) => Array.isArray(entry) && entry[0] === 'end'),
    [
      [
        'end',
        { status: 'window-ended', reason: 'measurement-boundary-settled' },
      ],
    ],
  );
  assert.equal(window.record.status, 'complete');
});

test('late profile startup rejection does not strand the capture window', async () => {
  const window = createFirstMotionCpuProfileWindow({
    enabled: true,
    profileRunner: async () => {
      throw new Error('bounded CDP startup failure');
    },
  });
  await window.started;
  assert.equal(window.record.status, 'failed');
  assert.match(window.record.error.message, /startup failure/);
  assert.equal((await window.stop('capture-failed')).status, 'failed');
});

test('first-motion window integrates the bounded CDP runner and indexed sidecar', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-first-motion-profile-'),
  );
  try {
    const methods = [];
    const profile = {
      startTime: 1000,
      endTime: 3000,
      nodes: [
        {
          id: 1,
          callFrame: {
            functionName: 'motionUpdate',
            scriptId: '1',
            url: '/src/app.js',
            lineNumber: 10,
            columnNumber: 2,
          },
        },
      ],
      samples: [1, 1],
      timeDeltas: [1000, 1000],
    };
    const page = {
      async createCDPSession() {
        return {
          async send(method) {
            methods.push(method);
            return method === 'Profiler.stop' ? { profile } : {};
          },
          async detach() {
            methods.push('detach');
          },
        };
      },
    };
    const window = createFirstMotionCpuProfileWindow({
      enabled: true,
      profileRunner: runBoundedBoundaryProfile,
      page,
      artifactDirectory,
    });
    await window.started;
    assert.equal(window.record.profilerStarted, true);
    assert.deepEqual(methods.slice(0, 3), [
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
    ]);
    const result = await window.stop('measurement-boundary-failed');
    assert.equal(result.status, 'complete');
    assert.equal(result.stopReason, 'measurement-boundary-failed');
    assert.equal(result.performanceAcceptanceEligible, false);
    assert.deepEqual(methods.slice(-3), [
      'Profiler.stop',
      'Profiler.disable',
      'detach',
    ]);
    const index = JSON.parse(
      await readFile(
        path.join(
          artifactDirectory,
          'first-scripted-motion-cpu-profile-ref.json',
        ),
        'utf8',
      ),
    );
    assert.equal(index.profile.status, 'complete');
    assert.match(index.profile.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});
