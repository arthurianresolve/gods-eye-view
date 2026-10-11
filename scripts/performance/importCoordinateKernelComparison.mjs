import { createHash } from 'node:crypto';
import sharp from 'sharp';

const KERNELS = ['cesium', 'scalar-experiment'];
const SHAPES = ['line', 'polygon'];
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_PNG_DATA_URL_LENGTH = 1_500_000;
const MAX_CAPTURE_PIXELS = 4096 * 4096;

const sha256 = (value) => /^[a-f0-9]{64}$/.test(value || '');
const finiteNonnegative = (value) => Number.isFinite(value) && value >= 0;

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function validateArm(
  arm,
  expectedKernel,
  expectedCommit,
  fixture,
  errors,
  label,
) {
  add(errors, arm?.status === 'passed', `${label} arm did not complete`);
  add(
    errors,
    arm?.coordinateKernel === expectedKernel,
    `${label} kernel mismatch`,
  );
  add(
    errors,
    arm?.viewerDestroyed === true,
    `${label} viewer teardown was not confirmed`,
  );
  add(
    errors,
    arm?.applicationCommit === expectedCommit &&
      arm?.harnessCommit === expectedCommit,
    `${label} app/harness identity mismatch`,
  );
  add(
    errors,
    arm?.environment?.appCommit === expectedCommit &&
      arm?.environment?.harnessCommit === expectedCommit,
    `${label} environment identity mismatch`,
  );
  add(
    errors,
    typeof arm?.environment?.renderer === 'string' &&
      arm.environment.renderer.length > 0,
    `${label} renderer unavailable`,
  );
  add(
    errors,
    arm?.renderSettings?.sceneMode === 'SCENE3D',
    `${label} is not 3D`,
  );
  add(
    errors,
    arm?.renderSettings?.globeShow === true,
    `${label} did not render the globe`,
  );
  add(
    errors,
    arm?.renderSettings?.clockEpoch === '2025-01-01T00:00:00.000Z' &&
      arm.renderSettings.shouldAnimate === false,
    `${label} clock is not fixed`,
  );
  add(
    errors,
    arm?.renderSettings?.imageryLayerCount === 0,
    `${label} has imagery layers`,
  );
  add(
    errors,
    arm?.renderSettings?.terrainProvider === 'EllipsoidTerrainProvider',
    `${label} terrain is not the local ellipsoid`,
  );
  add(
    errors,
    Number.isInteger(arm?.renderSettings?.width) &&
      arm.renderSettings.width > 0,
    `${label} has invalid buffer width`,
  );
  add(
    errors,
    Number.isInteger(arm?.renderSettings?.height) &&
      arm.renderSettings.height > 0,
    `${label} has invalid buffer height`,
  );
  add(
    errors,
    arm?.renderSettings?.msaaSamplesRequested === 4 &&
      typeof arm.renderSettings.msaaSupported === 'boolean',
    `${label} lacks matched MSAA settings`,
  );
  add(
    errors,
    typeof arm?.renderSettings?.antialias === 'boolean',
    `${label} lacks effective antialias state`,
  );
  add(
    errors,
    arm?.renderSettings?.contextLost === false,
    `${label} WebGL context was lost or unobserved`,
  );
  add(
    errors,
    arm?.batchAttribution?.available === false,
    `${label} must state batch timing is unavailable`,
  );
  add(
    errors,
    Array.isArray(arm?.renderErrors) && arm.renderErrors.length === 0,
    `${label} has renderer errors`,
  );
  add(
    errors,
    arm?.clear?.featureCountAfter === 0 &&
      arm.clear.contextEntityCountAfter === 0 &&
      arm.clear.pendingJobsAfter === 0,
    `${label} retained imported features after clear`,
  );
  add(
    errors,
    arm?.clear?.cacheEntriesAfter === 0,
    `${label} retained layer cache entries after clear`,
  );

  for (const shape of SHAPES) {
    const sample = arm?.shapes?.[shape];
    const shapeLabel = `${label} ${shape}`;
    add(
      errors,
      finiteNonnegative(sample?.loadAsyncElapsedMs),
      `${shapeLabel} load duration is invalid`,
    );
    add(
      errors,
      finiteNonnegative(sample?.renderReadyElapsedMs) &&
        sample.renderReadyElapsedMs <= 15_000,
      `${shapeLabel} render-ready wait is invalid`,
    );
    add(
      errors,
      finiteNonnegative(sample?.firstUsableElapsedMs) &&
        sample.firstUsableElapsedMs + 0.01 >=
          sample.loadAsyncElapsedMs + sample.renderReadyElapsedMs &&
        sample.firstUsableElapsedMs <=
          sample.loadAsyncElapsedMs + sample.renderReadyElapsedMs + 100,
      `${shapeLabel} first-usable duration is inconsistent`,
    );
    add(
      errors,
      Number.isInteger(sample?.readinessObservations) &&
        sample.readinessObservations >= 1,
      `${shapeLabel} readiness witness is missing`,
    );
    add(
      errors,
      finiteNonnegative(sample?.captureElapsedMs),
      `${shapeLabel} capture duration is invalid`,
    );
    add(
      errors,
      Number.isInteger(sample?.width) &&
        sample.width > 0 &&
        Number.isInteger(sample?.height) &&
        sample.height > 0 &&
        sample.width === arm?.renderSettings?.width &&
        sample.height === arm?.renderSettings?.height &&
        sample.width <= 4096 &&
        sample.height <= 4096 &&
        sample.width * sample.height <= MAX_CAPTURE_PIXELS,
      `${shapeLabel} capture dimensions are invalid`,
    );
    add(
      errors,
      sample?.featureId === `kernel-${shape}`,
      `${shapeLabel} feature identity mismatch`,
    );
    add(
      errors,
      sample?.coordinateCount === 50_000,
      `${shapeLabel} coordinate population mismatch`,
    );
    add(
      errors,
      sha256(sample?.sourceCoordinatesSha256),
      `${shapeLabel} source geometry hash missing`,
    );
    add(
      errors,
      sample?.sourceCoordinatesSha256 === fixture?.[`${shape}SourceSha256`],
      `${shapeLabel} source differs from declared fixture`,
    );
    add(
      errors,
      sha256(sample?.cartesianPositionsSha256),
      `${shapeLabel} converted position hash missing`,
    );
    add(
      errors,
      sha256(sample?.styleSha256),
      `${shapeLabel} effective style hash missing`,
    );
    add(
      errors,
      sha256(sample?.pixelSha256),
      `${shapeLabel} pixel hash missing`,
    );
    add(
      errors,
      typeof sample?.pngDataUrl === 'string' &&
        sample.pngDataUrl.startsWith(PNG_PREFIX) &&
        sample.pngDataUrl.length <= MAX_PNG_DATA_URL_LENGTH,
      `${shapeLabel} bounded PNG missing`,
    );
    add(
      errors,
      sample?.nativePick?.recordId === sample?.featureId &&
        sample?.nativePick?.expectedEntityId ===
          `gev-import:kernel-fixture:kernel-fixture:${sample?.featureId}` &&
        sample?.nativePick?.pickedEntityId ===
          sample?.nativePick?.expectedEntityId &&
        sample.nativePick?.onCanvas === true &&
        Array.isArray(sample.nativePick.screen) &&
        sample.nativePick.screen.length === 2 &&
        sample.nativePick.screen.every(Number.isFinite),
      `${shapeLabel} native pick failed`,
    );
    const validBoundedDimensions =
      Number.isInteger(sample?.width) &&
      Number.isInteger(sample?.height) &&
      sample.width > 0 &&
      sample.height > 0 &&
      sample.width === arm?.renderSettings?.width &&
      sample.height === arm?.renderSettings?.height &&
      sample.width <= 4096 &&
      sample.height <= 4096 &&
      sample.width * sample.height <= MAX_CAPTURE_PIXELS;
    if (
      typeof sample?.pngDataUrl === 'string' &&
      sample.pngDataUrl.startsWith(PNG_PREFIX) &&
      sample.pngDataUrl.length <= MAX_PNG_DATA_URL_LENGTH &&
      validBoundedDimensions
    ) {
      try {
        const png = Buffer.from(
          sample.pngDataUrl.slice(PNG_PREFIX.length),
          'base64',
        );
        const decoded = await sharp(png, {
          limitInputPixels: MAX_CAPTURE_PIXELS,
        })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const decodedSha256 = createHash('sha256')
          .update(decoded.data)
          .digest('hex');
        add(
          errors,
          decoded.info.width === sample.width &&
            decoded.info.height === sample.height,
          `${shapeLabel} PNG dimensions differ from capture`,
        );
        add(
          errors,
          decodedSha256 === sample.pixelSha256,
          `${shapeLabel} PNG pixels do not match the reported pixel digest`,
        );
      } catch {
        add(errors, false, `${shapeLabel} PNG could not be decoded`);
      }
    }
  }
}

