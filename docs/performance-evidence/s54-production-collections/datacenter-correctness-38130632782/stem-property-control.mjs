import { Cartesian3, Entity } from 'cesium';
import PolylineGeometryUpdater from '@cesium/engine/Source/DataSources/PolylineGeometryUpdater.js';

const scene = { frameState: { context: { depthTexture: false } } };
function build(id, doubleBuffered) {
  const base = Cartesian3.fromDegrees(-70, 40, 0);
  const tip = Cartesian3.fromDegrees(-70, 40, 1000);
  const buffers = doubleBuffered ? [[base, tip], [base, tip]] : [[base, tip]];
  const entity = new Entity({ id, position: tip, polyline: { positions: buffers[0], width: 3.5 } });
  const updater = new PolylineGeometryUpdater(entity, scene);
  let propertyChanges = 0;
  let entityChanges = 0;
  let geometryChanges = 0;
  entity.polyline.positions.definitionChanged.addEventListener(() => propertyChanges++);
  entity.definitionChanged.addEventListener((_entity, name) => {
    if (name === 'polyline') entityChanges++;
  });
  updater.geometryChanged.addEventListener(() => geometryChanges++);
  return { base, tip, buffers, entity, updater, counts: () => ({ propertyChanges, entityChanges, geometryChanges }) };
}
function update(record, n) {
  const next = Cartesian3.clone(record.tip);
  next.z += 10 + n;
  Cartesian3.clone(next, record.tip);
  const index = record.buffers.length === 1 ? 0 : 1 - (n % 2);
  const positions = record.buffers[index];
  positions[0] = record.base;
  positions[1] = record.tip;
  record.entity.position.setValue(record.tip);
  record.entity.polyline.positions.setValue(positions);
}

const alternating = build('alternating-double-buffer', true);
const shared = build('single-shared-buffer-control', false);
const rows = [];
for (let i = 0; i < 6; i++) {
  update(alternating, i);
  update(shared, i);
  rows.push({ update: i + 1, doubleBuffered: alternating.counts(), sharedBuffer: shared.counts() });
}
const result = {
  cesiumVersion: '1.138.0',
  updaterScene: 'actual PolylineGeometryUpdater with terrain support disabled by context.depthTexture=false',
  updateProtocol: 'mutate reusable base/tip Cartesian3 objects, alternate two [base, tip] arrays, call Entity.position.setValue(tip), then PolylineGraphics.positions.setValue(array)',
  rows,
  interpretation: {
    productionPatternRaisesGeometryChangedEveryUpdate: rows.every((row) => row.doubleBuffered.geometryChanges === row.update),
    sharedArrayWouldSuppressPolylineGeometryChanged: rows.every((row) => row.sharedBuffer.geometryChanges === 0),
  },
};
console.log(JSON.stringify(result, null, 2));
alternating.updater.destroy();
shared.updater.destroy();