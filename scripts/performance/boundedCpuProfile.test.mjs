import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeCpuProfile,
  runBoundedBoundaryProfile,
} from './boundedCpuProfile.mjs';

function profile() {
  return {
    startTime: 1000,
    endTime: 3000,
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: 'renderFrame',
          scriptId: '7',
          url: 'http://127.0.0.1:4173/assets/app.js',
          lineNumber: 12,
          columnNumber: 3,
        },
      },
    ],
    samples: [1, 1],
    timeDeltas: [1000, 1000],
  };
}

function fakePage({ onSend = () => ({}) } = {}) {
  const calls = [];
  const session = {
    async send(method, params) {
      calls.push([method, params]);
      return onSend(method, params);
    },
    async detach() {
      calls.push(['detach']);
    },
  };
  return {
    calls,
    page: {
      async createCDPSession() {
        return session;
      },
    },
  };
}

test('bounded boundary profile runs the operation and persists a sanitized digest sidecar', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const { page, calls } = fakePage({
      onSend(method) {
        return method === 'Profiler.stop' ? { profile: profile() } : {};
      },
    });
    let operationCount = 0;
    const result = await runBoundedBoundaryProfile({
      page,
      label: 'warmup',
      artifactDirectory,
      fileName: 'boundary-01-warmup.json',
      indexFileName: 'boundary-01-ref.json',
      operation: async () => {
        operationCount += 1;
        return 'render-result';
      },
    });
    assert.equal(result.value, 'render-result');
    assert.equal(operationCount, 1);
    assert.equal(result.profile.status, 'complete');
    assert.match(result.profile.sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.profile.performanceAcceptanceEligible, false);
    const raw = JSON.parse(
      await readFile(
        path.join(artifactDirectory, result.profile.fileName),
        'utf8',
      ),
    );
    assert.equal(raw.sampleCount, 2);
    assert.equal(raw.profile.nodes[0].callFrame.url, '/assets/app.js');
    const index = JSON.parse(
      await readFile(
        path.join(artifactDirectory, 'boundary-01-ref.json'),
        'utf8',
      ),
    );
    assert.equal(index.schema, 'gev-first-motion-cpu-profile-index/v1');
    assert.equal(index.profile.sha256, result.profile.sha256);
    assert.equal(index.performanceAcceptanceEligible, false);
    assert.deepEqual(
      calls.map(([method]) => method),
      [
        'Profiler.enable',
        'Profiler.setSamplingInterval',
        'Profiler.start',
        'Profiler.stop',
        'Profiler.disable',
        'detach',
      ],
    );
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('profile sidecar and hash index survive a later capture failure', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const laterError = new Error('later sample failed');
    const { page } = fakePage({
      onSend(method) {
        return method === 'Profiler.stop' ? { profile: profile() } : {};
      },
    });
    await assert.rejects(
      runBoundedBoundaryProfile({
        page,
        label: 'first-motion',
        artifactDirectory,
        fileName: 'first-scripted-motion-cpu-profile.json',
        indexFileName: 'first-scripted-motion-cpu-profile-ref.json',
        operation: async () => {
          throw laterError;
        },
      }),
      (error) => {
        assert.equal(error, laterError);
        assert.equal(error.renderBoundaryCpuProfile.status, 'complete');
        return true;
      },
    );
    const index = JSON.parse(
      await readFile(
        path.join(
          artifactDirectory,
          'first-scripted-motion-cpu-profile-ref.json',
        ),
        'utf8',
      ),
    );
    const bytes = await readFile(
      path.join(artifactDirectory, index.profile.fileName),
    );
    assert.equal(index.profile.byteLength, bytes.byteLength);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      index.profile.sha256,
    );
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('profile window cap stops profiling and preserves capped coverage without ending capture', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const { page, calls } = fakePage({
      onSend(method) {
        return method === 'Profiler.stop' ? { profile: profile() } : {};
      },
    });
    let releaseCapture;
    let captureFinished = false;
    const result = await runBoundedBoundaryProfile({
      page,
      label: 'first-motion',
      artifactDirectory,
      fileName: 'capped-profile.json',
      indexFileName: 'capped-profile-ref.json',
      maxWindowMs: 10,
      operation: () =>
        new Promise((resolve) => {
          releaseCapture = resolve;
        }).then((value) => {
          captureFinished = true;
          return value;
        }),
    });
    assert.equal(result.profile.status, 'incomplete');
    assert.equal(result.profile.windowCapReached, true);
    assert.equal(result.profile.windowCapMs, 10);
    assert.equal(captureFinished, false);
    assert.ok(calls.some(([method]) => method === 'Profiler.stop'));
    assert.ok(calls.some(([method]) => method === 'Profiler.disable'));
    assert.ok(calls.some(([method]) => method === 'detach'));
    releaseCapture('measurement still running');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(captureFinished, true);
    const index = JSON.parse(
      await readFile(
        path.join(artifactDirectory, 'capped-profile-ref.json'),
        'utf8',
      ),
    );
    assert.equal(index.profile.windowCapReached, true);
    assert.equal(index.performanceAcceptanceEligible, false);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('profile window cap cannot exceed the first-motion 60-second budget', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const { page, calls } = fakePage();
    await assert.rejects(
      runBoundedBoundaryProfile({
        page,
        label: 'first-motion',
        artifactDirectory,
        fileName: 'bounded-profile.json',
        maxWindowMs: 60_001,
        operation: async () => 'never-started',
      }),
      /between 1 and 60000 ms/,
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('render failure remains primary when profile stop and cleanup also fail', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const renderError = new Error('render boundary timed out');
    const { page } = fakePage({
      onSend(method) {
        if (method === 'Profiler.stop' || method === 'Profiler.disable')
          throw new Error(`${method} failed`);
        return {};
      },
    });
    await assert.rejects(
      runBoundedBoundaryProfile({
        page,
        label: 'measurement',
        artifactDirectory,
        fileName: 'boundary-02-measurement.json',
        operation: async () => {
          throw renderError;
        },
      }),
      (error) => {
        assert.equal(error, renderError);
        assert.equal(error.renderBoundaryCpuProfile.status, 'incomplete');
        assert.ok(error.renderBoundaryCpuProfile.profilerErrors.length >= 1);
        return true;
      },
    );
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('retains a valid profile sidecar when profiler cleanup is incomplete', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const { page } = fakePage({
      onSend(method) {
        return method === 'Profiler.stop' ? { profile: profile() } : {};
      },
    });
    page.createCDPSession = async () => ({
      async send(method) {
        return method === 'Profiler.stop' ? { profile: profile() } : {};
      },
      async detach() {
        throw new Error('detach failed');
      },
    });
    const result = await runBoundedBoundaryProfile({
      page,
      label: 'warmup',
      artifactDirectory,
      fileName: 'boundary-05-warmup.json',
      operation: async () => 'render-result',
    });
    assert.equal(result.profile.status, 'incomplete');
    assert.match(result.profile.profilerErrors.join(' '), /detach failed/);
    const retained = JSON.parse(
      await readFile(
        path.join(artifactDirectory, result.profile.fileName),
        'utf8',
      ),
    );
    assert.equal(retained.sampleCount, 2);
    assert.match(result.profile.sha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('late profiler session creation is detached after its bounded deadline', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    let detached = 0;
    const session = {
      async send() {
        return {};
      },
      async detach() {
        detached += 1;
      },
    };
    const page = {
      createCDPSession: () =>
        new Promise((resolve) => setTimeout(() => resolve(session), 25)),
    };
    let operationCount = 0;
    const result = await runBoundedBoundaryProfile({
      page,
      label: 'warmup',
      artifactDirectory,
      fileName: 'boundary-03-warmup.json',
      operation: async () => {
        operationCount += 1;
      },
      operationTimeoutMs: 5,
    });
    assert.equal(operationCount, 1);
    assert.equal(result.profile.status, 'incomplete');
    assert.match(result.profile.profilerErrors[0], /session creation/);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(detached, 1);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('profile payload bounds reject malformed or oversized samples without artifacts', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const invalidProfile = {
      ...profile(),
      samples: [999],
      timeDeltas: [1000],
    };
    const { page } = fakePage({
      onSend(method) {
        return method === 'Profiler.stop' ? { profile: invalidProfile } : {};
      },
    });
    const result = await runBoundedBoundaryProfile({
      page,
      label: 'warmup',
      artifactDirectory,
      fileName: 'boundary-04-warmup.json',
      operation: async () => true,
    });
    assert.equal(result.profile.status, 'incomplete');
    assert.equal(result.profile.sha256, null);
    assert.match(result.profile.profilerErrors[0], /sample identity/);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('CPU profile normalization preserves cumulative ordering and redacts local paths', () => {
  const value = profile();
  value.endTime = 4000;
  value.nodes[0].callFrame.url = 'file:///C:/Users/private/app.js';
  value.samples = [1, 1, 1];
  value.timeDeltas = [2000, -500, 1000];
  const normalized = normalizeCpuProfile(value);
  assert.equal(normalized.sampleCount, 3);
  assert.equal(
    normalized.profile.nodes[0].callFrame.url,
    '[non-fixture source]',
  );
  assert.ok(normalized.topLocations[0].sampledWeightMs >= 0);
});

test('CPU profile URL allowlist treats relative and local absolute paths equally', () => {
  const profileData = profile();
  profileData.nodes = [
    '/scripts/fixture.js',
    'http://127.0.0.1:4173/scripts/fixture.js',
    '/src/app.js',
    '/@fs/C:/Users/Privat/private.js',
    'http://127.0.0.1:4173/@fs/C:/Users/Privat/private.js',
  ].map((url, index) => ({
    id: index + 1,
    callFrame: {
      functionName: `work${index}`,
      scriptId: '7',
      url,
      lineNumber: 1,
      columnNumber: 1,
    },
  }));
  profileData.samples = [1, 2, 3, 4, 5];
  profileData.timeDeltas = [400, 400, 400, 400, 400];
  const normalized = normalizeCpuProfile(profileData);
  assert.equal(
    normalized.profile.nodes[0].callFrame.url,
    '/scripts/fixture.js',
  );
  assert.equal(
    normalized.profile.nodes[1].callFrame.url,
    '/scripts/fixture.js',
  );
  assert.ok(
    normalized.topLocations.some(
      (entry) => entry.url === '/scripts/fixture.js',
    ),
  );
  assert.ok(
    normalized.topLocations.some((entry) => entry.url === '/src/app.js'),
  );
  assert.equal(
    normalized.topLocations.some((entry) => entry.url.includes('Users')),
    false,
  );
  assert.equal(
    normalized.topLocations.filter(
      (entry) => entry.url === '[non-fixture source]',
    ).length,
    2,
  );
});

test('profiler command timeouts are bounded while the render operation still runs', async () => {
  const artifactDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'gev-boundary-profile-'),
  );
  try {
    const calls = [];
    const page = {
      async createCDPSession() {
        return {
          send(method) {
            calls.push(method);
            return method === 'Profiler.enable'
              ? new Promise(() => {})
              : Promise.resolve({});
          },
          async detach() {
            calls.push('detach');
          },
        };
      },
    };
    let operationCount = 0;
    const startedAt = Date.now();
    const result = await runBoundedBoundaryProfile({
      page,
      label: 'warmup',
      artifactDirectory,
      fileName: 'boundary-06-warmup-boundary.json',
      operation: async () => {
        operationCount += 1;
      },
      operationTimeoutMs: 8,
    });
    assert.equal(operationCount, 1);
    assert.ok(Date.now() - startedAt < 100);
    assert.equal(result.profile.status, 'incomplete');
    assert.match(result.profile.profilerErrors.join(' '), /Profiler\.enable/);
    assert.ok(calls.includes('Profiler.disable'));
    assert.ok(calls.includes('detach'));
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});
