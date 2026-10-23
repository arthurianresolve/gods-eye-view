import { mergeConfig } from 'vite';
import baseConfig from '../../vite.config.js';
import { trafficFixtureRandomPlugin } from '../performance/trafficFixtureRandomTransform.mjs';

export default async (environment) =>
  mergeConfig(
    await (typeof baseConfig === 'function'
      ? baseConfig(environment)
      : baseConfig),
    { plugins: [trafficFixtureRandomPlugin()] },
  );
