export const TRAFFIC_RANDOM_SOURCES = Object.freeze({ animation: 8, model: 2 });

// Vite-only, serve-time normalization in the correctness fixture. Original
// checkout bytes and Cesium remain untouched; both A/B roots use this adapter.
export function transformTrafficFixtureRandom(code, id) {
  const match = id
    .replaceAll('\\', '/')
    .split('?')[0]
    .match(/\/src\/layers\/traffic\/(animation|model)\.js$/);
  if (!match) return null;
  const owner = match[1];
  const callSites = (code.match(/Math\.random\(\)/g) || []).length;
  if (callSites !== TRAFFIC_RANDOM_SOURCES[owner])
    throw new Error(`Traffic ${owner} random call sites changed: ${callSites}`);
  if (code.includes('__gevTrafficFixtureRandom'))
    throw new Error('Traffic fixture random adapter was applied twice');
  return {
    code: `import { trafficFixtureRandom as __gevTrafficFixtureRandom } from '/scripts/performance/trafficFixtureRandom.mjs';\n${code.replaceAll('Math.random()', `__gevTrafficFixtureRandom('${owner}')`)}`,
    owner,
    callSites,
  };
}

export function trafficFixtureRandomPlugin() {
  return {
    name: 'traffic-fixture-owned-random',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      const normalized = transformTrafficFixtureRandom(code, id);
      return normalized ? { code: normalized.code, map: null } : null;
    },
  };
}
