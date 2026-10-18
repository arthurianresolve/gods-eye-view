import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import {
  activateQualificationCctvInPage,
  readQualificationStateInPage,
  readVisualSnapshotPhaseInPage,
} from './finalVisualQualificationState.mjs';

function activationFixture(tilesLoaded) {
  const calls = [];
  let params = {};
  const module = {
    setParams: (value) => {
      calls.push('select');
      params = value;
    },
    getParams: () => params,
  };
  const app = {
    viewer: { scene: { globe: { tilesLoaded } } },
    dataManager: {
      setEnabled: async () => {
        calls.push('enable');
        return true;
      },
      isEnabled: () => true,
      layers: new Map([['cctv', { module }]]),
    },
    styleManager: {
      _adaptiveQuality: { getMode: () => 'manual' },
      services: {
        getDetectionMode: () => 'DENSE',
        getDetectionTuning: () => ({ densityPct: 75 }),
      },
    },
  };
  const activate = vm.runInNewContext(
    `(${activateQualificationCctvInPage.toString()})`,
    { window: { __godsEyeView: app } },
  );
  return { activate, calls, app, module };
}

test('CCTV activation never samples an unfinished or unknown globe surface', async () => {
  for (const ready of [false, undefined, null, 1]) {
    const fixture = activationFixture(ready);
    await assert.rejects(
      fixture.activate('fixture-camera'),
      /before CCTV activation/,
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test('serialized activation uses the production selection after surface readiness', async () => {
  const fixture = activationFixture(true);
  const result = await fixture.activate('fixture-camera');
  assert.deepEqual(fixture.calls, ['enable', 'select']);
  assert.equal(result.tilesLoadedBeforeActivation, true);
  assert.equal(result.cameraId, 'fixture-camera');
  assert.equal(fixture.module.getParams().selectedCameraId, 'fixture-camera');
  assert.equal(fixture.module.getParams().showProjection, true);
  assert.equal(fixture.module.getParams().autoHop, false);
});

test('ready surface does not hide enable, selection, or visual setting failures', async () => {
  const disabled = activationFixture(true);
  disabled.app.dataManager.setEnabled = async () => false;
  await assert.rejects(
    disabled.activate('fixture-camera'),
    /could not be enabled/,
  );
  assert.deepEqual(disabled.calls, []);
  const ignored = activationFixture(true);
  ignored.module.setParams = () => {};
  await assert.rejects(
    ignored.activate('fixture-camera'),
    /did not settle selected/,
  );
  const quality = activationFixture(true);
  quality.app.styleManager._adaptiveQuality.getMode = () => 'auto';
  await assert.rejects(quality.activate('fixture-camera'), /Manual DENSE/);
});

test('visual state page callback serializes without Node or outer bindings', () => {
  const checkpoint = {
    cameraCount: 1,
    cameraPose: { longitude: -97.7431, latitude: 30.2672 },
    cameraView: { containsFixture: true },
    scene: { entities: 1, dataSources: 0 },
  };
  const context = {
    window: {
      __godsEyeView: {
        styleManager: {
          services: {
            getDetectionTuning: () => ({ densityPct: 75 }),
            getDetectionMode: () => 'DENSE',
          },
          _adaptiveQuality: { getMode: () => 'manual' },
          getVisualState: () => ({ hud: { visible: true } }),
          hud: {
            getMode: () => 'on',
            visible: true,
            getVariant: () => 'tactical',
          },
        },
        viewer: {
          resolutionScale: 1,
          scene: {
            context: {
              _gl: { getContextAttributes: () => ({ antialias: false }) },
            },
            msaaSamples: 4,
            postProcessStages: { fxaa: { enabled: true } },
          },
        },
        dataManager: { layers: new Map() },
      },
      devicePixelRatio: 1,
    },
    document: { getElementById: () => ({ getAttribute: () => 'false' }) },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    Date: { now: () => Date.parse('2026-10-08T12:00:00.000Z') },
  };
  const source = `(${readQualificationStateInPage.toString()})`;
  const result = vm.runInNewContext(
    source,
    context,
  )({
    checkpointValue: checkpoint,
    profileValue: { id: 'native-sharpness-v1' },
  });
  assert.equal(result.settings.densityPct, 75);
  assert.equal(result.hud.visible, true);
  assert.equal(result.checkpoint.cameraView.containsFixture, true);
});

function phaseFixture({
  dpr = 2,
  phase = 0,
  mismatchedEdges = false,
  empty = false,
} = {}) {
  const reads = [];
  const canvas = {
    width: 1440 * dpr,
    height: 900 * dpr,
    getBoundingClientRect: () => ({ width: 1440, height: 900 }),
    getContext: (...args) => {
      assert.deepEqual(
        args,
        ['2d'],
        'observation must not reconfigure the existing context',
      );
      return {
        getImageData: (x, y, width, height) => {
          reads.push({ x, y, width, height });
          const cssRow = Math.floor(y / dpr);
          const edgePhase = mismatchedEdges && x > 0 ? (phase + 2) % 4 : phase;
          const alpha = !empty && cssRow % 4 === edgePhase ? 8 : 0;
          return { data: new Uint8ClampedArray([0, 0, 0, alpha]) };
        },
      };
    },
  };
  const scope = {
    window: {
      __gevVisualPresentationBoundary: {
        read: () => ({ hudVisible: true, revision: 1 }),
      },
    },
    document: {
      getElementById: (id) =>
        id === 'world-overlay-detection-surface' ? canvas : null,
    },
  };
  const read = () =>
    JSON.parse(
      JSON.stringify(
        vm.runInNewContext(
          `(${readVisualSnapshotPhaseInPage.toString()})({ expectedHudVisible: true })`,
          scope,
        ),
      ),
    );
  return { read, reads, canvas, scope };
}

test('serialized snapshot phase reads actual edge pixels at native DPR', () => {
  for (const dpr of [1, 2])
    for (const phase of [0, 2]) {
      const fixture = phaseFixture({ dpr, phase });
      const result = fixture.read();
      assert.equal(result.phase, phase);
      assert.equal(result.alphaRows.length, 8);
      assert.deepEqual(
        result.alphaRows
          .filter((row) => row.leftAlpha > 0)
          .map((row) => row.cssRow),
        [phase, phase + 4],
      );
      assert.deepEqual(
        result.alphaRows.map((row) => row.pixelRow),
        Array.from({ length: 8 }, (_, row) => row * dpr),
      );
      assert.equal(result.dimensions.dpr, dpr);
      assert.equal(fixture.reads.length, 16);
    }
});

test('snapshot phase stays unavailable for absent strokes or contradictory edges', () => {
  assert.equal(phaseFixture({ empty: true }).read().phase, null);
  assert.equal(phaseFixture({ mismatchedEdges: true }).read().phase, null);
  const short = phaseFixture();
  short.canvas.height = 12;
  short.canvas.getBoundingClientRect = () => ({ width: 1440, height: 6 });
  assert.equal(
    short.read().phase,
    null,
    'truncated observations cannot claim a phase',
  );
  const missing = phaseFixture();
  missing.scope.document.getElementById = () => null;
  assert.throws(missing.read, /surfaces are unavailable/);
  const dimensions = phaseFixture();
  dimensions.canvas.getBoundingClientRect = () => ({ width: 0, height: 900 });
  assert.throws(dimensions.read, /dimensions are unavailable/);
});
