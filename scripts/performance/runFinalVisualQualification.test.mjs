import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { readQualificationStateInPage } from './finalVisualQualificationState.mjs';

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
          hud: { getMode: () => 'on', visible: true, getVariant: () => 'tactical' },
        },
        viewer: {
          resolutionScale: 1,
          scene: {
            context: { _gl: { getContextAttributes: () => ({ antialias: false }) } },
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
  const result = vm.runInNewContext(source, context)({ checkpointValue: checkpoint, profileValue: { id: 'native-sharpness-v1' } });
  assert.equal(result.settings.densityPct, 75);
  assert.equal(result.hud.visible, true);
  assert.equal(result.checkpoint.cameraView.containsFixture, true);
});
