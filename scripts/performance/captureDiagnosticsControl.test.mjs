import assert from 'node:assert/strict';
import test from 'node:test';
import { disableOptionalPerformanceDiagnostics } from './captureDiagnosticsControl.mjs';

test('capture setup reports an unsupported legacy diagnostics hook without reads', () => {
  const app = Object.defineProperties(
    {},
    {
      getPerformanceSnapshot: {
        get() {
          throw new Error('capture setup must not read a snapshot');
        },
      },
    },
  );
  assert.deepEqual(disableOptionalPerformanceDiagnostics(app), {
    requested: true,
    hookAvailable: false,
    disabled: false,
  });
});

test('capture setup disables the optional candidate hook without reading the observer', () => {
  let calls = 0;
  const app = {
    setPerformanceDiagnosticsEnabled(value) {
      assert.equal(value, false);
      calls += 1;
    },
    get getPerformanceSnapshot() {
      throw new Error('disabling diagnostics must not read the observer');
    },
  };
  assert.deepEqual(disableOptionalPerformanceDiagnostics(app), {
    requested: true,
    hookAvailable: true,
    disabled: true,
  });
  assert.equal(calls, 1);
});

test('capture setup propagates failure from a present disable hook', () => {
  const app = {
    setPerformanceDiagnosticsEnabled() {
      throw new Error('disable rejected');
    },
  };
  assert.throws(
    () => disableOptionalPerformanceDiagnostics(app),
    /disable rejected/,
  );
});
