import assert from 'node:assert/strict';
import { assertRouteDescriptorsEquivalent } from './routeEquivalence.mjs';
import { assertObservedTrackingRoute } from './productionFlightFixture.mjs';

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
};
export const comparableCaptureConditions = (
  conditions,
  qualityMode,
  { dynamicPopulationIds = [] } = {},
) => {
  const copy = structuredClone(conditions);
  copy.environment.layers.sort((a, b) => a.id.localeCompare(b.id));
  for (const layer of copy.environment.layers)
    if (dynamicPopulationIds.includes(layer.id)) delete layer.count;
  if (dynamicPopulationIds.length) delete copy.environment.totalObjects;
  // This one-time diagnostic query is preserved in the report, but its cost
  // varies by fresh document and is not an effective scene condition.
  if (copy.environment.rendererEvidence)
    delete copy.environment.rendererEvidence.queryDurationMs;
  if (qualityMode === 'auto') {
    delete copy.settings.densityPct;
    if (copy.settings.visualState?.detection)
      delete copy.settings.visualState.detection.density;
  }
  return canonical(copy);
};

/** Refuse comparisons whose scene, build or visual conditions changed. */
export function assertCaptureIntegrity(
  captures,
  {
    expectedCommit,
    qualityMode,
    expectedCounts = {},
    expectedDensityPct = null,
    expectedFixture = null,
    expectedWarmupMs = null,
    expectedMeasurementMs = null,
    dynamicPopulationIds = [],
    requireNativeSharpnessProfile = false,
  } = {},
) {
  assert.match(
    expectedCommit || '',
    /^[a-f0-9]{40}$/,
    'Expected application commit is required',
  );
  assert.ok(captures.length, 'No performance samples');
  const firstByScenario = new Map();
  for (const sample of captures) {
    const label = `${sample.scenario} run ${sample.run}`;
    assert.ok(
      sample.conditions?.before && sample.conditions?.after,
      `${label}: missing capture conditions`,
    );
    for (const point of [sample.conditions.before, sample.conditions.after]) {
      const { environment, settings } = point;
      assert.equal(
        environment?.appCommit,
        expectedCommit,
        `${label}: wrong application commit`,
      );
      assert.equal(
        settings?.qualityMode,
        qualityMode,
        `${label}: wrong quality mode`,
      );
      assert.ok(
        Number.isFinite(settings?.densityPct),
        `${label}: density is unavailable`,
      );
      if (qualityMode !== 'auto' && Number.isFinite(expectedDensityPct))
        for (const [actual, source] of [
          [settings.densityPct, 'engine'],
          [settings.visualState?.detection?.density, 'visual state'],
        ])
          assert.equal(
            actual,
            expectedDensityPct,
            `${label}: wrong density (${source})`,
          );
      assert.ok(
        settings.resolutionScale > 0 && Number.isFinite(settings.msaaSamples),
        `${label}: resolution or MSAA is unavailable`,
      );
      assert.equal(
        typeof settings.antialias,
        'boolean',
        `${label}: antialias setting is unavailable`,
      );
      assert.equal(
        typeof settings.fxaa,
        'boolean',
        `${label}: FXAA setting is unavailable`,
      );
      assert.ok(
        settings.visualState?.style && settings.visualState?.styleParams,
        `${label}: visual settings are unavailable`,
      );
      assert.ok(environment.renderer, `${label}: renderer is unavailable`);
      if (requireNativeSharpnessProfile) {
        assert.equal(environment.nativeSharpnessProfile?.id, 'native-sharpness-v1', `${label}: native sharpness profile is unavailable`);
        assert.deepEqual(environment.nativeSharpnessProfile, point === sample.conditions.before ? sample.conditions.after.environment.nativeSharpnessProfile : sample.conditions.before.environment.nativeSharpnessProfile, `${label}: native sharpness profile differs between boundaries`);
      }
      assert.ok(
        environment.viewport?.dpr > 0,
        `${label}: device pixel ratio is unavailable`,
      );
      for (const dimensions of [
        environment.viewport,
        environment.drawingBuffer,
      ]) {
        assert.ok(
          dimensions?.width > 0 && dimensions?.height > 0,
          `${label}: invalid render dimensions`,
        );
      }
      assert.ok(
        point.focused && point.visible,
        `${label}: sample was not foreground`,
      );
      assert.ok(
        Array.isArray(environment.layers),
        `${label}: missing populations`,
      );
      for (const [id, count] of Object.entries(expectedCounts)) {
        const layer = environment.layers.find((row) => row.id === id);
        assert.ok(layer?.enabled, `${label}: required layer ${id} is disabled`);
        assert.equal(
          layer.count,
          count,
          `${label}: wrong population for ${id}`,
        );
      }
    }
    assert.equal(
      sample.foregroundThroughout,
      true,
      `${label}: interrupted foreground sample`,
    );
    assertRouteDescriptorsEquivalent(
      sample.cameraPath,
      sample.cameraPath,
      `${label}: malformed route descriptor`,
    );
    const expectedRouteId =
      sample.scenario === 'scripted-motion'
        ? 'elapsed-move-right-v1'
        : sample.scenario === 'idle'
          ? 'parked-v1'
          : expectedFixture
            ? 'entity-follow-v1'
            : 'parked-v1';
    assert.equal(
      sample.cameraPath?.id,
      expectedRouteId,
      `${label}: wrong route schema`,
    );
    if (sample.scenario === 'selected-aircraft-tracking' && expectedFixture) {
      assertObservedTrackingRoute(sample.cameraPath, {
        fixtureId: expectedFixture.id,
        fixtureSha256: expectedFixture.sha256,
        fixedTime: expectedFixture.fixedTime,
        fixtureCount: expectedFixture.count,
        warmupMs: expectedWarmupMs,
        measurementMs: expectedMeasurementMs,
      });
    }
    const before = comparableCaptureConditions(
      sample.conditions.before,
      qualityMode,
      { dynamicPopulationIds },
    );
    const after = comparableCaptureConditions(
      sample.conditions.after,
      qualityMode,
      { dynamicPopulationIds },
    );
    assert.deepEqual(
      after,
      before,
      `${label}: capture conditions changed during measurement`,
    );
    const signature = { conditions: before, cameraPath: sample.cameraPath };
    if (firstByScenario.has(sample.scenario)) {
      const first = firstByScenario.get(sample.scenario);
      assert.deepEqual(
        signature.conditions,
        first.conditions,
        `${label}: repeated workload changed`,
      );
      assertRouteDescriptorsEquivalent(
        signature.cameraPath,
        first.cameraPath,
        `${label}: repeated workload route changed beyond camera pose roundoff`,
      );
    } else firstByScenario.set(sample.scenario, signature);
  }
  return { status: 'passed', sampleCount: captures.length };
}
