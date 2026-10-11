import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createApplicationViewer } from '../../src/app/viewer.js';
import { createApplicationFlights } from '../../src/app/layers/flights.js';
import { createApplicationMilitary } from '../../src/app/layers/militaryFlights.js';
import { createSurfaceServices } from '../../src/app/surfaceServices.js';
import { createMilitaryRegistry } from '../../src/layers/aircraft/classification.js';
import * as governor from '../../src/renderGovernor.js';
import { ensureGeoidReady } from '../../src/data/geoid.js';
import { captureFreshCesiumFrame } from '../../src/freshFrame.js';
import { readPerformanceEnvironment } from '../../src/performance/performanceSnapshot.js';

const EPOCH = Date.UTC(2026, 9, 8, 12);
const IDS = {
  civil: Array.from({ length: 12 }, (_, i) => (0xa10000 + i).toString(16)),
  military: Array.from({ length: 8 }, (_, i) => (0xa20000 + i).toString(16)),
};
const params = new URL(location.href).searchParams;
const implementation = params.get('implementation');
const mode = params.get('mode') || 'correctness';
const appCommit = __GEV_APP_COMMIT__;
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
const vector = (value) => [value.x, value.y, value.z];
let report;

// These clocks belong only to this disposable fixture document. Timers and
// performance.now remain real. Cadence runs advance normally; correctness
// runs step exactly the same source/display timestamps in both checkouts.
function fixtureClock() {
  const originalDateNow = Date.now;
  const originalJulianNow = Cesium.JulianDate.now;
  let value = EPOCH,
    runningAt = null;
  const now = () =>
    value + (runningAt === null ? 0 : performance.now() - runningAt);
  Date.now = now;
  Cesium.JulianDate.now = (result) =>
    Cesium.JulianDate.fromDate(new Date(now()), result);
  return {
    now,
    set(time) {
      value = time;
      runningAt = null;
    },
    start() {
      runningAt = performance.now();
    },
    restore() {
      Date.now = originalDateNow;
      Cesium.JulianDate.now = originalJulianNow;
    },
  };
}

function records(kind, revision) {
  return IDS[kind].map((id, i) => ({
    id,
    reference: id,
    callsign: `${kind === 'civil' ? 'CIV' : 'MIL'}${i + 1}`,
    latitude: 37.8 + ((i % 4) - 1.5) * 0.075 + revision * 0.004,
    longitude:
      -122.3 +
      (Math.floor(i / 4) - 1) * 0.08 +
      revision * 0.0028 +
      (kind === 'military' ? 0.18 : 0),
    positionTimeMs: EPOCH - 60000 + revision * 30000,
    contactTimeMs: EPOCH - 60000 + revision * 30000,
    baroAltitudeM: 9000 + (i % 5) * 250,
    ellipsoidAltitudeM: 9000 + (i % 5) * 250,
    onGround: false,
    speedMps: 165 + (i % 4) * 9,
    courseDeg: (i * 37 + revision * 3) % 360,
    verticalRateMps: 0,
    originCountry: 'Fixture',
    category: 2,
    typeCode: 'A320',
    registration: `N${1000 + i}`,
    operator: 'Fixture',
  }));
}

