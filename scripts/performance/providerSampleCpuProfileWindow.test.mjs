import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBoundedBoundaryProfile } from './boundedCpuProfile.mjs';
import {
  createProviderSampleCpuProfileWindow,
  isProviderSampleCpuProfileTarget,
  upsertProviderSampleCpuProfile,
} from './providerSampleCpuProfileWindow.mjs';

function profile(durationMs = 2) {
  return {
    startTime: 1000,
    endTime: 1000 + durationMs * 1000,
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: 'fixtureUpdate',
          scriptId: '1',
          url: '/src/app.js',
          lineNumber: 10,
          columnNumber: 2,
        },
      },
    ],
    samples: [1, 1],
    timeDeltas: [durationMs * 500, durationMs * 500],
  };
}

const target = {
  targetScenario: 'idle',
  targetRun: 2,
  captureOrdinal: 1,
  documentRole: 'main-capture',
  documentId: 'document-02',
};

test('profile target selection is exactly two idle samples and first motion', () => {
  assert.deepEqual(
    [
      ['idle', 1],
      ['idle', 2],
      ['idle', 3],
      ['scripted-motion', 1],
      ['scripted-motion', 2],
      ['selected-aircraft-tracking', 1],
    ].map(([scenario, run]) => isProviderSampleCpuProfileTarget(scenario, run)),
    [true, true, false, true, false, false],
  );
});

test('profile record insertion is idempotent for synchronous runner callbacks', () => {
  const records = [];
  const initial = { captureOrdinal: 5, status: 'recording' };
  upsertProviderSampleCpuProfile(records, initial);
  upsertProviderSampleCpuProfile(records, initial);
  assert.deepEqual(records, [initial]);
  const completed = { captureOrdinal: 5, status: 'complete' };
  upsertProviderSampleCpuProfile(records, completed);
  assert.deepEqual(records, [completed]);
});

test('disabled provider sample profiles perform no profiler or artifact work', async () => {
  let calls = 0;
  const window = createProviderSampleCpuProfileWindow({
    enabled: false,
    profileRunner: () => {
      calls += 1;
    },
    ...target,
  });
  assert.equal(window.record, null);
  assert.equal(await window.started, null);
  assert.equal(await window.stop('capture-finished'), null);
  assert.equal(calls, 0);
});

test('sample profile binds scenario, ordinal and actual document identity', async () => {
  const calls = [];
  const profileRunner = async (options) => {
    calls.push(options);
    options.onStarted({ profilerStarted: true });
    await options.operation();
    options.onProfile({
      status: 'complete',
      sha256: 'a'.repeat(64),
      fileName: options.fileName,
    });
  };
  const window = createProviderSampleCpuProfileWindow({
    enabled: true,
    profileRunner,
    ...target,
    onRecord: (record) => calls.push(record.status),
  });
  await window.started;
  assert.equal(window.record.documentRole, target.documentRole);
  assert.equal(window.record.documentId, target.documentId);
  assert.equal(calls[0].fileName, 'provider-idle-2-cpu-profile.json');
  assert.deepEqual(calls[0].target, {
    scenario: 'idle',
    run: 2,
    captureOrdinal: 1,
    documentRole: target.documentRole,
    documentId: target.documentId,
  });
  await window.stop('measurement-boundary-settled');
  assert.equal(window.record.status, 'complete');
});

test('first motion profile accepts ordinal five from a five-run route', async () => {
  let runnerTarget;
  const window = createProviderSampleCpuProfileWindow({
    enabled: true,
    profileRunner: async (options) => {
      runnerTarget = options.target;
      options.onStarted({ profilerStarted: true });
      await options.operation();
      options.onProfile({ status: 'complete' });
    },
    targetScenario: 'scripted-motion',
    targetRun: 1,
    captureOrdinal: 5,
    documentRole: 'provider-sample-6',
    documentId: 'document-6',
  });
  await window.started;
  await window.stop('measurement-boundary-settled');
  assert.equal(window.record.captureOrdinal, 5);
  assert.equal(runnerTarget.captureOrdinal, 5);
});

test('sample profile rejects incomplete or invalid target identity', () => {
  assert.throws(
    () =>
      createProviderSampleCpuProfileWindow({
        enabled: true,
        profileRunner: () => {},
        ...target,
        documentId: '',
      }),
    /target identity is invalid/,
  );
});

