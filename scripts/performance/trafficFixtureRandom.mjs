// Fixture-only input adapter. Never imported by a production build.
export const TRAFFIC_RANDOM_SEED = 0x51f17e;
export const TRAFFIC_RANDOM_ADAPTER = 'traffic-owned-lcg/v1';

export function createTrafficFixtureRandom() {
  let state = TRAFFIC_RANDOM_SEED;
  const calls = { animation: 0, model: 0 };
  return {
    random(owner) {
      if (!Object.hasOwn(calls, owner))
        throw new TypeError('Unknown traffic random owner');
      calls[owner]++;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    },
    snapshot() {
      return {
        adapter: TRAFFIC_RANDOM_ADAPTER,
        seed: TRAFFIC_RANDOM_SEED,
        state,
        calls: { ...calls },
      };
    },
  };
}

const fixtureRandom = createTrafficFixtureRandom();
export const trafficFixtureRandom = (owner) => fixtureRandom.random(owner);
export const trafficFixtureRandomSnapshot = () => fixtureRandom.snapshot();