async function createFixture(clock) {
  const setupCleanup = [];
  try {
    const viewer = createApplicationViewer({
      container: document.querySelector('#viewer'),
      creditContainer: document.querySelector('#credits'),
    });
    setupCleanup.push(() => {
      if (!viewer.isDestroyed()) viewer.destroy();
    });
    viewer.scene.skyBox.show =
      viewer.scene.skyAtmosphere.show =
      viewer.scene.sun.show =
      viewer.scene.moon.show =
        false;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#09141f');
    viewer.clock.shouldAnimate = false;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(
      new Date(clock.now()),
    );
    viewer.scene.maximumRenderTimeChange = Infinity;
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-122.3, 37.8, 920000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    governor.installRenderGovernor(viewer);
    setupCleanup.push(() => governor.uninstallRenderGovernor(viewer));
    const lifetime = new AbortController();
    setupCleanup.push(() => lifetime.abort());
    const surface = createSurfaceServices({
      signal: lifetime.signal,
      terrainSource: {
        async getHeights(points) {
          return points.map(() => ({ ellipsoid: 0 }));
        },
      },
    });
    const registry = createMilitaryRegistry({ now: clock.now });
    setupCleanup.push(() => registry.dispose());
    registry.registerMilitaryIcaos(IDS.military);
    let revision = 0;
    const source = (kind) => ({
      label: `S51 ${kind} fixture`,
      async getSnapshot() {
        return {
          records: records(kind, revision),
          source: `S51 ${kind} fixture`,
          coverage: 'fixed local fixture',
          observedAtMs: clock.now(),
          ageMs: 0,
          stale: false,
          freshness: 'current',
          complete: true,
        };
      },
    });
    const civil = createApplicationFlights({
      surface,
      source: source('civil'),
      militaryRegistry: registry,
    });
    setupCleanup.push(() => civil.destroy(viewer));
    const military = createApplicationMilitary({
      surface,
      source: source('military'),
      militaryRegistry: registry,
    });
    setupCleanup.push(() => military.destroy(viewer));
    const layers = { civil, military };
    const frames = [];
    const errors = [];
    const removers = [
      viewer.scene.postRender.addEventListener(() => {
        if (frames.length >= 20000) throw new Error('Frame buffer overflow');
        frames.push(performance.now());
      }),
      viewer.scene.renderError.addEventListener((_scene, error) =>
        errors.push(String(error?.message || error)),
      ),
    ];
    setupCleanup.push(() => removers.forEach((remove) => remove()));
    function billboards(kind) {
      const result = new Map();
      for (let n = 0; n < viewer.scene.primitives.length; n++) {
        const item = viewer.scene.primitives.get(n);
        if (!(item instanceof Cesium.BillboardCollection)) continue;
        for (let i = 0; i < item.length; i++) {
          const b = item.get(i);
          if (IDS[kind].includes(String(b.id))) result.set(String(b.id), b);
        }
      }
      return result;
    }
    function output() {
      return Object.fromEntries(
        Object.entries(layers).map(([kind, layer]) => [
          kind,
          {
            count: layer.getStats().count,
            tracked: layer.getTrackedInfo()?.icao24 || null,
            billboards: IDS[kind].map((id) => {
              const b = billboards(kind).get(id);
              check(b, `Missing ${kind} billboard ${id}`);
              return {
                id,
                ready: b.ready,
                show: b.show,
                collectionShow: b._billboardCollection.show,
                position: vector(b.position),
                rotation: b.rotation,
                scale: b.scale,
                color: [
                  b.color.red,
                  b.color.green,
                  b.color.blue,
                  b.color.alpha,
                ],
              };
            }),
          },
        ]),
      );
    }
    function settings() {
      return {
        environment: readPerformanceEnvironment({
          viewer,
          appCommit,
          harnessCommit: params.get('harness'),
        }),
        resolutionScale: viewer.resolutionScale,
        msaaSamples: viewer.scene.msaaSamples,
        context: viewer.scene.context._gl.getContextAttributes(),
      };
    }
    async function refresh() {
      await Promise.all(
        Object.values(layers).map((layer) => layer.update(viewer)),
      );
      for (const [kind, layer] of Object.entries(layers))
        check(
          layer.getStats().count === IDS[kind].length,
          `${kind} source population mismatch`,
        );
    }
    async function ready() {
      const end = performance.now() + 10000;
      while (performance.now() < end) {
        check(errors.length === 0, errors.join(';'));
        if (
          Object.keys(layers).every(
            (kind) =>
              billboards(kind).size === IDS[kind].length &&
              [...billboards(kind).values()].every((b) => b.ready),
          )
        )
          return;
        governor.governorRequestRender('fixture-materialization');
        await sleep(20);
      }
      throw new Error('Fleet billboards failed to materialize');
    }
    async function capture(name) {
      let frameOutput;
      const remove = viewer.scene.postRender.addEventListener(() => {
        frameOutput = {
          output: output(),
          camera: {
            position: vector(viewer.camera.positionWC),
            direction: vector(viewer.camera.directionWC),
            up: vector(viewer.camera.upWC),
          },
          logicalTimeMs: clock.now(),
        };
      });
      let canvas;
      let captured;
      try {
        canvas = await captureFreshCesiumFrame(viewer, { timeoutMs: 400 });
        check(canvas && frameOutput, `${name}: completed frame unavailable`);
        remove();
        const bytes = canvas
          .getContext('2d')
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let colored = 0;
        for (let i = 0; i < bytes.length; i += 4)
          if (bytes[i] > 40 || bytes[i + 1] > 40 || bytes[i + 2] > 40)
            colored++;
        captured = {
          name,
          ...frameOutput,
          settings: settings(),
          governor: governor.getRenderGovernorDiagnostics(),
          pixels: {
            width: canvas.width,
            height: canvas.height,
            sha256: await sha(bytes),
            coloredPixels: colored,
            png: canvas.toDataURL('image/png'),
          },
        };
        if (name !== 'disabled')
          check(colored > 20, `${name}: fixture image is empty`);
        else {
          check(colored === 0, 'Disabled fleet still paints visible pixels');
          check(
            Object.values(frameOutput.output).every((fleet) =>
              fleet.billboards.every((b) => !b.collectionShow),
            ),
            'Disabled fleet collection remains visible',
          );
        }
        check(errors.length === 0, errors.join(';'));
        return captured;
      } catch (error) {
        error.frameCapture = captured;
        throw error;
      } finally {
        remove();
        if (canvas) canvas.width = canvas.height = 0;
      }
    }
    async function dispose() {
      const failures = [];
      for (const layer of [military, civil]) {
        try {
          layer.destroy(viewer);
        } catch (e) {
          failures.push(String(e.message));
        }
      }
      const beforeUninstall = governor.getRenderGovernorDiagnostics();
      if (
        beforeUninstall.holds.length ||
        beforeUninstall.scheduledUpdates.length
      )
        failures.push('Layer demand survived destruction');
      removers.forEach((remove) => remove());
      lifetime.abort();
      registry.dispose();
      governor.uninstallRenderGovernor(viewer);
      if (governor.getRenderGovernorDiagnostics().installed)
        failures.push('Fixture governor survived uninstall');
      viewer.destroy();
      return {
        viewerDestroyed: viewer.isDestroyed(),
        governor: governor.getRenderGovernorDiagnostics(),
        beforeUninstall,
        failures,
      };
    }
    return {
      viewer,
      layers,
      frames,
      errors,
      settings,
      output,
      capture,
      dispose,
      ready,
      refresh,
      observeFleetCadence(start) {
        const points = Object.fromEntries(
          Object.keys(layers).map((kind) => [
            kind,
            billboards(kind).get(IDS[kind][0]),
          ]),
        );
        const previous = {};
        const updates = { civil: [], military: [] };
        const remove = viewer.scene.postRender.addEventListener(() => {
          for (const [kind, billboard] of Object.entries(points)) {
            const p = billboard.position;
            const prior = previous[kind];
            if (
              !prior ||
              p.x !== prior[0] ||
              p.y !== prior[1] ||
              p.z !== prior[2]
            ) {
              updates[kind].push(performance.now() - start);
              previous[kind] = [p.x, p.y, p.z];
            }
          }
        });
        removers.push(remove);
        return {
          stop() {
            remove();
            return updates;
          },
        };
      },
      setRevision(value) {
        revision = value;
      },
      async init() {
        await ensureGeoidReady();
        for (const layer of Object.values(layers)) {
          layer.init(viewer);
          layer.enable(viewer);
        }
        await refresh();
        revision = 1;
        await refresh();
        revision = 2;
        await refresh();
        await ready();
      },
    };
  } catch (error) {
    for (const dispose of setupCleanup.reverse()) {
      try {
        dispose();
      } catch {
        /* Preserve the setup failure. */
      }
    }
    throw error;
  }
}

