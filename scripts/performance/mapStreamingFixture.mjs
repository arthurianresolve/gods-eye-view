import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';

export const MAP_STREAMING_FIXTURE_ID = 'austin-map-streaming-synthetic-v1';
export const MAP_STREAMING_FIXTURE_SCHEMA = 'gev-map-streaming-fixture/v1';
export const MAP_STREAMING_GENERATOR_VERSION = '1.0.0';
export const MAP_STREAMING_MAX_BYTES = 5 * 1024 * 1024;

const ROUTE = Object.freeze({
  west: -97.82,
  south: 30.2,
  east: -97.58,
  north: 30.34,
});
const IMAGERY_LEVELS = Object.freeze(
  Array.from({ length: 13 }, (_, level) => level),
);
const TERRAIN_LEVELS = Object.freeze(
  Array.from({ length: 11 }, (_, level) => level),
);
const TERRAIN_GRID_SIZE = 17;
const TILESET_DEPTH = 2;
const TILESET_LOCAL_TEXTURE_SIZE = 16;
const PALETTE = Object.freeze([
  [17, 32, 57],
  [28, 55, 76],
  [42, 78, 92],
  [57, 101, 102],
  [76, 119, 96],
  [105, 135, 83],
  [143, 146, 79],
  [180, 155, 91],
  [204, 173, 119],
  [221, 198, 151],
  [232, 218, 184],
  [129, 89, 72],
  [109, 72, 65],
  [85, 68, 70],
  [57, 60, 74],
  [239, 239, 226],
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function stableJson(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function storedZlib(bytes) {
  const blocks = [];
  for (let offset = 0; offset < bytes.length;) {
    const length = Math.min(65_535, bytes.length - offset);
    const final = offset + length === bytes.length;
    const header = Buffer.allocUnsafe(5);
    header[0] = final ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE(~length & 0xffff, 3);
    blocks.push(header, bytes.subarray(offset, offset + length));
    offset += length;
  }
  const checksum = Buffer.allocUnsafe(4);
  checksum.writeUInt32BE(adler32(bytes));
  return Buffer.concat([Buffer.from([0x78, 0x01]), ...blocks, checksum]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const chunk = Buffer.allocUnsafe(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.length + 8);
  return chunk;
}

function deterministicPng({ width, height, seed, pixel }) {
  const palette = Buffer.from(PALETTE.flat());
  const header = Buffer.allocUnsafe(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const rows = Buffer.allocUnsafe(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1)
      rows[row + 1 + x] = pixel(x, y, seed) & 0x0f;
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('PLTE', palette),
    pngChunk('IDAT', storedZlib(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function seedFromId(id) {
  let seed = 0x811c9dc5;
  for (const character of id) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return seed;
}

function tileCoordinates(scheme, bounds, level) {
  const corners = [
    Cesium.Cartographic.fromDegrees(bounds.west, bounds.south),
    Cesium.Cartographic.fromDegrees(bounds.west, bounds.north - 1e-10),
    Cesium.Cartographic.fromDegrees(bounds.east - 1e-10, bounds.south),
    Cesium.Cartographic.fromDegrees(bounds.east - 1e-10, bounds.north - 1e-10),
  ].map((position) => scheme.positionToTileXY(position, level));
  const minX = Math.min(...corners.map((tile) => tile.x));
  const maxX = Math.max(...corners.map((tile) => tile.x));
  const minY = Math.min(...corners.map((tile) => tile.y));
  const maxY = Math.max(...corners.map((tile) => tile.y));
  const rows = [];
  for (let y = minY; y <= maxY; y += 1)
    for (let x = minX; x <= maxX; x += 1) rows.push({ x, y, level });
  return rows;
}

function encodeZigZagDelta(values) {
  const result = new Uint16Array(values.length);
  let previous = 0;
  for (let index = 0; index < values.length; index += 1) {
    const delta = values[index] - previous;
    const encoded = delta >= 0 ? delta * 2 : -delta * 2 - 1;
    if (encoded > 0xffff)
      throw new RangeError('Quantized mesh delta overflow.');
    result[index] = encoded;
    previous = values[index];
  }
  return result;
}

function encodeHighWater(indices) {
  const encoded = new Uint16Array(indices.length);
  let highest = 0;
  for (let index = 0; index < indices.length; index += 1) {
    const value = indices[index];
    const code = highest - value;
    if (code < 0 || code > 0xffff)
      throw new RangeError('Quantized mesh high-water order is invalid.');
    encoded[index] = code;
    if (code === 0) highest += 1;
  }
  return encoded;
}

function createTerrainTile(tile) {
  const tilingScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: Cesium.Ellipsoid.WGS84,
  });
  const rectangle = tilingScheme.tileXYToRectangle(tile.x, tile.y, tile.level);
  const gridSize = TERRAIN_GRID_SIZE;
  const triangles = [];
  let nextIndex = 0;
  const indexByPoint = new Map();
  const vertexPoints = [];
  const addPoint = (x, y) => {
    const key = `${x}:${y}`;
    let index = indexByPoint.get(key);
    if (index === undefined) {
      index = nextIndex++;
      indexByPoint.set(key, index);
      vertexPoints.push({ x, y });
    }
    return index;
  };
  for (let y = 0; y < gridSize - 1; y += 1) {
    const xStart = y % 2 === 0 ? 0 : gridSize - 2;
    const xEnd = y % 2 === 0 ? gridSize - 2 : 0;
    const step = y % 2 === 0 ? 1 : -1;
    for (let x = xStart; ; x += step) {
      const a = addPoint(x, y);
      const b = addPoint(x + 1, y);
      const c = addPoint(x, y + 1);
      const d = addPoint(x + 1, y + 1);
      triangles.push(a, b, c, b, d, c);
      if (x === xEnd) break;
    }
  }
  // The serpentine triangle walk must visit the full structured grid.
  for (let y = 0; y < gridSize; y += 1)
    for (let x = 0; x < gridSize; x += 1) addPoint(x, y);
  if (vertexPoints.length !== gridSize * gridSize)
    throw new Error('Quantized mesh grid is incomplete.');

  const seed = seedFromId(`${tile.level}/${tile.x}/${tile.y}`);
  const u = vertexPoints.map((point) =>
    Math.round((point.x * 32767) / (gridSize - 1)),
  );
  const v = vertexPoints.map((point) =>
    Math.round((point.y * 32767) / (gridSize - 1)),
  );
  const height = vertexPoints.map((point) => {
    const ridge = (point.x * 977 + point.y * 613 + (seed % 2048)) % 8192;
    return 12_000 + ridge * 2;
  });
  const vertexBytes = Buffer.allocUnsafe(vertexPoints.length * 6);
  const encodedChannels = [u, v, height].map(encodeZigZagDelta);
  let vertexOffset = 0;
  for (const channel of encodedChannels)
    for (const value of channel) {
      vertexBytes.writeUInt16LE(value, vertexOffset);
      vertexOffset += 2;
    }

  const encodedIndices = encodeHighWater(triangles);
  const edgeIndices = {
    west: Array.from({ length: gridSize }, (_, index) =>
      indexByPoint.get(`0:${index}`),
    ),
    south: Array.from({ length: gridSize }, (_, index) =>
      indexByPoint.get(`${index}:0`),
    ),
    east: Array.from({ length: gridSize }, (_, index) =>
      indexByPoint.get(`${gridSize - 1}:${index}`),
    ),
    north: Array.from({ length: gridSize }, (_, index) =>
      indexByPoint.get(`${index}:${gridSize - 1}`),
    ),
  };
  const centerHeight = 320;
  const center = Cesium.Cartesian3.fromRadians(
    (rectangle.west + rectangle.east) / 2,
    (rectangle.south + rectangle.north) / 2,
    centerHeight,
    Cesium.Ellipsoid.WGS84,
  );
  const positions = [];
  for (const longitude of [rectangle.west, rectangle.east])
    for (const latitude of [rectangle.south, rectangle.north])
      for (const altitude of [120, 880])
        positions.push(
          Cesium.Cartesian3.fromRadians(
            longitude,
            latitude,
            altitude,
            Cesium.Ellipsoid.WGS84,
          ),
        );
  const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
  const horizonOcclusionPoint =
    new Cesium.EllipsoidalOccluder(
      Cesium.Ellipsoid.WGS84,
      Cesium.Cartesian3.ZERO,
    ).computeHorizonCullingPointFromVertices(
      boundingSphere.center,
      positions.flatMap((position) => [position.x, position.y, position.z]),
      3,
      Cesium.Cartesian3.ZERO,
    ) ?? Cesium.Cartesian3.ZERO;
  const output = Buffer.allocUnsafe(
    92 + vertexBytes.length + 4 + encodedIndices.length * 2 + 16 + gridSize * 8,
  );
  let offset = 0;
  for (const value of [center.x, center.y, center.z]) {
    output.writeDoubleLE(value, offset);
    offset += 8;
  }
  output.writeFloatLE(120, offset);
  offset += 4;
  output.writeFloatLE(880, offset);
  offset += 4;
  for (const value of [
    boundingSphere.center.x,
    boundingSphere.center.y,
    boundingSphere.center.z,
    boundingSphere.radius,
    horizonOcclusionPoint.x,
    horizonOcclusionPoint.y,
    horizonOcclusionPoint.z,
  ]) {
    output.writeDoubleLE(value, offset);
    offset += 8;
  }
  output.writeUInt32LE(vertexPoints.length, offset);
  offset += 4;
  vertexBytes.copy(output, offset);
  offset += vertexBytes.length;
  if (offset % 2 !== 0) offset += 1;
  output.writeUInt32LE(triangles.length / 3, offset);
  offset += 4;
  for (const value of encodedIndices) {
    output.writeUInt16LE(value, offset);
    offset += 2;
  }
  for (const edge of [
    edgeIndices.west,
    edgeIndices.south,
    edgeIndices.east,
    edgeIndices.north,
  ]) {
    output.writeUInt32LE(edge.length, offset);
    offset += 4;
    for (const value of edge) {
      output.writeUInt16LE(value, offset);
      offset += 2;
    }
  }
  if (offset !== output.length)
    throw new Error('Quantized mesh encoded length does not match its header.');
  return output;
}

function createGlb(tile, bounds) {
  const gridSize = 5;
  const positions = [];
  const normals = [];
  const texcoords = [];
  const worldTransform = Cesium.Matrix4.fromArray(localTransform(bounds));
  const worldToLocal = Cesium.Matrix4.inverseTransformation(
    worldTransform,
    new Cesium.Matrix4(),
  );
  for (let y = 0; y < gridSize; y += 1)
    for (let x = 0; x < gridSize; x += 1) {
      const wave = (x * 7 + y * 11 + tile.level * 13 + tile.x * 3 + tile.y) % 9;
      const cartesian = Cesium.Cartesian3.fromDegrees(
        Cesium.Math.lerp(bounds.west, bounds.east, x / (gridSize - 1)),
        Cesium.Math.lerp(bounds.south, bounds.north, y / (gridSize - 1)),
        wave * 3,
      );
      const local = Cesium.Matrix4.multiplyByPoint(
        worldToLocal,
        cartesian,
        new Cesium.Cartesian3(),
      );
      positions.push(local.x, local.y, local.z);
      normals.push(0, 0, 1);
      texcoords.push(x / (gridSize - 1), y / (gridSize - 1));
    }
  const encodedPositions = positions.map(Math.fround);
  const positionMinimum = [0, 1, 2].map((component) =>
    Math.min(...encodedPositions.filter((_, index) => index % 3 === component)),
  );
  const positionMaximum = [0, 1, 2].map((component) =>
    Math.max(...encodedPositions.filter((_, index) => index % 3 === component)),
  );
  const indices = [];
  for (let y = 0; y < gridSize - 1; y += 1)
    for (let x = 0; x < gridSize - 1; x += 1) {
      const a = y * gridSize + x;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  const texture = deterministicPng({
    width: TILESET_LOCAL_TEXTURE_SIZE,
    height: TILESET_LOCAL_TEXTURE_SIZE,
    seed: seedFromId(`${tile.level}/${tile.x}/${tile.y}/texture`),
    pixel(x, y, seed) {
      return (x * 5 + y * 3 + (seed >>> 8)) % PALETTE.length;
    },
  });
  const binaryParts = [];
  const views = [];
  const append = (bytes, target = undefined) => {
    const padding =
      (4 - (binaryParts.reduce((sum, part) => sum + part.length, 0) % 4)) % 4;
    if (padding) binaryParts.push(Buffer.alloc(padding));
    const byteOffset = binaryParts.reduce((sum, part) => sum + part.length, 0);
    binaryParts.push(bytes);
    const view = { buffer: 0, byteOffset, byteLength: bytes.length };
    if (target !== undefined) view.target = target;
    views.push(view);
    return views.length - 1;
  };
  const toBytes = (values, type) => {
    // `values` is already a flattened scalar array. Multiplying by the
    // component count here leaves uninitialized bytes in every vertex view.
    const bytes = Buffer.allocUnsafe(values.length * type.BYTES_PER_ELEMENT);
    let offset = 0;
    for (const value of values) {
      if (type === Float32Array) {
        bytes.writeFloatLE(value, offset);
        offset += 4;
      } else {
        bytes.writeUInt16LE(value, offset);
        offset += 2;
      }
    }
    return bytes;
  };
  const positionsView = append(toBytes(encodedPositions, Float32Array), 34962);
  const normalsView = append(toBytes(normals, Float32Array), 34962);
  const texcoordView = append(toBytes(texcoords, Float32Array), 34962);
  const indexView = append(toBytes(indices, Uint16Array), 34963);
  const imageView = append(texture);
  const binary = Buffer.concat(binaryParts);
  const gltf = {
    asset: {
      version: '2.0',
      generator: `${MAP_STREAMING_FIXTURE_ID}/${MAP_STREAMING_GENERATOR_VERSION}`,
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 1,
        },
        doubleSided: true,
      },
    ],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [
      { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 },
    ],
    images: [{ bufferView: imageView, mimeType: 'image/png' }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: views,
    accessors: [
      {
        bufferView: positionsView,
        componentType: 5126,
        count: positions.length / 3,
        type: 'VEC3',
        min: positionMinimum,
        max: positionMaximum,
      },
      {
        bufferView: normalsView,
        componentType: 5126,
        count: normals.length / 3,
        type: 'VEC3',
      },
      {
        bufferView: texcoordView,
        componentType: 5126,
        count: texcoords.length / 2,
        type: 'VEC2',
      },
      {
        bufferView: indexView,
        componentType: 5123,
        count: indices.length,
        type: 'SCALAR',
      },
    ],
  };
  const jsonBytesUnpadded = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonBytes = Buffer.concat([
    jsonBytesUnpadded,
    Buffer.alloc((4 - (jsonBytesUnpadded.length % 4)) % 4, 0x20),
  ]);
  const binBytes = Buffer.concat([
    binary,
    Buffer.alloc((4 - (binary.length % 4)) % 4),
  ]);
  const totalLength = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const header = Buffer.allocUnsafe(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.allocUnsafe(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.allocUnsafe(8);
  binHeader.writeUInt32LE(binBytes.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binBytes]);
}

function childrenFor(bounds, level, x, y) {
  const middleLongitude = (bounds.west + bounds.east) / 2;
  const middleLatitude = (bounds.south + bounds.north) / 2;
  return [
    {
      west: bounds.west,
      south: bounds.south,
      east: middleLongitude,
      north: middleLatitude,
    },
    {
      west: middleLongitude,
      south: bounds.south,
      east: bounds.east,
      north: middleLatitude,
    },
    {
      west: bounds.west,
      south: middleLatitude,
      east: middleLongitude,
      north: bounds.north,
    },
    {
      west: middleLongitude,
      south: middleLatitude,
      east: bounds.east,
      north: bounds.north,
    },
  ].map((childBounds, quadrant) => ({
    bounds: childBounds,
    tile: {
      level: level + 1,
      x: x * 2 + (quadrant % 2),
      y: y * 2 + Math.floor(quadrant / 2),
    },
  }));
}

function regionForBounds(bounds, minHeight = -10, maxHeight = 900) {
  return [
    Cesium.Math.toRadians(bounds.west),
    Cesium.Math.toRadians(bounds.south),
    Cesium.Math.toRadians(bounds.east),
    Cesium.Math.toRadians(bounds.north),
    minHeight,
    maxHeight,
  ];
}

function localTransform(bounds) {
  const longitude = Cesium.Math.toRadians((bounds.west + bounds.east) / 2);
  const latitude = Cesium.Math.toRadians((bounds.south + bounds.north) / 2);
  const sinLongitude = Math.sin(longitude);
  const cosLongitude = Math.cos(longitude);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const center = Cesium.Cartesian3.fromRadians(longitude, latitude, 0);
  return [
    -sinLongitude,
    cosLongitude,
    0,
    0,
    -sinLatitude * cosLongitude,
    -sinLatitude * sinLongitude,
    cosLatitude,
    0,
    cosLatitude * cosLongitude,
    cosLatitude * sinLongitude,
    sinLatitude,
    0,
    center.x,
    center.y,
    center.z,
    1,
  ];
}

function assignRelativeTransforms(node, parentWorldTransform = undefined) {
  const worldTransform = Cesium.Matrix4.fromArray(localTransform(node.bounds));
  if (parentWorldTransform) {
    const inverseParent = Cesium.Matrix4.inverseTransformation(
      parentWorldTransform,
      new Cesium.Matrix4(),
    );
    node.transform = Array.from(
      Cesium.Matrix4.multiply(
        inverseParent,
        worldTransform,
        new Cesium.Matrix4(),
      ),
    );
  } else {
    node.transform = Array.from(worldTransform);
  }
  for (const child of node.children ?? [])
    assignRelativeTransforms(child, worldTransform);
}

function addAsset(assets, path, kind, bytes, identity) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new TypeError(`Generated ${kind} asset ${path} is empty.`);
  assets.set(path, bytes);
  return {
    path,
    kind,
    identity,
    byteLength: bytes.length,
    sha256: sha256(bytes),
  };
}

export async function createDeterministicMapStreamingFixture() {
  const assets = new Map();
  const assetRows = [];
  const imageryScheme = new Cesium.WebMercatorTilingScheme();
  const terrainScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: Cesium.Ellipsoid.WGS84,
  });
  const imageryCoverage = IMAGERY_LEVELS.map((level) => {
    const tiles = tileCoordinates(imageryScheme, ROUTE, level);
    for (const tile of tiles) {
      const id = `imagery/${tile.level}/${tile.x}/${tile.y}`;
      const seed = seedFromId(id);
      const bytes = deterministicPng({
        width: 256,
        height: 256,
        seed,
        pixel(x, y, tileSeed) {
          const contour = Math.floor((x + y + (tileSeed & 0xff)) / 11);
          return contour + Math.floor(x / 32) * 3 + Math.floor(y / 32) * 5;
        },
      });
      assetRows.push(
        addAsset(assets, `${id}.png`, 'webmercator-imagery-png', bytes, tile),
      );
    }
    return { level, tiles };
  });
  const terrainCoverage = TERRAIN_LEVELS.map((level) => {
    const tiles = tileCoordinates(terrainScheme, ROUTE, level);
    const yTileCount = terrainScheme.getNumberOfYTilesAtLevel(level);
    for (const tile of tiles) {
      const tmsY = yTileCount - tile.y - 1;
      const path = `terrain/${tile.level}/${tile.x}/${tmsY}.terrain`;
      const bytes = createTerrainTile(tile);
      assetRows.push(
        addAsset(assets, path, 'quantized-mesh-1.0', bytes, {
          ...tile,
          tmsY,
        }),
      );
    }
    return { level, tiles };
  });
  const terrainAvailability = Array.from(
    { length: TERRAIN_LEVELS.at(-1) + 1 },
    () => [],
  );
  for (const row of assetRows) {
    if (row.kind !== 'quantized-mesh-1.0') continue;
    const { level, x, tmsY } = row.identity;
    terrainAvailability[level].push({
      startX: x,
      endX: x,
      startY: tmsY,
      endY: tmsY,
    });
  }
  assetRows.push(
    addAsset(
      assets,
      'terrain/layer.json',
      'quantized-mesh-layer-metadata',
      stableJson({
        format: 'quantized-mesh-1.0',
        version: '1.0.0',
        scheme: 'tms',
        projection: 'EPSG:4326',
        maxzoom: TERRAIN_LEVELS.at(-1),
        tiles: ['{z}/{x}/{y}.terrain'],
        available: terrainAvailability,
      }),
      {
        minLevel: TERRAIN_LEVELS[0],
        maxLevel: TERRAIN_LEVELS.at(-1),
        availableLevelCount: terrainAvailability.length,
      },
    ),
  );
  const rootNode = {
    level: 0,
    x: 0,
    y: 0,
    bounds: ROUTE,
    geometricError: 2_400,
  };
  const tileNodes = [rootNode];
  const appendChildren = (parent) => {
    if (parent.level >= TILESET_DEPTH) return;
    parent.children = childrenFor(
      parent.bounds,
      parent.level,
      parent.x,
      parent.y,
    ).map(({ bounds, tile }) => ({
      ...tile,
      bounds,
      geometricError: parent.geometricError / 4,
    }));
    tileNodes.push(...parent.children);
    for (const child of parent.children) appendChildren(child);
  };
  appendChildren(rootNode);
  assignRelativeTransforms(rootNode);
  for (const node of tileNodes) {
    const id = `${node.level}/${node.x}/${node.y}`;
    const path = `tiles/level-${node.level}/${node.x}-${node.y}.glb`;
    const glb = createGlb(node, node.bounds);
    node.content = { uri: `../${path}` };
    node.boundingVolume = { region: regionForBounds(node.bounds) };
    assetRows.push(
      addAsset(assets, path, 'textured-glb', glb, {
        level: node.level,
        x: node.x,
        y: node.y,
      }),
    );
    delete node.bounds;
  }
  const toTilesetJson = (node) => ({
    boundingVolume: node.boundingVolume,
    geometricError: node.geometricError,
    refine: 'REPLACE',
    transform: node.transform,
    ...(node.content ? { content: node.content } : {}),
    ...(node.children?.length
      ? { children: node.children.map(toTilesetJson) }
      : {}),
  });
  const tilesetJson = {
    asset: { version: '1.1', gltfUpAxis: 'Z' },
    geometricError: rootNode.geometricError,
    root: toTilesetJson(rootNode),
  };
  assetRows.push(
    addAsset(
      assets,
      'tileset/tileset.json',
      '3d-tiles-1.1',
      stableJson(tilesetJson),
      { rootChildren: rootNode.children.length, tileCount: tileNodes.length },
    ),
  );

  assetRows.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const totalBytes = assetRows.reduce(
    (sum, asset) => sum + asset.byteLength,
    0,
  );
  if (totalBytes > MAP_STREAMING_MAX_BYTES)
    throw new RangeError(
      `Generated map fixture exceeds ${MAP_STREAMING_MAX_BYTES} bytes.`,
    );
  const descriptor = {
    id: MAP_STREAMING_FIXTURE_ID,
    schema: MAP_STREAMING_FIXTURE_SCHEMA,
    generatorVersion: MAP_STREAMING_GENERATOR_VERSION,
    seed: 0x47a57,
    scope:
      'deterministic synthetic Austin route fixture; no live provider or credential inputs',
    routeBoundsDegrees: ROUTE,
    geometry: {
      terrainFormat: 'quantized-mesh-1.0',
      terrainTilingScheme: 'EPSG:4326 geographic with Cesium TMS URL y',
      terrainGridSize: TERRAIN_GRID_SIZE,
      terrainLevels: TERRAIN_LEVELS,
      imageryFormat: 'PNG indexed-color 256x256',
      imageryTilingScheme: 'WebMercator XYZ',
      imageryLevels: IMAGERY_LEVELS,
      tilesetVersion: '3D Tiles 1.1',
      gltfVersion: '2.0 GLB textured irregular-height grid',
      tilesetDepth: TILESET_DEPTH,
      tilesetNodeCount: tileNodes.length,
    },
    coverage: {
      imagery: imageryCoverage,
      terrain: terrainCoverage,
      tilesetRegions: tileNodes.map((node) => ({
        level: node.level,
        x: node.x,
        y: node.y,
        region: node.boundingVolume.region,
      })),
    },
  };
  const generatorBytes = await readFile(fileURLToPath(import.meta.url));
  const manifest = {
    ...descriptor,
    descriptorSha256: sha256(stableJson(descriptor)),
    generatorSourceSha256: sha256(generatorBytes),
    assetCount: assetRows.length,
    totalBytes,
    maxBytes: MAP_STREAMING_MAX_BYTES,
    assets: assetRows,
  };
  const manifestBytes = stableJson(manifest);
  const fixture = {
    id: MAP_STREAMING_FIXTURE_ID,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    assets,
  };
  validateDeterministicMapStreamingFixture(fixture);
  return fixture;
}

export function validateDeterministicMapStreamingFixture(fixture) {
  if (
    fixture?.id !== MAP_STREAMING_FIXTURE_ID ||
    fixture.manifest?.schema !== MAP_STREAMING_FIXTURE_SCHEMA ||
    fixture.manifest?.generatorVersion !== MAP_STREAMING_GENERATOR_VERSION ||
    fixture.manifest?.scope !==
      'deterministic synthetic Austin route fixture; no live provider or credential inputs' ||
    !Array.isArray(fixture.manifest.assets) ||
    fixture.manifest.assets.length > 128 ||
    !(fixture.assets instanceof Map) ||
    fixture.assets.size !== fixture.manifest.assets.length
  )
    throw new TypeError(
      `Map streaming fixture manifest or asset inventory is invalid: ${JSON.stringify({ id: fixture?.id, schema: fixture?.manifest?.schema, generatorVersion: fixture?.manifest?.generatorVersion, assetRows: fixture?.manifest?.assets?.length ?? null, assetMapSize: fixture?.assets instanceof Map ? fixture.assets.size : null })}`,
    );
  if (
    !Number.isSafeInteger(fixture.manifest.totalBytes) ||
    fixture.manifest.totalBytes < 1 ||
    fixture.manifest.totalBytes > MAP_STREAMING_MAX_BYTES ||
    fixture.manifest.maxBytes !== MAP_STREAMING_MAX_BYTES ||
    fixture.manifest.assetCount !== fixture.manifest.assets.length
  )
    throw new RangeError(
      'Map streaming fixture byte and asset bounds are invalid.',
    );
  const seen = new Set();
  let measuredBytes = 0;
  for (const row of fixture.manifest.assets) {
    if (
      typeof row?.path !== 'string' ||
      row.path.length > 256 ||
      row.path.startsWith('/') ||
      row.path.includes('..') ||
      seen.has(row.path) ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      !Number.isSafeInteger(row.byteLength) ||
      row.byteLength < 1
    )
      throw new TypeError(
        'Map streaming fixture contains an invalid asset row.',
      );
    seen.add(row.path);
    const bytes = fixture.assets.get(row.path);
    if (!Buffer.isBuffer(bytes) || bytes.length !== row.byteLength)
      throw new Error(
        `Map streaming fixture asset length mismatch: ${row.path}`,
      );
    if (sha256(bytes) !== row.sha256)
      throw new Error(
        `Map streaming fixture asset SHA-256 mismatch: ${row.path}`,
      );
    measuredBytes += bytes.length;
    if (measuredBytes > MAP_STREAMING_MAX_BYTES)
      throw new RangeError(
        'Map streaming fixture materialization exceeds its byte limit.',
      );
  }
  if (measuredBytes !== fixture.manifest.totalBytes)
    throw new Error('Map streaming fixture aggregate length mismatch.');
  if (
    fixture.manifestBytes?.length > MAP_STREAMING_MAX_BYTES ||
    !Buffer.isBuffer(fixture.manifestBytes) ||
    sha256(fixture.manifestBytes) !== fixture.manifestSha256 ||
    !fixture.manifestBytes.equals(stableJson(fixture.manifest))
  )
    throw new Error(
      'Map streaming fixture manifest bytes or SHA-256 mismatch.',
    );
  return true;
}
