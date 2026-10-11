import assert from 'node:assert/strict';
import test from 'node:test';
import {
  startImportLoadProfile,
  summarizeImportHeapProfile,
  validateImportLoadProfileFixture,
  IMPORT_LOAD_PROFILE_SCOPE,
} from './importLoadProfile.mjs';
import { runControlledImportLoadProfile } from './importLoadProfileControl.mjs';

const cpuProfile = () => ({
  startTime: 1,
  endTime: 5001,
  nodes: [
    {
      id: 1,
      callFrame: {
        functionName: 'loadAsync',
        url: 'http://127.0.0.1:4184/src/imports/runtimeLayer.js',
        lineNumber: 20,
        columnNumber: 1,
      },
    },
  ],
  samples: [1, 1, 1],
  timeDeltas: [2000, 1000, 2000],
});

class FakeSession {
  calls = [];
  detached = 0;
  response = new Map();
  failure = null;

  async send(method, params) {
    this.calls.push({ method, params });
    if (this.failure === method) throw new Error(`${method} failed`);
    const response = this.response.get(method);
    return typeof response === 'function' ? response() : response;
  }

  async detach() {
    this.detached++;
  }
}

function pageFor(session) {
  return { createCDPSession: async () => session };
}

function button() {
  const listeners = new Set();
  return {
    hidden: true,
    addEventListener(name, listener) {
      assert.equal(name, 'click');
      listeners.add(listener);
    },
    removeEventListener(name, listener) {
      assert.equal(name, 'click');
      listeners.delete(listener);
    },
    click() {
      for (const listener of [...listeners]) listener();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function fixtureResult(mode = 'cpu') {
  return {
    applicationCommit: 'a'.repeat(40),
    harnessCommit: 'a'.repeat(40),
    fixture: 'synthetic-5000-import-points/v1',
    status: 'passed',
    importLoadProfile: {
      mode,
      performanceAcceptanceEligible: false,
      phases: {
        setupStartedAtMs: 1,
        setupReadyAtMs: 2,
        profilerGateReadyAtMs: 3,
        loadingStartedAtMs: 4,
        loadingEndedAtMs: 5,
        captureStartedAtMs: 6,
        captureEndedAtMs: 7,
        teardownStartedAtMs: 8,
        teardownEndedAtMs: 9,
        profileStopRequestedBeforeCapture: true,
      },
      workload: { featureCountAfter: 5000, pendingJobsAfter: 0 },
    },
    samples: [
      {
        pixelSha256: 'b'.repeat(64),
        capture: { completed: true },
      },
    ],
    checks: [
      {
        id: 'single-profiled-load-separated-from-capture-and-teardown',
        status: 'passed',
      },
    ],
  };
}

function profileResult(mode = 'cpu') {
  return {
    mode,
    performanceAcceptanceEligible: false,
    profileScope: IMPORT_LOAD_PROFILE_SCOPE,
    nodeCount: 2,
    groupedLocations: 1,
    omittedLocations: 0,
    topLocations: [
      mode === 'cpu'
        ? {
            functionName: 'sampled',
            url: '/fixture.js',
            samples: 3,
            sampledWeightMs: 5,
          }
        : {
            functionName: 'sampled',
            url: '/fixture.js',
            nodes: 1,
            sampledBytes: 4096,
          },
    ],
    recomputation: 'bounded summary only',
    ...(mode === 'cpu'
      ? {
          sampleCount: 1,
          profileWindowMs: 5,
          totalSampleWeightMs: 5,
          profile: {
            startTime: 1,
            endTime: 5001,
            nodes: [
              {
                id: 1,
                callFrame: { functionName: 'sampled', url: '/fixture.js' },
                children: [],
              },
            ],
            samples: [1],
            timeDeltas: [5000],
          },
        }
      : {
          sampleCount: 1,
          sampledAllocationBytes: 4096,
          truncated: false,
        }),
    control: {
      fixtureReadyGateObserved: true,
      loadCompleteGateObserved: true,
      profilerStoppedBeforeFinishControl: true,
      captureAndTeardownOutsideProfile: true,
    },
  };
}

test('loading CPU profile is bounded to its owned CDP start/stop session', async () => {
  const session = new FakeSession();
  session.response.set('Profiler.stop', { profile: cpuProfile() });
  const owner = await startImportLoadProfile(pageFor(session), 'cpu');
  const report = await owner.stop();
  assert.equal(report.mode, 'cpu');
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.profileScope, IMPORT_LOAD_PROFILE_SCOPE);
  assert.equal(report.sampleCount, 3);
  assert.equal(report.profile.nodes.length, 1);
  assert.equal(
    report.profile.nodes[0].callFrame.url,
    '/src/imports/runtimeLayer.js',
  );
  assert.equal(report.profile.samples.length, 3);
  assert.deepEqual(
    session.calls.map(({ method }) => method),
    [
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
      'Profiler.stop',
      'Profiler.disable',
    ],
  );
  assert.equal(session.detached, 1);
  await assert.rejects(owner.stop(), /already stopped/);
});

test('heap profile includes collected objects and returns only bounded callsite summaries', async () => {
  const session = new FakeSession();
  session.response.set('HeapProfiler.stopSampling', {
    profile: {
      head: {
        callFrame: { functionName: '(root)' },
        selfSize: 0,
        children: [
          {
            callFrame: {
              functionName: 'createImportedEntity',
              url: 'http://127.0.0.1:4184/src/imports/runtimeLayer.js?secret=no',
              lineNumber: 42,
              columnNumber: 4,
            },
            selfSize: 4096,
            children: [],
          },
        ],
      },
      samples: [{ size: 4096, nodeId: 2, ordinal: 1 }],
    },
  });
  const owner = await startImportLoadProfile(pageFor(session), 'heap');
  const report = await owner.stop();
  assert.equal(report.mode, 'heap');
  assert.equal(report.sampledAllocationBytes, 4096);
  assert.equal(report.sampleCount, 1);
  assert.equal(report.truncated, false);
  assert.equal(report.topLocations[0].functionName, 'createImportedEntity');
  assert.equal(report.topLocations[0].url, '/src/imports/runtimeLayer.js');
  assert.doesNotMatch(JSON.stringify(report), /secret/);
  const start = session.calls.find(
    ({ method }) => method === 'HeapProfiler.startSampling',
  );
  assert.deepEqual(start.params, {
    samplingInterval: 16_384,
    stackDepth: 64,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  assert.equal(session.detached, 1);
});

test('heap summaries reject malformed or unbounded profile branches', () => {
  assert.throws(
    () => summarizeImportHeapProfile({ head: { selfSize: -1, children: [] } }),
    /Invalid loading heap profile/,
  );
  assert.throws(
    () => summarizeImportHeapProfile({ head: { selfSize: 0, children: [] } }),
    /Invalid loading heap profile/,
  );
  assert.throws(
    () =>
      summarizeImportHeapProfile({
        head: {
          callFrame: { functionName: 'root' },
          selfSize: 0,
          children: [],
        },
        samples: [{ size: -1, nodeId: 1, ordinal: 1 }],
      }),
    /malformed sample/,
  );
  const deepRoot = {
    callFrame: { functionName: 'root' },
    selfSize: 0,
    children: [],
  };
  let cursor = deepRoot;
  for (let depth = 0; depth < 66; depth++) {
    const child = {
      callFrame: { functionName: `depth${depth}` },
      selfSize: 0,
      children: [],
    };
    cursor.children.push(child);
    cursor = child;
  }
  const truncated = summarizeImportHeapProfile({
    head: deepRoot,
    samples: [{ size: 0, nodeId: 1, ordinal: 1 }],
  });
  assert.equal(truncated.truncated, true);
});

test('single-load report validator accepts CPU and heap diagnostic shapes', () => {
  for (const mode of ['cpu', 'heap']) {
    const result = validateImportLoadProfileFixture({
      fixtureReport: fixtureResult(mode),
      profileReport: profileResult(mode),
      mode,
      commit: 'a'.repeat(40),
    });
    assert.deepEqual(result, { valid: true, errors: [] });
  }
});

test('single-load report validator rejects wrong source, missing capture, and malformed phases', () => {
  const fixture = fixtureResult();
  fixture.harnessCommit = 'c'.repeat(40);
  fixture.samples[0].capture.completed = false;
  fixture.importLoadProfile.phases.captureStartedAtMs = 0;
  const result = validateImportLoadProfileFixture({
    fixtureReport: fixture,
    profileReport: profileResult(),
    mode: 'cpu',
    commit: 'a'.repeat(40),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(';'), /commit identity mismatch/);
  assert.match(result.errors.join(';'), /phase ordering is incomplete/);
  assert.match(result.errors.join(';'), /capture is incomplete/);
});

test('single-load heap report requires allocation summary without CPU sample fields', () => {
  const report = profileResult('heap');
  delete report.sampledAllocationBytes;
  const result = validateImportLoadProfileFixture({
    fixtureReport: fixtureResult('heap'),
    profileReport: report,
    mode: 'heap',
    commit: 'a'.repeat(40),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(';'), /heap profile summary is incomplete/);
});

test('single-load report validator rejects malformed containers and truncated profiles', () => {
  const malformedFixture = fixtureResult();
  malformedFixture.checks = { passed: true };
  malformedFixture.samples = { length: 1, 0: fixtureResult().samples[0] };
  assert.equal(
    validateImportLoadProfileFixture({
      fixtureReport: malformedFixture,
      profileReport: profileResult(),
      mode: 'cpu',
      commit: 'a'.repeat(40),
    }).valid,
    false,
  );

  const truncatedHeapProfile = profileResult('heap');
  truncatedHeapProfile.truncated = true;
  const result = validateImportLoadProfileFixture({
    fixtureReport: fixtureResult('heap'),
    profileReport: truncatedHeapProfile,
    mode: 'heap',
    commit: 'a'.repeat(40),
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(';'), /heap profile summary is incomplete/);

  const malformedLocation = profileResult('cpu');
  malformedLocation.topLocations = [{ functionName: 'sampled' }];
  const malformedResult = validateImportLoadProfileFixture({
    fixtureReport: fixtureResult('cpu'),
    profileReport: malformedLocation,
    mode: 'cpu',
    commit: 'a'.repeat(40),
  });
  assert.equal(malformedResult.valid, false);
  assert.match(malformedResult.errors.join(';'), /profile summary locations/);

  const malformedCpuArrays = profileResult();
  malformedCpuArrays.profile.nodes = { length: 1 };
  const malformedCpuResult = validateImportLoadProfileFixture({
    fixtureReport: fixtureResult(),
    profileReport: malformedCpuArrays,
    mode: 'cpu',
    commit: 'a'.repeat(40),
  });
  assert.equal(malformedCpuResult.valid, false);
  assert.match(
    malformedCpuResult.errors.join(';'),
    /CPU profile summary is incomplete/,
  );

  const nullCheck = fixtureResult();
  nullCheck.checks = [null];
  assert.equal(
    validateImportLoadProfileFixture({
      fixtureReport: nullCheck,
      profileReport: profileResult(),
      mode: 'cpu',
      commit: 'a'.repeat(40),
    }).valid,
    false,
  );
});

test('profile startup failure detaches and preserves the CDP error', async () => {
  const session = new FakeSession();
  session.failure = 'HeapProfiler.startSampling';
  await assert.rejects(
    startImportLoadProfile(pageFor(session), 'heap'),
    /HeapProfiler.startSampling failed/,
  );
  assert.equal(session.detached, 1);
  assert.deepEqual(
    session.calls.map(({ method }) => method),
    [
      'HeapProfiler.enable',
      'HeapProfiler.startSampling',
      'HeapProfiler.stopSampling',
      'HeapProfiler.disable',
    ],
  );
});

test('partial profiler start failure stops, disables and detaches without masking the error', async () => {
  const session = new FakeSession();
  session.failure = 'Profiler.start';
  await assert.rejects(
    startImportLoadProfile(pageFor(session), 'cpu'),
    /Profiler.start failed/,
  );
  assert.deepEqual(
    session.calls.map(({ method }) => method),
    [
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
      'Profiler.stop',
      'Profiler.disable',
    ],
  );
  assert.equal(session.detached, 1);
});

test('profile creation deadline rejects a stalled CDP session request', async () => {
  await assert.rejects(
    startImportLoadProfile(
      { createCDPSession: () => new Promise(() => {}) },
      'cpu',
      { timeoutMs: 10, cleanupTimeoutMs: 10 },
    ),
    /session creation timed out/,
  );
});

test('late CDP session resolution after the creation deadline is detached', async () => {
  let resolveSession;
  const session = new FakeSession();
  const page = {
    createCDPSession: () =>
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
  };
  await assert.rejects(
    startImportLoadProfile(page, 'cpu', {
      timeoutMs: 10,
      cleanupTimeoutMs: 20,
    }),
    /session creation timed out/,
  );
  resolveSession(session);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.detached, 1);
});

test('profile stop timeout still disables and detaches the owned session', async () => {
  const session = new FakeSession();
  session.response.set('Profiler.stop', () => new Promise(() => {}));
  const owner = await startImportLoadProfile(pageFor(session), 'cpu', {
    timeoutMs: 10,
    cleanupTimeoutMs: 10,
  });
  await assert.rejects(owner.stop(), /Import load profile stop timed out/);
  assert.equal(session.detached, 1);
  assert.ok(session.calls.some(({ method }) => method === 'Profiler.disable'));
});

test('fixture gates one load between profiler controls and capture', async () => {
  const startButton = button();
  const finishButton = button();
  const states = [];
  const events = [];
  let now = 10;
  let loadedResolve;
  const loaded = new Promise((resolve) => {
    loadedResolve = resolve;
  });
  const controlled = runControlledImportLoadProfile({
    startButton,
    finishButton,
    publishState(state) {
      states.push(state);
      events.push(`state:${state}`);
      if (state === 'loaded') loadedResolve();
    },
    now: () => now,
    load: async () => {
      events.push('load');
      now = 25;
      return 'loaded';
    },
    timeoutMs: 100,
  });
  await Promise.resolve();
  assert.equal(startButton.hidden, false);
  assert.equal(finishButton.hidden, true);
  assert.deepEqual(events, ['state:ready']);
  startButton.click();
  await loaded;
  assert.deepEqual(events, [
    'state:ready',
    'state:loading',
    'load',
    'state:loaded',
  ]);
  assert.equal(finishButton.hidden, false);
  assert.equal(states.at(-1), 'loaded');
  events.push('stop-profiler');
  finishButton.click();
  const result = await controlled;
  events.push('capture');
  assert.deepEqual(result, { value: 'loaded', loadStartMs: 10, loadEndMs: 25 });
  assert.deepEqual(events, [
    'state:ready',
    'state:loading',
    'load',
    'state:loaded',
    'stop-profiler',
    'capture',
  ]);
  assert.equal(startButton.hidden, true);
  assert.equal(finishButton.hidden, true);
  assert.equal(startButton.listenerCount, 0);
  assert.equal(finishButton.listenerCount, 0);
});

test('controlled import gate releases both buttons when loading fails', async () => {
  const startButton = button();
  const finishButton = button();
  const states = [];
  const controlled = runControlledImportLoadProfile({
    startButton,
    finishButton,
    publishState: (state) => states.push(state),
    load: async () => {
      throw new Error('load failed');
    },
    timeoutMs: 100,
  });
  await Promise.resolve();
  startButton.click();
  await assert.rejects(controlled, /load failed/);
  assert.deepEqual(states, ['ready', 'loading', 'failed']);
  assert.equal(startButton.hidden, true);
  assert.equal(finishButton.hidden, true);
  assert.equal(startButton.listenerCount, 0);
  assert.equal(finishButton.listenerCount, 0);
});

test('controlled import gate bounds a missing profiler start click', async () => {
  const startButton = button();
  const finishButton = button();
  const states = [];
  await assert.rejects(
    runControlledImportLoadProfile({
      startButton,
      finishButton,
      publishState: (state) => states.push(state),
      load: async () => true,
      timeoutMs: 10,
    }),
    /control timed out/,
  );
  assert.deepEqual(states, ['ready', 'failed']);
  assert.equal(startButton.hidden, true);
  assert.equal(startButton.listenerCount, 0);
});

test('controlled import gate bounds a missing profiler stop click', async () => {
  const startButton = button();
  const finishButton = button();
  const states = [];
  const controlled = runControlledImportLoadProfile({
    startButton,
    finishButton,
    publishState: (state) => states.push(state),
    load: async () => true,
    timeoutMs: 30,
  });
  await Promise.resolve();
  startButton.click();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1), 'loaded');
  assert.equal(finishButton.hidden, false);
  await assert.rejects(controlled, /control timed out/);
  assert.deepEqual(states, ['ready', 'loading', 'loaded', 'failed']);
  assert.equal(startButton.hidden, true);
  assert.equal(finishButton.hidden, true);
  assert.equal(finishButton.listenerCount, 0);
});
