import assert from 'node:assert/strict';

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
};
const comparable = (conditions, qualityMode) => {
  const copy = structuredClone(conditions);
  copy.environment.layers.sort((a, b) => a.id.localeCompare(b.id));
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
        assert.equal(
          settings.densityPct,
          expectedDensityPct,
          `${label}: wrong density`,
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
    const before = comparable(sample.conditions.before, qualityMode);
    const after = comparable(sample.conditions.after, qualityMode);
    assert.deepEqual(
      after,
      before,
      `${label}: capture conditions changed during measurement`,
    );
    const signature = { conditions: before, cameraPath: sample.cameraPath };
    if (firstByScenario.has(sample.scenario))
      assert.deepEqual(
        signature,
        firstByScenario.get(sample.scenario),
        `${label}: repeated workload changed`,
      );
    else firstByScenario.set(sample.scenario, signature);
  }
  return { status: 'passed', sampleCount: captures.length };
}
