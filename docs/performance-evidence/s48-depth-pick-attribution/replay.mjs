// Read-only replay of preserved statistical CPU samples, independent of the
// capture harness. Run from any directory; stdout is the derived review JSON.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const inputs = [
  [
    's47-observation-retirement-38237890055',
    'provider-idle-1',
    '06aac1ebae1d2dfa36f5f29faf80867f03ba8b5f305f90046a595df0ef7d3c5f',
  ],
  [
    's47-observation-retirement-38237890055',
    'provider-idle-2',
    '4a2f068b445aea7591600b3ac266b7c6436721cb4657f167bd892a0fb0ef5f76',
  ],
  [
    's47-observation-retirement-38237890055',
    'provider-scripted-motion-1',
    '17272044228449960f0813f651ecea39d81209c7706329374ff449dbec1f672b',
  ],
  [
    's47-atomic-warmup-38241920477',
    'provider-idle-1',
    'f77160f008e683072b4ba72f9e6fd73e3bd3828edea7f92284dd41ca4987e51e',
  ],
];
const ms = (value) => Number((value / 1000).toFixed(3));
const key = (frame) =>
  JSON.stringify([
    frame.functionName,
    frame.url,
    frame.lineNumber,
    frame.columnNumber,
  ]);
const summaries = [];
for (const [directory, name, digest] of inputs) {
  const file = `../${directory}/cpu-profiles/${name}-cpu-profile.json`;
  const bytes = readFileSync(new URL(file, import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, file);
  const packet = JSON.parse(bytes);
  const profile = packet.profile;
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  assert.equal(nodes.size, profile.nodes.length);
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children || []) {
      assert(nodes.has(child));
      assert(!parents.has(child), 'ambiguous stack parent');
      parents.set(child, node.id);
    }
  let timestamp = profile.startTime;
  const samples = profile.samples
    .map((id, index) => {
      timestamp += profile.timeDeltas[index];
      assert(nodes.has(id));
      assert(
        Number.isFinite(timestamp) &&
          timestamp >= profile.startTime &&
          timestamp <= profile.endTime,
      );
      return { id, index, timestamp };
    })
    .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  let previous = profile.startTime;
  const self = new Map();
  const stacks = new Map();
  for (const sample of samples) {
    const weight = sample.timestamp - previous;
    previous = sample.timestamp;
    assert(weight >= 0);
    const frame = nodes.get(sample.id).callFrame;
    const frameKey = key(frame);
    const group = self.get(frameKey) || { frame, samples: 0, weight: 0 };
    group.samples++;
    group.weight += weight;
    self.set(frameKey, group);
    if (
      !['readPixels', 'bufferData', 'getProgramParameter'].includes(
        frame.functionName,
      )
    )
      continue;
    const stack = [];
    const visited = new Set();
    let id = sample.id;
    while (id !== undefined) {
      assert(!visited.has(id), 'cyclic stack');
      visited.add(id);
      const { functionName, url, lineNumber, columnNumber } =
        nodes.get(id).callFrame;
      stack.push({ functionName, url, lineNumber, columnNumber });
      id = parents.get(id);
    }
    const stackKey = JSON.stringify(stack);
    const entry = stacks.get(stackKey) || { stack, samples: 0, weight: 0 };
    entry.samples++;
    entry.weight += weight;
    stacks.set(stackKey, entry);
  }
  // Cross-check the capture producer's derived top-location totals; never trust
  // those totals instead of reconstructing from its original samples.
  for (const location of packet.topLocations) {
    const observed = self.get(key(location));
    assert(observed, 'missing top-location frame');
    assert.equal(observed.samples, location.samples);
    assert(Math.abs(observed.weight / 1000 - location.sampledWeightMs) < 1e-7);
  }
  const nativeTotals = {};
  for (const { frame, weight } of self.values()) {
    if (
      frame.url === '' &&
      ['readPixels', 'bufferData', 'getProgramParameter'].includes(
        frame.functionName,
      )
    ) {
      nativeTotals[frame.functionName] =
        (nativeTotals[frame.functionName] || 0) + weight;
    }
  }
  summaries.push({
    file,
    sha256: digest,
    byteLength: bytes.length,
    profileWindowMs: ms(profile.endTime - profile.startTime),
    attributedSamples: profile.samples.length,
    attributedMs: ms(previous - profile.startTime),
    unattributedTailMs: ms(profile.endTime - previous),
    reorderedNegativeDeltas: profile.timeDeltas.filter((value) => value < 0)
      .length,
    producerTopLocationsIndependentlyMatched: true,
    nativeApiSampledSelfMs: Object.fromEntries(
      Object.entries(nativeTotals).map(([name, value]) => [name, ms(value)]),
    ),
    topApiStacks: [...stacks.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10)
      .map(({ stack, samples, weight }) => ({
        sampledWeightMs: ms(weight),
        samples,
        stack,
      })),
  });
}
console.log(
  JSON.stringify(
    {
      schema: 'gev-preserved-cpu-stack-review/v1',
      performanceAcceptanceEligible: false,
      scope:
        'Statistical main-thread stack attribution; neither GPU time nor a matched performance comparison. Stack weights include native descendants and must not be added to native self totals.',
      timestampRule:
        'Accumulate raw deltas, stable-sort sample timestamps, weight each sample by elapsed interval since its predecessor; preserve the unsampled end tail.',
      summaries,
    },
    null,
    2,
  ),
);
