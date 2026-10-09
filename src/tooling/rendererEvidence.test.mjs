import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRenderer,
  readBrowserGraphicsInfo,
} from '../../scripts/performance/rendererEvidence.mjs';

const accelerated = { featureStatus: { webgl: 'enabled', webgl2: 'enabled' } };
test('GPU evidence requires enabled Chrome features and a recognized renderer', () => {
  for (const renderer of [
    'ANGLE (Intel, UHD 620, D3D11)',
    'ANGLE (Apple, Apple M1, Metal)',
  ]) {
    assert.equal(
      classifyRenderer(renderer, accelerated).accelerationVerified,
      true,
    );
    assert.equal(classifyRenderer(renderer).accelerationVerified, false);
    assert.equal(
      classifyRenderer(renderer, {
        featureStatus: { webgl: 'enabled', webgl2: 'disabled_software' },
      }).accelerationVerified,
      false,
    );
  }
  for (const renderer of [
    '',
    'ANGLE',
    'Virtual GPU',
    'ANGLE (Google, SwiftShader)',
    'llvmpipe',
    'Intel software rasterizer',
  ])
    assert.equal(
      classifyRenderer(renderer, accelerated).accelerationVerified,
      false,
      renderer,
    );
});
test('Apple virtual Metal evidence remains distinct from desktop hardware', () => {
  const result = classifyRenderer(
    'ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)',
    accelerated,
  );
  assert.equal(result.kind, 'apple-paravirtual-metal');
  assert.equal(result.accelerationVerified, true);
  assert.equal(result.physicalDesktopCoverage, false);
});
test('system diagnostics discard command lines and always detach their session', async () => {
  let detached = 0;
  const session = {
    send: async () => ({
      commandLine: 'secret',
      gpu: {
        devices: [
          { deviceString: 'GPU', driverVersion: '1', sensitive: 'secret' },
        ],
        featureStatus: {
          webgl: 'enabled',
          webgl2: 'enabled',
          private: 'secret',
        },
      },
    }),
    detach: async () => detached++,
  };
  const browser = { target: () => ({ createCDPSession: async () => session }) };
  const result = await readBrowserGraphicsInfo(browser);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(detached, 1);
  session.send = async () => {
    throw new Error('unavailable');
  };
  assert.equal(await readBrowserGraphicsInfo(browser), null);
  assert.equal(detached, 2);
});
