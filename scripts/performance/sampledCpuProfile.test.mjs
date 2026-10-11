import assert from 'node:assert/strict';
import test from 'node:test';
import {
  summarizeCpuProfile,
  startFixtureCpuProfile,
} from './sampledCpuProfile.mjs';

function fixture() {
  return {
    startTime: 0,
    endTime: 6000,
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: '(idle)',
          url: '',
          lineNumber: -1,
          columnNumber: -1,
        },
      },
      {
        id: 2,
        callFrame: {
          functionName: 'build',
          url: 'http://127.0.0.1:4184/src/imports/runtimeLayer.js?cache=private#fragment',
          lineNumber: 70,
          columnNumber: 2,
        },
      },
      {
        id: 3,
        callFrame: {
          functionName: 'unrelated',
          url: 'https://secret.example/token?credential=test',
          lineNumber: 0,
          columnNumber: 0,
        },
      },
    ],
    samples: [1, 2, 2, 3],
    timeDeltas: [2000, 1000, 2000, 1000],
  };
}

test('CPU attribution groups self samples without counting ancestors twice and strips URL details', () => {
  const report = summarizeCpuProfile(fixture());
  assert.equal(report.totalSampleWeightMs, 6);
  assert.equal(report.performanceAcceptanceEligible, false);
  assert.equal(report.topLocations[0].functionName, 'build');
  assert.equal(report.topLocations[0].sampledWeightMs, 3);
  assert.equal(report.topLocations[0].samples, 2);
  assert.equal(
    report.profile.nodes[1].callFrame.url,
    '/src/imports/runtimeLayer.js',
  );
  assert.equal(report.profile.nodes[2].callFrame.url, '[non-fixture source]');
  assert.doesNotMatch(
    JSON.stringify(report),
    /credential|private|secret\.example|4184/,
  );
});

test('CPU attribution rejects incomplete, invalid or unbounded sampling data', () => {
  for (const mutate of [
    (p) => {
      p.samples = [];
    },
    (p) => {
      p.timeDeltas.pop();
    },
    (p) => {
      p.timeDeltas[0] = -1;
    },
    (p) => {
      p.samples[0] = 404;
    },
    (p) => {
      p.nodes.push(p.nodes[0]);
    },
    (p) => {
      p.endTime = -1;
    },
    (p) => {
      p.samples = new Array(250001).fill(1);
      p.timeDeltas = new Array(250001).fill(1);
    },
  ]) {
    const profile = fixture();
    mutate(profile);
    assert.throws(() => summarizeCpuProfile(profile), /Invalid CPU profile/);
  }
});

test('profiler owns startup, normal stop and failed-stop session cleanup', async () => {
  for (const failure of [
    null,
    'Profiler.start',
    'Profiler.stop',
    'Profiler.disable',
  ]) {
    const calls = [];
    const page = {
      async createCDPSession() {
        return {
          async send(method) {
            calls.push(method);
            if (method === failure) throw new Error(failure);
            return { profile: fixture() };
          },
          async detach() {
            calls.push('detach');
          },
        };
      },
    };
    if (failure === 'Profiler.start')
      await assert.rejects(startFixtureCpuProfile(page), /Profiler.start/);
    else {
      const owner = await startFixtureCpuProfile(page);
      if (failure) await assert.rejects(owner.stop(), new RegExp(failure));
      else assert.equal((await owner.stop()).sampleCount, 4);
      await assert.rejects(owner.stop(), /already stopped/);
    }
    assert.equal(calls.filter((method) => method === 'detach').length, 1);
    assert.equal(calls.at(-1), 'detach');
  }
});