test('failed startup is recorded and does not strand the sample operation', async () => {
  const window = createProviderSampleCpuProfileWindow({
    enabled: true,
    ...target,
    profileRunner: async () => {
      throw new Error('bounded CDP startup failure');
    },
  });
  await window.started;
  assert.equal(window.record.status, 'failed');
  assert.match(window.record.error.message, /startup failure/);
  assert.equal((await window.stop('capture-failed')).status, 'failed');
});

test('real runner writes target-bound sidecar and index', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-provider-profile-'),
  );
  try {
    const methods = [];
    const page = {
      async createCDPSession() {
        return {
          async send(method) {
            methods.push(method);
            return method === 'Profiler.stop' ? { profile: profile() } : {};
          },
          async detach() {
            methods.push('detach');
          },
        };
      },
    };
    const window = createProviderSampleCpuProfileWindow({
      enabled: true,
      profileRunner: runBoundedBoundaryProfile,
      page,
      artifactDirectory,
      ...target,
    });
    await window.started;
    const result = await window.stop('measurement-boundary-failed');
    assert.equal(result.status, 'complete');
    assert.equal(result.stopReason, 'measurement-boundary-failed');
    assert.equal(result.profile.stopOverrunMs, 0);
    assert.deepEqual(methods.slice(-3), [
      'Profiler.stop',
      'Profiler.disable',
      'detach',
    ]);
    const index = JSON.parse(
      await readFile(
        path.join(artifactDirectory, 'provider-idle-2-cpu-profile-ref.json'),
        'utf8',
      ),
    );
    assert.equal(index.schema, 'gev-provider-sample-cpu-profile-index/v1');
    assert.deepEqual(index.target, {
      scenario: 'idle',
      run: 2,
      captureOrdinal: 1,
      documentRole: target.documentRole,
      documentId: target.documentId,
    });
    assert.equal(index.profile.status, 'complete');
    assert.match(index.profile.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('a bounded stop overrun is retained with actual duration and incomplete status', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-provider-profile-overrun-'),
  );
  try {
    const page = {
      async createCDPSession() {
        return {
          async send(method) {
            return method === 'Profiler.stop' ? { profile: profile(25) } : {};
          },
          async detach() {},
        };
      },
    };
    const operation = new Promise(() => {});
    const resultPromise = runBoundedBoundaryProfile({
      page,
      label: 'test-window',
      target: { scenario: 'idle', run: 2, ...target },
      artifactDirectory,
      fileName: 'provider-idle-2-cpu-profile.json',
      indexFileName: 'provider-idle-2-cpu-profile-ref.json',
      maxWindowMs: 20,
      operation: () => operation,
      operationTimeoutMs: 2000,
    });
    const result = await resultPromise;
    assert.equal(result.profile.windowCapReached, true);
    assert.equal(result.profile.windowCapMs, 20);
    assert.equal(result.profile.profileWindowMs, 25);
    assert.equal(result.profile.stopOverrunMs, 5);
    assert.equal(result.profile.status, 'incomplete');
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('profile delivery beyond the existing stop bound is explicitly rejected', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-provider-profile-stop-bound-'),
  );
  try {
    const page = {
      async createCDPSession() {
        return {
          async send(method) {
            return method === 'Profiler.stop' ? { profile: profile(2021) } : {};
          },
          async detach() {},
        };
      },
    };
    const result = await runBoundedBoundaryProfile({
      page,
      label: 'test-window',
      target: { scenario: 'idle', run: 1, ...target },
      artifactDirectory,
      fileName: 'provider-idle-1-cpu-profile.json',
      indexFileName: 'provider-idle-1-cpu-profile-ref.json',
      maxWindowMs: 20,
      operation: () => new Promise(() => {}),
      operationTimeoutMs: 2000,
    });
    assert.equal(result.profile.status, 'incomplete');
    assert.equal(result.profile.sha256, null);
    assert.match(result.profile.profilerErrors[0], /time bounds/);
    await assert.rejects(
      readFile(
        path.join(artifactDirectory, 'provider-idle-1-cpu-profile.json'),
      ),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});