async function run() {
  check(
    ['baseline', 'candidate'].includes(implementation),
    'Expected implementation=baseline or candidate',
  );
  check(['correctness', 'cadence'].includes(mode), 'Unknown fixture mode');
  check(
    /^[a-f0-9]{40}$/.test(appCommit || ''),
    'Served application has no exact build identity',
  );
  check(
    appCommit === params.get('appCommit'),
    'Served application differs from expected commit',
  );
  check(
    /^[a-f0-9]{40}$/.test(params.get('harness') || ''),
    'Exact harness revision required',
  );
  check(
    document.visibilityState === 'visible',
    'Fixture document is not visible',
  );
  let backgrounded = false;
  const visibility = () => {
    if (document.visibilityState !== 'visible') backgrounded = true;
  };
  document.addEventListener('visibilitychange', visibility);
  const clock = fixtureClock();
  let fixture;
  const result = {
    schema: 'gev-fleet-render-demand/v2',
    status: 'running',
    applicationCommit: appCommit,
    harnessCommit: params.get('harness'),
    fixture: '20-aircraft-fixed-source/v2',
    epochMs: EPOCH,
    implementation,
    mode,
    samples: [],
    checks: [],
    cleanup: null,
  };
  const assertCheck = (id, value) => {
    result.checks.push({ id, status: value ? 'passed' : 'failed' });
    check(value, id);
  };
  try {
    fixture = await createFixture(clock);
    await fixture.init();
    result.settings = fixture.settings();
    assertCheck(
      'population',
      fixture.layers.civil.getStats().count === 12 &&
        fixture.layers.military.getStats().count === 8,
    );
    if (mode === 'cadence') {
      clock.start();
      await sleep(500);
      const frameStart = fixture.frames.length,
        start = performance.now();
      const observer = fixture.observeFleetCadence(start);
      await sleep(3000);
      result.cadence = {
        durationMs: performance.now() - start,
        frameTimesMs: fixture.frames.slice(frameStart).map((t) => t - start),
        demand: governor.getRenderGovernorDiagnostics(),
        output: fixture.output(),
        fleetUpdateTimesMs: observer.stop(),
      };
      assertCheck(
        'cadence-delivers-frames',
        result.cadence.frameTimesMs.length >= 10,
      );
      assertCheck(
        'untracked-demand',
        implementation === 'baseline'
          ? result.cadence.demand.holds.length === 2
          : result.cadence.demand.holds.length === 0 &&
              result.cadence.demand.scheduledUpdates.length === 2,
      );
    } else {
      result.samples.push(await fixture.capture('initial'));
      for (const offset of [80, 160, 240, 320]) {
        clock.set(EPOCH + offset);
        result.samples.push(await fixture.capture(`motion-${offset}`));
      }
      assertCheck(
        'aircraft-moves',
        JSON.stringify(
          result.samples[0].output.civil.billboards.map((b) => b.position),
        ) !==
          JSON.stringify(
            result.samples
              .at(-1)
              .output.civil.billboards.map((b) => b.position),
          ),
      );
      clock.set(EPOCH + 30000);
      fixture.setRevision(3);
      await fixture.refresh();
      // Source arrival must schedule its own frame; a capture request is not
      // allowed to hide a missing wake. Observe a new completed frame first.
      let frames = fixture.frames.length;
      await sleep(200);
      assertCheck('source-arrival-frame', fixture.frames.length > frames);
      result.samples.push(await fixture.capture('source-refresh'));
      fixture.viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(-122.19, 37.86, 730000),
        orientation: { heading: 0.12, pitch: -1.53, roll: 0 },
      });
      fixture.viewer.camera.moveEnd.raiseEvent();
      result.samples.push(await fixture.capture('camera-change'));
      for (const active of [true, false]) {
        document.body.classList.toggle('cockpit-mode', active);
        window.dispatchEvent(
          new CustomEvent('gev:cockpit-mode-changed', {
            detail: { active, subjectId: IDS.civil[0] },
          }),
        );
        // Cockpit entry replaces silhouettes with atlas-backed contact pips.
        // Do not compare the intermediate frame while those images are loading.
        await fixture.ready();
        result.samples.push(
          await fixture.capture(active ? 'cockpit-enter' : 'cockpit-exit'),
        );
      }
      for (const kind of ['civil', 'military']) {
        assertCheck(
          `${kind}-track-start`,
          fixture.layers[kind].trackById(IDS[kind][0]),
        );
        const demand = governor.getRenderGovernorDiagnostics();
        assertCheck(
          `${kind}-continuous-tracking`,
          demand.mode === 'continuous' && demand.holds.length > 0,
        );
        await sleep(200);
        await fixture.ready();
        assertCheck(
          `${kind}-tracked-id`,
          fixture.layers[kind].getTrackedInfo()?.icao24 === IDS[kind][0],
        );
        result.samples.push(await fixture.capture(`${kind}-tracked`));
        fixture.layers[kind].stopTracking();
        await fixture.ready();
        assertCheck(
          `${kind}-untracked`,
          fixture.layers[kind].getTrackedInfo() === null,
        );
        result.samples.push(await fixture.capture(`${kind}-released`));
      }
      frames = fixture.frames.length;
      for (const layer of Object.values(fixture.layers))
        layer.disable(fixture.viewer);
      await sleep(150);
      assertCheck('disabled-final-frame', fixture.frames.length > frames);
      result.samples.push(await fixture.capture('disabled'));
      assertCheck(
        'disabled-releases-demand',
        governor.getRenderGovernorDiagnostics().holds.length === 0 &&
          governor.getRenderGovernorDiagnostics().scheduledUpdates.length === 0,
      );
      // Reuse the actual layer instances after destruction, as the production
      // lifecycle permits. This catches a permanently disposed demand owner.
      for (const layer of Object.values(fixture.layers))
        layer.destroy(fixture.viewer);
      clock.set(EPOCH);
      fixture.setRevision(0);
      await fixture.init();
      frames = fixture.frames.length;
      await sleep(200);
      assertCheck('reinit-resumes-frames', fixture.frames.length > frames);
      result.samples.push(await fixture.capture('reinitialized'));
    }
    assertCheck('foreground', !backgrounded);
    assertCheck('no-render-errors', fixture.errors.length === 0);
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed';
    if (error.frameCapture) result.failedCapture = error.frameCapture;
    result.error = String(error.stack || error).slice(0, 3000);
  } finally {
    try {
      if (fixture) result.cleanup = await fixture.dispose();
    } catch (error) {
      result.cleanup = { failures: [String(error.message)] };
    }
    if (!result.cleanup?.viewerDestroyed || result.cleanup.failures.length)
      result.status = 'failed';
    clock.restore();
    document.body.classList.remove('cockpit-mode');
    document.removeEventListener('visibilitychange', visibility);
  }
  return result;
}

document.querySelector('#run').addEventListener('click', async () => {
  document.querySelector('#run').disabled = true;
  document.querySelector('#status').textContent =
    'Running actual layer implementation…';
  try {
    report = await run();
  } catch (error) {
    report = {
      status: 'failed',
      applicationCommit: appCommit,
      error: String(error.stack || error),
    };
  }
  document.querySelector('#result').textContent = JSON.stringify(report);
  document.querySelector('#status').textContent = report.status;
  document.querySelector('#download').disabled = false;
});
document.querySelector('#download').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `fleet-${appCommit}-${mode}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
document.querySelector('#status').textContent = 'Ready';
document.querySelector('#run').disabled = false;
