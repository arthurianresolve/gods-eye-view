import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const identity = (path) => {
  const bytes = read(path);
  return {
    path,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
};
const base =
  'docs/performance-evidence/s48-current-dev-capture/hosted-38270552137';
const review = JSON.parse(read(`${base}/review.json`));
const profiles = [];
for (const stem of [
  'provider-idle-1',
  'provider-idle-2',
  'provider-scripted-motion-1',
]) {
  const index = `${base}/${stem}-cpu-profile-ref.json`;
  const ref = JSON.parse(read(index));
  const actual = identity(`${base}/${ref.profile.fileName}`);
  assert.equal(actual.sha256, ref.profile.sha256);
  assert.equal(actual.byteLength, ref.profile.byteLength);
  const raw = JSON.parse(read(actual.path)).profile;
  const nodes = new Map(raw.nodes.map((node) => [node.id, node]));
  assert.equal(raw.samples.length, raw.timeDeltas.length);
  let queryUs = 0;
  for (let i = 0; i < raw.samples.length; i += 1) {
    assert(nodes.has(raw.samples[i]));
    assert(Number.isFinite(raw.timeDeltas[i]) && raw.timeDeltas[i] >= 0);
    if (
      nodes.get(raw.samples[i]).callFrame.functionName === 'getProgramParameter'
    )
      queryUs += raw.timeDeltas[i];
  }
  const prior = review.profiles.find(
    (entry) =>
      entry.scenario === ref.target.scenario && entry.run === ref.target.run,
  );
  assert(
    Math.abs(queryUs / 1000 - prior.topLeafWeightsMs.getProgramParameter) <
      0.000001,
  );
  profiles.push({
    scenario: ref.target.scenario,
    run: ref.target.run,
    profile: actual,
    index: identity(index),
    profileWindowMs: (raw.endTime - raw.startTime) / 1000,
    sampledGetProgramParameterMs: queryUs / 1000,
    sampleCount: raw.samples.length,
  });
}
const lock = JSON.parse(read('package-lock.json'));
const sources = [
  'node_modules/@cesium/engine/Source/Renderer/ShaderProgram.js',
  'node_modules/@cesium/engine/Source/Renderer/ShaderCache.js',
  'node_modules/@cesium/engine/Source/Renderer/Context.js',
  'node_modules/@cesium/engine/Source/Scene/Primitive.js',
].map(identity);
const inspectedAudit = JSON.parse(
  readFileSync(new URL('source-audit.json', import.meta.url)),
);
assert.deepEqual(
  sources,
  inspectedAudit.sources,
  'Engine source changed; repeat manual source inspection before updating findings.',
);
const audit = {
  schema: 'gev-shader-program-source-attribution/v1',
  testedCaptureCommit: review.testedCommit,
  captureRun: review.runUrl,
  captureStatus: review.captureStatus,
  packageLock: identity('package-lock.json'),
  versions: {
    cesium: lock.packages['node_modules/cesium'].version,
    engine: lock.packages['node_modules/@cesium/engine'].version,
  },
  profiles,
  sources,
  findings: [
    {
      source: 'ShaderProgram.js:458',
      finding:
        'initialize returns without reinitialization when the program already exists.',
    },
    {
      source: 'ShaderProgram.js:217,304,471',
      finding:
        'Program initialization reads LINK_STATUS, ACTIVE_UNIFORMS and ACTIVE_ATTRIBUTES after creating/linking the program.',
    },
    {
      source: 'ShaderProgram.js:595; Context.js:75',
      finding:
        'VALIDATE_STATUS is read only in the validation branch; Context initializes validateShaderProgram to false.',
    },
    {
      source: 'ShaderCache.js:95-146',
      finding:
        'The cache keys vertex/fragment ShaderSource cache keys plus sorted attribute locations and reuses the existing shader program on a hit.',
    },
    {
      source: 'Primitive.js:1724-1753; ShaderProgram.js:110',
      finding:
        'Primitive shader creation obtains a cache program and accesses vertex attributes through a getter that initializes it on first use.',
    },
    {
      source: 'ShaderProgram.js:503-522',
      finding:
        'A separate SpectorJS shader editor callback can explicitly reinitialize a program; these profiles do not establish that callback ran.',
    },
  ],
  inference:
    'Profile parent stacks and pinned source are consistent with initialization/first-use link/query synchronization. They do not show a readiness polling loop on an already initialized cached program.',
  limitations: [
    'CPU sample weights include synchronous native waiting; they are not measured GPU duration or precise CPU execution time.',
    'Profiles contain no WebGL program IDs or pname argument values; first initialization versus repeated queries cannot be resolved for every sample.',
    'No branch-origin, physical Windows root-cause, or performance-benefit claim follows.',
    'The new observer must preserve original GL semantics and report its observation window separately from these historical profile windows.',
    'Source findings are manual inspection notes. This script recomputes profile weights and file identities; it does not automatically prove the source interpretation.',
  ],
};
writeFileSync(
  new URL('source-audit.json', import.meta.url),
  `${JSON.stringify(audit, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    versions: audit.versions,
    profiles: profiles.map(
      ({ scenario, run, sampledGetProgramParameterMs, profileWindowMs }) => ({
        scenario,
        run,
        sampledGetProgramParameterMs,
        profileWindowMs,
      }),
    ),
  }),
);
