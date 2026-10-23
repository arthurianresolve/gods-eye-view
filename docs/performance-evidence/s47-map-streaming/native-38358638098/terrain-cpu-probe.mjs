import * as C from 'cesium';
import { createDeterministicMapStreamingFixture } from '../../../../scripts/performance/mapStreamingFixture.mjs';
const fixture = await createDeterministicMapStreamingFixture(),
  handlers = new Map();
for (const name of [
  'createVerticesFromQuantizedTerrainMesh',
  'upsampleQuantizedTerrainMesh',
]) {
  globalThis.self = {};
  await import(
    '../../../../node_modules/@cesium/engine/Source/Workers/' + name + '.js'
  );
  handlers.set(name, globalThis.self.onmessage);
}
let result;
globalThis.postMessage = (r) => {
  result = r;
};
C.TaskProcessor.prototype.scheduleTask = async function (parameters) {
  const handler = handlers.get(this._workerPath);
  if (!handler) throw Error('Unexpected worker ' + this._workerPath);
  result = null;
  await handler({ data: { id: 1, parameters, canTransferArrayBuffer: false } });
  if (result.error) throw Error(result.error.message || String(result.error));
  return result.result;
};
const bytesFor = (r) => {
  const p = new URL(r.url).pathname.slice(1),
    a = fixture.assets.get(p);
  if (!a) throw Error('Unknown path ' + p);
  return Buffer.from(a.bytes || a);
};
C.Resource.prototype.fetchJson = function () {
  return Promise.resolve(JSON.parse(bytesFor(this).toString()));
};
C.Resource.prototype.fetchArrayBuffer = function () {
  const b = bytesFor(this);
  return Promise.resolve(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
};
const terrain = await C.CesiumTerrainProvider.fromUrl(
  'http://fixture.invalid/terrain/',
);
const reports = [];
for (const row of fixture.manifest.coverage.terrain.slice(0, 2)) {
  const tile = row.tiles[0],
    d = await terrain.requestTileGeometry(tile.x, tile.y, tile.level);
  const mesh = await d.createMesh({
    tilingScheme: terrain.tilingScheme,
    x: tile.x,
    y: tile.y,
    level: tile.level,
  });
  const children = [];
  for (let dx = 0; dx < 2; dx++)
    for (let dy = 0; dy < 2; dy++) {
      const x = tile.x * 2 + dx,
        y = tile.y * 2 + dy,
        level = tile.level + 1;
      try {
        const u = await d.upsample(
          terrain.tilingScheme,
          tile.x,
          tile.y,
          tile.level,
          x,
          y,
          level,
        );
        children.push({
          x,
          y,
          level,
          available: terrain.getTileDataAvailable(x, y, level),
          vertices: u?._quantizedVertices?.length / 3,
          min: u?._minimumHeight,
          max: u?._maximumHeight,
          boundsFinite: Number.isFinite(u?._boundingSphere?.radius),
        });
      } catch (e) {
        children.push({
          x,
          y,
          level,
          available: terrain.getTileDataAvailable(x, y, level),
          error: e.message,
        });
      }
    }
  reports.push({ tile, meshVertices: mesh.vertexCountWithoutSkirts, children });
}
console.log(
  JSON.stringify(
    {
      schema: 'gev-map-terrain-cpu-probe/v1',
      cesiumVersion: C.VERSION,
      fixtureId: fixture.id,
      manifestSha256: fixture.manifestSha256,
      scope:
        'Pinned CPU worker functions; scoped isolated-process TaskProcessor seam; no actual worker transport or rendering',
      reports,
    },
    null,
    2,
  ),
);
