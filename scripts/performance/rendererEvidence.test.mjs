import test from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserGraphicsInfo } from './rendererEvidence.mjs';

const gpu = { featureStatus: { webgl: 'enabled' }, devices: [] };
function browserFixture(
  product,
  { versionError = false, gpuError = false } = {},
) {
  const commands = [];
  let detached = 0;
  const session = {
    async send(command) {
      commands.push(command);
      if (command === 'SystemInfo.getInfo') {
        if (gpuError) throw new Error('unsupported GPU query');
        return { gpu };
      }
      assert.equal(command, 'Browser.getVersion');
      if (versionError) throw new Error('unsupported version query');
      return { product, userAgent: 'not retained', revision: 'not retained' };
    },
    async detach() {
      detached++;
    },
  };
  return {
    browser: { target: () => ({ createCDPSession: async () => session }) },
    commands,
    detached: () => detached,
  };
}

for (const version of [
  'Chrome/155.0.8059.84',
  'HeadlessChrome/152.0.7977.75',
]) {
  test(`graphics evidence records actual complete version ${version}`, async () => {
    const h = browserFixture(version);
    const result = await readBrowserGraphicsInfo(h.browser);
    assert.equal(result.browserVersion, version);
    assert.equal(result.featureStatus.webgl, 'enabled');
    assert.equal('userAgent' in result, false);
    assert.equal('revision' in result, false);
    assert.deepEqual(h.commands, ['SystemInfo.getInfo', 'Browser.getVersion']);
    assert.equal(h.detached(), 1);
  });
}

for (const value of [
  null,
  '',
  'Chrome/155.0.0',
  'https://secret.invalid/',
  'Chrome/155.0.8059.84\ncredential',
]) {
  test(`invalid browser version remains unavailable: ${JSON.stringify(value)}`, async () => {
    const h = browserFixture(value);
    const result = await readBrowserGraphicsInfo(h.browser);
    assert.equal(result.browserVersion, null);
    assert.equal(result.featureStatus.webgl, 'enabled');
    assert.equal(h.detached(), 1);
  });
}

test('unsupported version query preserves measured acceleration and detaches', async () => {
  const h = browserFixture(null, { versionError: true });
  const result = await readBrowserGraphicsInfo(h.browser);
  assert.equal(result.browserVersion, null);
  assert.equal(result.featureStatus.webgl, 'enabled');
  assert.equal(h.detached(), 1);
});

test('unavailable GPU query does not fabricate hardware evidence', async () => {
  const h = browserFixture('Chrome/155.0.8059.84', { gpuError: true });
  assert.equal(await readBrowserGraphicsInfo(h.browser), null);
  assert.equal(h.detached(), 1);
});
