import { createSourceAdapter } from './adapterContract.js';

/** Keyless fixture for source contributors; this data is never live telemetry. */
export function createSyntheticSourceAdapter({ now = () => Date.now() } = {}) {
  return createSourceAdapter({
    id: 'synthetic-example',
    label: 'Synthetic adapter example',
    attribution: 'Gods-Eye-View synthetic development fixture',
    capabilities: { temporalModes: ['live'] },
    retention: {
      record: true,
      export: true,
      reason: 'Fixture observations are generated solely for local tests.',
    },
    now,
    async acquire({ signal }) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      return {
        coverage: { area: 'two synthetic points', completeness: 'complete' },
        observations: [
          {
            id: 'fixture-north',
            lat: 47.61,
            lon: -122.33,
            observedAt: now(),
            properties: { name: 'Synthetic North' },
          },
          {
            id: 'fixture-south',
            lat: 47.58,
            lon: -122.31,
            observedAt: now(),
            properties: { name: 'Synthetic South' },
          },
        ],
      };
    },
  });
}