export async function validateImportCoordinateKernelReport(
  report,
  expectedCommit,
) {
  const errors = [];
  add(
    errors,
    report?.schema === 'gev-import-coordinate-kernel/v1',
    'unknown report schema',
  );
  add(errors, report?.status === 'passed', 'fixture did not pass');
  add(
    errors,
    report?.documentVisibilityAtStart === 'visible',
    'fixture did not start in a visible page',
  );
  add(
    errors,
    report?.foregroundUninterrupted === true,
    'page visibility changed during the comparison',
  );
  add(
    errors,
    report?.applicationCommit === expectedCommit,
    'wrong application commit',
  );
  add(errors, report?.harnessCommit === expectedCommit, 'wrong harness commit');
  add(
    errors,
    report?.fixture?.lineCoordinateCount === 50_000 &&
      report.fixture.polygonCoordinateCount === 50_000,
    'full 50,000-coordinate fixtures are required',
  );
  add(
    errors,
    sha256(report?.fixture?.lineSourceSha256) &&
      sha256(report?.fixture?.polygonSourceSha256),
    'fixture source hashes missing',
  );
  add(
    errors,
    Array.isArray(report?.pairs) && report.pairs.length === 5,
    'exactly five alternating pairs are required',
  );
  if (!Array.isArray(report?.pairs)) return { valid: false, errors };

  const loadDeltas = [];
  const perShapeDeltas = Object.fromEntries(
    SHAPES.map((shape) => [shape, { load: [], firstUsable: [] }]),
  );
  const priorArmByKernel = Object.create(null);
  for (let index = 0; index < report.pairs.length; index++) {
    const pair = report.pairs[index];
    const expectedOrder = index % 2 === 0 ? KERNELS : [...KERNELS].reverse();
    add(errors, pair?.pair === index, `pair ${index} index mismatch`);
    add(
      errors,
      sameJson(pair?.order, expectedOrder),
      `pair ${index} order is not alternating`,
    );
    const arms = pair?.arms;
    for (const kernel of KERNELS)
      await validateArm(
        arms?.[kernel],
        kernel,
        report.applicationCommit,
        report.fixture,
        errors,
        `pair ${index} ${kernel}`,
      );
    const baseline = arms?.cesium;
    const candidate = arms?.['scalar-experiment'];
    if (!baseline || !candidate) continue;
    add(
      errors,
      sameJson(baseline.renderSettings, candidate.renderSettings),
      `pair ${index} settings differ`,
    );
    add(
      errors,
      baseline.environment?.renderer === candidate.environment?.renderer,
      `pair ${index} renderer differs`,
    );
    if (index > 0) {
      const previous = report.pairs[index - 1].arms?.cesium;
      add(
        errors,
        sameJson(previous?.renderSettings, baseline.renderSettings),
        `pair ${index} baseline settings drifted`,
      );
      add(
        errors,
        previous?.environment?.renderer === baseline.environment?.renderer,
        `pair ${index} renderer changed`,
      );
    }
    for (const shape of SHAPES) {
      const left = baseline.shapes?.[shape];
      const right = candidate.shapes?.[shape];
      add(
        errors,
        left?.sourceCoordinatesSha256 === right?.sourceCoordinatesSha256,
        `pair ${index} ${shape} source geometry differs`,
      );
      add(
        errors,
        left?.cartesianPositionsSha256 === right?.cartesianPositionsSha256,
        `pair ${index} ${shape} Cartesian positions differ`,
      );
      add(
        errors,
        left?.styleSha256 === right?.styleSha256,
        `pair ${index} ${shape} effective style differs`,
      );
      add(
        errors,
        left?.pixelSha256 === right?.pixelSha256,
        `pair ${index} ${shape} pixels differ`,
      );
      add(
        errors,
        left?.width === right?.width && left?.height === right?.height,
        `pair ${index} ${shape} capture dimensions differ`,
      );
      add(
        errors,
        sameJson(left?.nativePick, right?.nativePick),
        `pair ${index} ${shape} native pick differs`,
      );
      if (
        Number.isFinite(left?.loadAsyncElapsedMs) &&
        left.loadAsyncElapsedMs > 0 &&
        Number.isFinite(right?.loadAsyncElapsedMs) &&
        Number.isFinite(left?.renderReadyElapsedMs) &&
        Number.isFinite(right?.renderReadyElapsedMs)
      ) {
        perShapeDeltas[shape].load.push(
          (right.loadAsyncElapsedMs - left.loadAsyncElapsedMs) /
            left.loadAsyncElapsedMs,
        );
        const baselineFirstUsable = left.firstUsableElapsedMs;
        const candidateFirstUsable = right.firstUsableElapsedMs;
        if (baselineFirstUsable > 0)
          perShapeDeltas[shape].firstUsable.push(
            (candidateFirstUsable - baselineFirstUsable) / baselineFirstUsable,
          );
      }
      for (const [kernel, sample] of [
        ['cesium', left],
        ['scalar-experiment', right],
      ]) {
        const previous = priorArmByKernel[kernel]?.shapes?.[shape];
        if (previous) {
          add(
            errors,
            previous.pixelSha256 === sample?.pixelSha256,
            `${kernel} ${shape} pixels changed between pairs`,
          );
          add(
            errors,
            previous.cartesianPositionsSha256 ===
              sample?.cartesianPositionsSha256,
            `${kernel} ${shape} positions changed between pairs`,
          );
          add(
            errors,
            previous.styleSha256 === sample?.styleSha256,
            `${kernel} ${shape} style changed between pairs`,
          );
          add(
            errors,
            sameJson(previous.nativePick, sample?.nativePick),
            `${kernel} ${shape} pick changed between pairs`,
          );
        }
      }
    }
    priorArmByKernel.cesium = baseline;
    priorArmByKernel['scalar-experiment'] = candidate;
    const baselineLoad = SHAPES.reduce(
      (sum, shape) => sum + (baseline.shapes?.[shape]?.loadAsyncElapsedMs || 0),
      0,
    );
    const candidateLoad = SHAPES.reduce(
      (sum, shape) =>
        sum + (candidate.shapes?.[shape]?.loadAsyncElapsedMs || 0),
      0,
    );
    if (baselineLoad > 0)
      loadDeltas.push((candidateLoad - baselineLoad) / baselineLoad);
  }
  add(
    errors,
    loadDeltas.length === 5,
    'paired load timing inventory is incomplete',
  );
  const sortedDeltas = [...loadDeltas].sort((a, b) => a - b);
  const medianDelta = sortedDeltas.length === 5 ? sortedDeltas[2] : null;
  const medianByShape = Object.fromEntries(
    SHAPES.map((shape) => {
      const loadValues = [...perShapeDeltas[shape].load].sort((a, b) => a - b);
      const readyValues = [...perShapeDeltas[shape].firstUsable].sort(
        (a, b) => a - b,
      );
      return [
        shape,
        {
          load: loadValues.length === 5 ? loadValues[2] : null,
          firstUsable: readyValues.length === 5 ? readyValues[2] : null,
        },
      ];
    }),
  );
  const firstUsableDeltas = report.pairs.map((pair) => {
    const baseline = pair.arms?.cesium;
    const candidate = pair.arms?.['scalar-experiment'];
    const baselineMs = SHAPES.reduce(
      (sum, shape) =>
        sum + baseline?.shapes?.[shape]?.firstUsableElapsedMs || 0,
      0,
    );
    const candidateMs = SHAPES.reduce(
      (sum, shape) =>
        sum + candidate?.shapes?.[shape]?.firstUsableElapsedMs || 0,
      0,
    );
    return baselineMs > 0 ? (candidateMs - baselineMs) / baselineMs : null;
  });
  const sortedFirstUsable = firstUsableDeltas
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const medianFirstUsableDelta =
    sortedFirstUsable.length === 5 ? sortedFirstUsable[2] : null;
  const regressionGatePassed =
    medianDelta !== null &&
    medianDelta <= 0.1 &&
    medianFirstUsableDelta !== null &&
    medianFirstUsableDelta <= 0.1 &&
    SHAPES.every(
      (shape) =>
        medianByShape[shape].load !== null &&
        medianByShape[shape].load <= 0.1 &&
        medianByShape[shape].firstUsable !== null &&
        medianByShape[shape].firstUsable <= 0.1,
    );
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      pairedLoadDeltaRatios: loadDeltas,
      medianPairedLoadDeltaRatio: medianDelta,
      pairedLoadDeltaRatiosByShape: Object.fromEntries(
        SHAPES.map((shape) => [shape, perShapeDeltas[shape].load]),
      ),
      medianLoadDeltaRatioByShape: medianByShape,
      pairedFirstUsableDeltaRatios: firstUsableDeltas,
      medianPairedFirstUsableDeltaRatio: medianFirstUsableDelta,
      pairedFirstUsableDeltaRatiosByShape: Object.fromEntries(
        SHAPES.map((shape) => [shape, perShapeDeltas[shape].firstUsable]),
      ),
      regressionGate:
        'candidate median combined load and first-usable duration, plus each shape load and first-usable median, must not exceed baseline by more than 10%; frame capture/readback remains separate',
      regressionGatePassed,
      performanceAccepted: false,
      measuredScope:
        'hosted unprofiled browser comparison; loadAsync includes conversion and publication; first-usable combines loadAsync and native-render readiness; frame capture/readback is reported separately',
    },
  };
}
