import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';

export const MAP_STREAMING_FIXTURE_ID = 'austin-map-streaming-synthetic-v6';
export const MAP_STREAMING_FIXTURE_SCHEMA = 'gev-map-streaming-fixture/v5';
export const MAP_STREAMING_GENERATOR_VERSION = '6.0.0';
export const MAP_STREAMING_MAX_BYTES = 64 * 1024 * 1024;
export const MAP_STREAMING_MAX_ASSETS = 32_000;

const IMAGERY_TEMPLATE_INDEX_BYTE_LENGTH = 30_064;
const IMAGERY_TEMPLATE_INDEX_SHA256 =
  'ae50c9282f09381606334ebb274a4b68baf6c37a9de587e3eac155aab9aa9d04';
const IMAGERY_TEMPLATE_CORPUS_BYTE_LENGTH = 236_362;
const IMAGERY_TEMPLATE_CORPUS_SHA256 =
  '63ba23e27807fa0997a6e55c5541b0c5a7e22a9395c672109ec3c069ec3087d9';
const IMAGERY_TEMPLATE_SEED_COUNT = 256;
const IMAGERY_TEMPLATE_PATTERN_COUNT = 176;
const IMAGERY_TEMPLATE_PERIOD = 176;
const IMAGERY_TEMPLATE_DESCRIPTOR = Object.freeze({
  schema: 'gev-map-png-template-index/v1',
  version: 'austin-map-high-imagery-templates-v2',
  indexSha256: IMAGERY_TEMPLATE_INDEX_SHA256,
  corpusSha256: IMAGERY_TEMPLATE_CORPUS_SHA256,
  corpusByteLength: IMAGERY_TEMPLATE_CORPUS_BYTE_LENGTH,
  seedCount: IMAGERY_TEMPLATE_SEED_COUNT,
  patternCount: IMAGERY_TEMPLATE_PATTERN_COUNT,
  levels: Object.freeze([13, 14, 15, 16]),
  pixelPatternVersion: 'contour-period-176-v1',
});

export const MAP_STREAMING_CANONICAL_TILE_ORIGIN = Object.freeze({
  sourceRevision: '7fbbf1fa56fe3d9c746827be0b501b7b31cfb87e',
  sourceManifestSha256:
    '36eb2997bb092b029a541b810f92d7c19d982010e763129948acb438c18a277f',
  assetVersion: '1.0.0',
  assetBytes: 66_887,
});

const CANONICAL_TILE_ROWS = Object.freeze(
  [
    [
      'tiles/level-0/0-0.glb',
      2704,
      '3a1d34fff6b48c3fb1c122a829d093a403550c92af71956a6deedb43d7a3fe79',
    ],
    [
      'tiles/level-1/0-0.glb',
      2700,
      '8a3bb382461c15f20aa065dddcb6e75382f4ccdb7bebb19ec92ecef52f455bf8',
    ],
    [
      'tiles/level-1/0-1.glb',
      2708,
      '918be284118c732b321768463278525739433a482b6e21840cb729b14239305d',
    ],
    [
      'tiles/level-1/1-0.glb',
      2684,
      'e1be7aea931442097c41c248e6ec8395e249a67c89ef2a2fb3406b534cd97b53',
    ],
    [
      'tiles/level-1/1-1.glb',
      2688,
      'da283d89e2113a4ce32063fe70ab99d486d7a4adb580bd7ce7b4d3bbebbd267b',
    ],
    [
      'tiles/level-2/0-0.glb',
      2692,
      'e909ddae1e553822cc466a1a56950330e06e30d0d6f3581f5b07261295db1c71',
    ],
    [
      'tiles/level-2/0-1.glb',
      2712,
      '9efb0a2d0a5143b523ea8e4e4aebe9035677177a1a1a7facd58f6d0b9e743fc4',
    ],
    [
      'tiles/level-2/0-2.glb',
      2712,
      'b1eea4d9282aa01b37ae9422a3cdf109c946f0c80f47cba67197af7703788272',
    ],
    [
      'tiles/level-2/0-3.glb',
      2712,
      '3e7d3ed541afb8cd626d7ffcdc0016230558cfb6915a715aea58a454ff8cb78d',
    ],
    [
      'tiles/level-2/1-0.glb',
      2708,
      'dff279c8f25c89e83e810d6c98e68eef868553bbf3e421bbbb50aefb3eadfe67',
    ],
    [
      'tiles/level-2/1-1.glb',
      2704,
      '78c5405707acb73bbf949e9dd41f824b8ec4be05517c66be6ab8f94a70aceb6d',
    ],
    [
      'tiles/level-2/1-2.glb',
      2712,
      '7d72843f0fa283e04c2dedd8c6ff0f70a5ebe32c030e5e9f70d71b50959040c0',
    ],
    [
      'tiles/level-2/1-3.glb',
      2708,
      '9da90181324f4e832d0e7157b8f65630dbee5a42c39629ea82e3cf21aa4b3e43',
    ],
    [
      'tiles/level-2/2-0.glb',
      2712,
      '08c903f747e4da2a090f7e877429e59a2d31408ff13ccdebc4aeabadcf54fc51',
    ],
    [
      'tiles/level-2/2-1.glb',
      2712,
      '7ab2f3bcea396379999dcfce70b57446df53cc4fa290966a9040cad6ab1a0982',
    ],
    [
      'tiles/level-2/2-2.glb',
      2708,
      '8c260ebbdbd1fcbf8ce0dd05c8ce5fb07a60c4cc4189a99e26f6df26c94dcd06',
    ],
    [
      'tiles/level-2/2-3.glb',
      2688,
      '3a6ddd3f35f8bc75a74bf0073478c13eeaafde55eb94825c0cb85d55474f5f6a',
    ],
    [
      'tiles/level-2/3-0.glb',
      2692,
      '916709e52d2d52e2800bba519893e12d4eb7e5a28e544f8e33d958c76375f20f',
    ],
    [
      'tiles/level-2/3-1.glb',
      2712,
      '7c289f712c508f343855c3adc2a44b6fe397c568813f9bda0d479d0def707eff',
    ],
    [
      'tiles/level-2/3-2.glb',
      2712,
      'd51791cfb7f850ca34eee9c531117b3c27c278b31e2a2daf4492d61c45217dbe',
    ],
    [
      'tiles/level-2/3-3.glb',
      2712,
      '13d5392d0a5bdc27864315f28d7e6e1f3b5d0064606ae73c59283652cdddf908',
    ],
    [
      'tileset/tileset.json',
      10095,
      '7a33437b19f17f4512a9c8f9865699c7452e9ef21eebf2a514a50b5b7f04ad19',
    ],
  ].map(([path, byteLength, sha256]) => {
    const match = path.match(/^tiles\/level-(\d+)\/(\d+)-(\d+)\.glb$/);
    return Object.freeze({
      path,
      byteLength,
      sha256,
      kind: match ? 'textured-glb' : '3d-tiles-1.1',
      identity: match
        ? Object.freeze({
            level: Number(match[1]),
            x: Number(match[2]),
            y: Number(match[3]),
          })
        : Object.freeze({ rootChildren: 4, tileCount: 21 }),
    });
  }),
);

const CANONICAL_TILES_ROOT = new URL(
  './fixtures/austin-map-streaming-v1/',
  import.meta.url,
);

function validatePinnedTileBytes(record, bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== record.byteLength ||
    sha256(bytes) !== record.sha256
  )
    throw new Error(
      `Pinned map tile bytes failed length/SHA validation: ${record.path}`,
    );
  if (record.kind === 'textured-glb') {
    if (
      bytes.length < 20 ||
      bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length ||
      bytes.readUInt32LE(12) + 20 > bytes.length
    )
      throw new Error(`Pinned GLB structure is malformed: ${record.path}`);
  } else {
    let document;
    try {
      document = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error(`Pinned tileset JSON is malformed: ${record.path}`);
    }
    if (
      document?.asset?.version !== '1.1' ||
      !document.root ||
      document.root.children?.length !== 4
    )
      throw new Error(`Pinned tileset identity is malformed: ${record.path}`);
  }
  return Buffer.from(bytes);
}

export async function loadPinnedMapTilesetAssets({ readAsset } = {}) {
  const read =
    readAsset ??
    ((path) => readFile(fileURLToPath(new URL(path, CANONICAL_TILES_ROOT))));
  if (typeof read !== 'function')
    throw new TypeError('Pinned map asset reader must be a function.');
  const assets = new Map();
  for (const record of CANONICAL_TILE_ROWS) {
    let bytes;
    try {
      bytes = await read(record.path);
    } catch {
      throw new Error(`Pinned map tile is missing: ${record.path}`);
    }
    if (assets.has(record.path))
      throw new Error(`Pinned map tile identity is duplicated: ${record.path}`);
    assets.set(record.path, validatePinnedTileBytes(record, bytes));
  }
  if (
    assets.size !== CANONICAL_TILE_ROWS.length ||
    [...assets.keys()].some(
      (path, index) => path !== CANONICAL_TILE_ROWS[index].path,
    )
  )
    throw new Error(
      'Pinned map tile inventory contains an unexpected identity.',
    );
  return assets;
}

export function validatePinnedMapTileRows(rows) {
  if (!Array.isArray(rows) || rows.length !== CANONICAL_TILE_ROWS.length)
    throw new Error('Pinned map tile row count or inventory is invalid.');
  const seen = new Set();
  const rowsByPath = new Map();
  for (const row of rows) {
    if (!row || typeof row.path !== 'string' || seen.has(row.path))
      throw new Error(
        'Pinned map tile rows contain a duplicate or invalid identity.',
      );
    seen.add(row.path);
    rowsByPath.set(row.path, row);
  }
  for (const expected of CANONICAL_TILE_ROWS) {
    const actual = rowsByPath.get(expected.path);
    if (
      !actual ||
      actual.kind !== expected.kind ||
      actual.byteLength !== expected.byteLength ||
      actual.sha256 !== expected.sha256 ||
      !actual.identity ||
      Object.keys(actual.identity).length !==
        Object.keys(expected.identity).length ||
      Object.entries(expected.identity).some(
        ([key, value]) => actual.identity[key] !== value,
      )
    )
      throw new Error(
        `Pinned map tile identity or metadata mismatch: ${expected.path}`,
      );
  }
  return true;
}

const ROUTE = Object.freeze({
  west: -97.82,
  south: 30.2,
  east: -97.58,
  north: 30.34,
});
const IMAGERY_LEVELS = Object.freeze(
  Array.from({ length: 19 }, (_, level) => level),
);
const TERRAIN_LEVELS = Object.freeze(
  Array.from({ length: 11 }, (_, level) => level),
);
const TERRAIN_GRID_SIZE = 17;
const TERRAIN_MINIMUM_HEIGHT = 120;
const TERRAIN_MAXIMUM_HEIGHT = 880;
const TILESET_DEPTH = 2;
const TILESET_LOCAL_TEXTURE_SIZE = 16;
const IMAGERY_SKELETON_DEPENDENCY_DESCRIPTOR = Object.freeze({
  provider: 'OpenStreetMapImageryProvider',
  algorithm:
    'Cesium ImageryLayer._createTileImagerySkeletons plus imagery parent chain',
  terrainBounds: 'full Geographic QuadtreeTile rectangles',
  upsampledDescendants:
    'not separately enumerated; browser-observed requests remain the rendered-route evidence',
  routeCoverageRemainsSeparate: true,
});
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

function deterministicPng({ width, height, seed, pixel, transparent = false }) {
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
    ...(transparent ? [pngChunk('tRNS', Buffer.alloc(PALETTE.length, 0))] : []),
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

function requiredHighImagerySeeds() {
  const seeds = new Set();
  for (const level of [13, 14, 15, 16])
    for (const tile of tileCoordinates(
      new Cesium.WebMercatorTilingScheme(),
      ROUTE,
      level,
    ))
      seeds.add(seedFromId(`imagery/${level}/${tile.x}/${tile.y}`) & 0xff);
  return [...seeds].sort((left, right) => left - right);
}

/** Validate immutable pre-encoded PNG templates used for native high LODs. */
export function validatePinnedMapImageryTemplateCorpus(
  indexBytes,
  corpusBytes,
) {
  if (
    !Buffer.isBuffer(indexBytes) ||
    indexBytes.length !== IMAGERY_TEMPLATE_INDEX_BYTE_LENGTH ||
    sha256(indexBytes) !== IMAGERY_TEMPLATE_INDEX_SHA256 ||
    !Buffer.isBuffer(corpusBytes) ||
    corpusBytes.length !== IMAGERY_TEMPLATE_CORPUS_BYTE_LENGTH ||
    sha256(corpusBytes) !== IMAGERY_TEMPLATE_CORPUS_SHA256
  )
    throw new Error(
      'Pinned map imagery template index or corpus identity mismatch.',
    );

  let index;
  try {
    index = JSON.parse(indexBytes.toString('utf8'));
  } catch {
    throw new TypeError('Pinned map imagery template index is malformed.');
  }
  if (
    !stableJson(index).equals(indexBytes) ||
    index.schema !== 'gev-map-png-template-index/v1' ||
    index.version !== 'austin-map-high-imagery-templates-v2' ||
    !stableJson(index.routeBoundsDegrees).equals(stableJson(ROUTE)) ||
    !stableJson(index.levels).equals(stableJson([13, 14, 15, 16])) ||
    index.width !== 256 ||
    index.height !== 256 ||
    index.bitDepth !== 8 ||
    index.colorType !== 3 ||
    index.filter !== 0 ||
    index.paletteSha256 !== sha256(Buffer.from(PALETTE.flat())) ||
    index.pixelPatternVersion !== 'contour-period-176-v1' ||
    index.encoding !== 'indexed-png; pinned pre-encoded deflate bytes' ||
    index.corpusByteLength !== corpusBytes.length ||
    index.corpusSha256 !== IMAGERY_TEMPLATE_CORPUS_SHA256 ||
    index.seedCount !== IMAGERY_TEMPLATE_SEED_COUNT ||
    index.patternCount !== IMAGERY_TEMPLATE_PATTERN_COUNT ||
    !Array.isArray(index.seedMappings) ||
    index.seedMappings.length !== IMAGERY_TEMPLATE_SEED_COUNT ||
    !Array.isArray(index.templates) ||
    index.templates.length !== IMAGERY_TEMPLATE_PATTERN_COUNT
  )
    throw new Error('Pinned map imagery template index metadata is invalid.');

  const requiredSeeds = requiredHighImagerySeeds();
  const expectedPatterns = [
    ...new Set(requiredSeeds.map((seed) => seed % IMAGERY_TEMPLATE_PERIOD)),
  ].sort((left, right) => left - right);
  if (
    requiredSeeds.length !== IMAGERY_TEMPLATE_SEED_COUNT ||
    expectedPatterns.length !== IMAGERY_TEMPLATE_PATTERN_COUNT
  )
    throw new Error('Pinned high-level imagery seed inventory changed.');

  const seedMappings = new Map();
  for (
    let indexInRows = 0;
    indexInRows < requiredSeeds.length;
    indexInRows += 1
  ) {
    const row = index.seedMappings[indexInRows];
    if (
      !row ||
      Object.keys(row).sort().join(',') !== 'patternId,seed' ||
      row.seed !== requiredSeeds[indexInRows] ||
      row.patternId !== row.seed % IMAGERY_TEMPLATE_PERIOD ||
      seedMappings.has(row.seed)
    )
      throw new Error('Pinned map imagery seed mapping is invalid.');
    seedMappings.set(row.seed, row.patternId);
  }

  const templates = new Map();
  const digests = new Set();
  let expectedOffset = 0;
  for (let rowIndex = 0; rowIndex < expectedPatterns.length; rowIndex += 1) {
    const row = index.templates[rowIndex];
    if (
      !row ||
      Object.keys(row).sort().join(',') !==
        'byteLength,offset,patternId,sha256' ||
      row.patternId !== expectedPatterns[rowIndex] ||
      !Number.isSafeInteger(row.offset) ||
      row.offset !== expectedOffset ||
      !Number.isSafeInteger(row.byteLength) ||
      row.byteLength < 1 ||
      row.byteLength > 2_048 ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      digests.has(row.sha256)
    )
      throw new Error(
        'Pinned map imagery template range or identity is invalid.',
      );
    const endOffset = row.offset + row.byteLength;
    if (endOffset > corpusBytes.length)
      throw new Error('Pinned map imagery template range exceeds its corpus.');
    const pngBytes = corpusBytes.subarray(row.offset, endOffset);
    if (
      sha256(pngBytes) !== row.sha256 ||
      !pngBytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      pngBytes.readUInt32BE(16) !== 256 ||
      pngBytes.readUInt32BE(20) !== 256 ||
      pngBytes[24] !== 8 ||
      pngBytes[25] !== 3
    )
      throw new Error('Pinned map imagery PNG template bytes are invalid.');
    expectedOffset = endOffset;
    digests.add(row.sha256);
    templates.set(row.patternId, pngBytes);
  }
  if (expectedOffset !== corpusBytes.length)
    throw new Error('Pinned map imagery template corpus has trailing bytes.');
  const bySeed = new Map();
  for (const [seed, patternId] of seedMappings)
    bySeed.set(seed, templates.get(patternId));
  return bySeed;
}

let cachedPinnedImageryTemplates;

function loadPinnedMapImageryTemplatesSync() {
  if (cachedPinnedImageryTemplates) return cachedPinnedImageryTemplates;
  const base = new URL('./fixtures/austin-map-streaming-v5/', import.meta.url);
  const indexBytes = readFileSync(
    fileURLToPath(new URL('imagery-png-templates.json', base)),
  );
  const corpusBytes = readFileSync(
    fileURLToPath(new URL('imagery-png-templates.bin', base)),
  );
  cachedPinnedImageryTemplates = validatePinnedMapImageryTemplateCorpus(
    indexBytes,
    corpusBytes,
  );
  return cachedPinnedImageryTemplates;
}

async function loadPinnedMapImageryTemplates() {
  if (cachedPinnedImageryTemplates) return cachedPinnedImageryTemplates;
  const base = new URL('./fixtures/austin-map-streaming-v5/', import.meta.url);
  const [indexBytes, corpusBytes] = await Promise.all([
    readFile(new URL('imagery-png-templates.json', base)),
    readFile(new URL('imagery-png-templates.bin', base)),
  ]);
  cachedPinnedImageryTemplates = validatePinnedMapImageryTemplateCorpus(
    indexBytes,
    corpusBytes,
  );
  return cachedPinnedImageryTemplates;
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

function imagerySkeletonDependencyTiles(terrainCoverage, terrainScheme) {
  const imageryProvider = new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
  });
  const imageryLayer = new Cesium.ImageryLayer(imageryProvider);
  const imageryLayers = new Cesium.ImageryLayerCollection();
  imageryLayers.add(imageryLayer);
  const terrainLevelZeroError =
    Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
      terrainScheme.ellipsoid,
      65,
      terrainScheme.getNumberOfXTilesAtLevel(0),
    );
  const terrainProvider = {
    getLevelMaximumGeometricError(level) {
      return terrainLevelZeroError / 2 ** level;
    },
  };
  const identities = new Map();
  try {
    for (const { level, x, y } of terrainCoverage.flatMap(
      ({ tiles }) => tiles,
    )) {
      const terrainTile = new Cesium.QuadtreeTile({
        x,
        y,
        level,
        tilingScheme: terrainScheme,
      });
      terrainTile.data = { imagery: [] };
      imageryLayer._createTileImagerySkeletons(terrainTile, terrainProvider);
      for (const tileImagery of terrainTile.data.imagery) {
        for (
          let imagery = tileImagery.loadingImagery;
          imagery;
          imagery = imagery.parent
        ) {
          const identity = {
            level: imagery.level,
            x: imagery.x,
            y: imagery.y,
          };
          identities.set(
            `${identity.level}/${identity.x}/${identity.y}`,
            identity,
          );
        }
      }
    }
  } finally {
    imageryLayers.destroy();
  }
  return [...identities.values()].sort(
    (left, right) =>
      left.level - right.level || left.x - right.x || left.y - right.y,
  );
}

function createImageryTileBytes(tile, templates) {
  const id = `imagery/${tile.level}/${tile.x}/${tile.y}`;
  const seed = seedFromId(id);
  if (tile.level >= 13) {
    const bytes = templates.get(seed & 0xff);
    if (!bytes)
      throw new Error(`Pinned high-level imagery pattern is missing: ${id}`);
    return Buffer.from(bytes);
  }
  return deterministicPng({
    width: 256,
    height: 256,
    seed,
    pixel(x, y, tileSeed) {
      const contour = Math.floor((x + y + (tileSeed & 0xff)) / 11);
      return contour + Math.floor(x / 32) * 3 + Math.floor(y / 32) * 5;
    },
  });
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

function triangleWave(position, period) {
  const phase = ((position % period) + period) % period;
  return phase <= period / 2 ? phase : period - phase;
}

function syntheticTerrainHeight(longitude, latitude) {
  const longitudeE7 = Math.round(Cesium.Math.toDegrees(longitude) * 1e7);
  const latitudeE7 = Math.round(Cesium.Math.toDegrees(latitude) * 1e7);
  const longitudeRelief = Math.floor(
    (triangleWave(longitudeE7, 800_000) * 80) / 400_000,
  );
  const latitudeRelief = Math.floor(
    (triangleWave(latitudeE7, 600_000) * 50) / 300_000,
  );
  return 280 + longitudeRelief + latitudeRelief;
}

function terrainSkirtHeight(level) {
  const levelZeroError =
    Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
      Cesium.Ellipsoid.WGS84,
      65,
      2,
    );
  return (levelZeroError / 2 ** level) * 5;
}

function createTerrainTile(tile) {
  const tilingScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: Cesium.Ellipsoid.WGS84,
  });
  const rectangle = tilingScheme.tileXYToRectangle(tile.x, tile.y, tile.level);
  const coverageRectangle = {
    west: Math.max(rectangle.west, Cesium.Math.toRadians(ROUTE.west)),
    south: Math.max(rectangle.south, Cesium.Math.toRadians(ROUTE.south)),
    east: Math.min(rectangle.east, Cesium.Math.toRadians(ROUTE.east)),
    north: Math.min(rectangle.north, Cesium.Math.toRadians(ROUTE.north)),
  };
  if (
    coverageRectangle.west >= coverageRectangle.east ||
    coverageRectangle.south >= coverageRectangle.north
  )
    throw new Error(
      'Terrain tile does not intersect declared Austin coverage.',
    );
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

  const u = vertexPoints.map((point) => {
    const longitude = Cesium.Math.lerp(
      coverageRectangle.west,
      coverageRectangle.east,
      point.x / (gridSize - 1),
    );
    const scaled =
      ((longitude - rectangle.west) / (rectangle.east - rectangle.west)) *
      32767;
    if (
      point.x === 0 &&
      coverageRectangle.west === Cesium.Math.toRadians(ROUTE.west)
    )
      return Math.floor(scaled);
    if (
      point.x === gridSize - 1 &&
      coverageRectangle.east === Cesium.Math.toRadians(ROUTE.east)
    )
      return Math.ceil(scaled);
    return Math.round(scaled);
  });
  const v = vertexPoints.map((point) => {
    const latitude = Cesium.Math.lerp(
      coverageRectangle.south,
      coverageRectangle.north,
      point.y / (gridSize - 1),
    );
    const scaled =
      ((latitude - rectangle.south) / (rectangle.north - rectangle.south)) *
      32767;
    if (
      point.y === 0 &&
      coverageRectangle.south === Cesium.Math.toRadians(ROUTE.south)
    )
      return Math.floor(scaled);
    if (
      point.y === gridSize - 1 &&
      coverageRectangle.north === Cesium.Math.toRadians(ROUTE.north)
    )
      return Math.ceil(scaled);
    return Math.round(scaled);
  });
  const height = vertexPoints.map((_, index) => {
    const longitude = Cesium.Math.lerp(
      rectangle.west,
      rectangle.east,
      u[index] / 32767,
    );
    const latitude = Cesium.Math.lerp(
      rectangle.south,
      rectangle.north,
      v[index] / 32767,
    );
    const meters = syntheticTerrainHeight(longitude, latitude);
    return Math.round(
      ((meters - TERRAIN_MINIMUM_HEIGHT) /
        (TERRAIN_MAXIMUM_HEIGHT - TERRAIN_MINIMUM_HEIGHT)) *
        32767,
    );
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
    west:
      coverageRectangle.west === rectangle.west
        ? Array.from({ length: gridSize }, (_, index) =>
            indexByPoint.get(`0:${index}`),
          )
        : [],
    south:
      coverageRectangle.south === rectangle.south
        ? Array.from({ length: gridSize }, (_, index) =>
            indexByPoint.get(`${index}:0`),
          )
        : [],
    east:
      coverageRectangle.east === rectangle.east
        ? Array.from({ length: gridSize }, (_, index) =>
            indexByPoint.get(`${gridSize - 1}:${index}`),
          )
        : [],
    north:
      coverageRectangle.north === rectangle.north
        ? Array.from({ length: gridSize }, (_, index) =>
            indexByPoint.get(`${index}:${gridSize - 1}`),
          )
        : [],
  };
  const minimumHeight = TERRAIN_MINIMUM_HEIGHT;
  const maximumHeight = TERRAIN_MAXIMUM_HEIGHT;
  const skirtHeight = terrainSkirtHeight(tile.level);
  const centerHeight = (minimumHeight + maximumHeight) / 2;
  const center = Cesium.Cartesian3.fromRadians(
    (coverageRectangle.west + coverageRectangle.east) / 2,
    (coverageRectangle.south + coverageRectangle.north) / 2,
    centerHeight,
    Cesium.Ellipsoid.WGS84,
  );
  const positions = vertexPoints.map((point, index) => {
    const longitude = Cesium.Math.lerp(
      rectangle.west,
      rectangle.east,
      u[index] / 32767,
    );
    const latitude = Cesium.Math.lerp(
      rectangle.south,
      rectangle.north,
      v[index] / 32767,
    );
    const altitude =
      minimumHeight + (height[index] / 32767) * (maximumHeight - minimumHeight);
    return Cesium.Cartesian3.fromRadians(
      longitude,
      latitude,
      altitude,
      Cesium.Ellipsoid.WGS84,
    );
  });
  const boundingPositions = [...positions];
  const minimumLongitude = Math.min(...u.map((value) => value / 32767));
  const maximumLongitude = Math.max(...u.map((value) => value / 32767));
  const minimumLatitude = Math.min(...v.map((value) => value / 32767));
  const maximumLatitude = Math.max(...v.map((value) => value / 32767));
  const longitudeOffset =
    (maximumLongitude - minimumLongitude) *
    (rectangle.east - rectangle.west) *
    0.0001;
  const latitudeOffset =
    (maximumLatitude - minimumLatitude) *
    (rectangle.north - rectangle.south) *
    0.0001;
  for (const [edge, longitudeOffsetForEdge, latitudeOffsetForEdge] of [
    [edgeIndices.west, -longitudeOffset, 0],
    [edgeIndices.south, 0, -latitudeOffset],
    [edgeIndices.east, longitudeOffset, 0],
    [edgeIndices.north, 0, latitudeOffset],
  ])
    for (const index of edge) {
      const longitude =
        Cesium.Math.lerp(rectangle.west, rectangle.east, u[index] / 32767) +
        longitudeOffsetForEdge;
      const latitude =
        Cesium.Math.lerp(rectangle.south, rectangle.north, v[index] / 32767) +
        latitudeOffsetForEdge;
      const altitude =
        minimumHeight +
        (height[index] / 32767) * (maximumHeight - minimumHeight) -
        skirtHeight;
      boundingPositions.push(
        Cesium.Cartesian3.fromRadians(
          longitude,
          latitude,
          altitude,
          Cesium.Ellipsoid.WGS84,
        ),
      );
    }
  const boundingSphere = Cesium.BoundingSphere.fromPoints(boundingPositions);
  boundingSphere.radius += 0.1;
  const occluder = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84);
  const horizonOcclusionPoint = occluder.computeHorizonCullingPointFromVertices(
    boundingSphere.center,
    positions.flatMap((position) => [position.x, position.y, position.z]),
    3,
    Cesium.Cartesian3.ZERO,
  );
  if (!horizonOcclusionPoint)
    throw new Error(
      `Terrain route geometry at ${tile.level}/${tile.x}/${tile.y} has no conservative horizon culling point.`,
    );
  const edges = [
    edgeIndices.west,
    edgeIndices.south,
    edgeIndices.east,
    edgeIndices.north,
  ];
  const edgeBytesLength = edges.reduce(
    (sum, edge) => sum + 4 + edge.length * 2,
    0,
  );
  const output = Buffer.allocUnsafe(
    92 + vertexBytes.length + 4 + encodedIndices.length * 2 + edgeBytesLength,
  );
  let offset = 0;
  for (const value of [center.x, center.y, center.z]) {
    output.writeDoubleLE(value, offset);
    offset += 8;
  }
  output.writeFloatLE(minimumHeight, offset);
  offset += 4;
  output.writeFloatLE(maximumHeight, offset);
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
  for (const edge of edges) {
    output.writeUInt32LE(edge.length, offset);
    offset += 4;
    for (const value of edge) {
      output.writeUInt16LE(value, offset);
      offset += 2;
    }
  }
  if (offset !== output.length)
    throw new Error('Quantized mesh encoded length does not match its header.');
  const meshBoundsDegrees = {
    west: Cesium.Math.toDegrees(
      rectangle.west +
        (Math.min(...u) / 32767) * (rectangle.east - rectangle.west),
    ),
    south: Cesium.Math.toDegrees(
      rectangle.south +
        (Math.min(...v) / 32767) * (rectangle.north - rectangle.south),
    ),
    east: Cesium.Math.toDegrees(
      rectangle.west +
        (Math.max(...u) / 32767) * (rectangle.east - rectangle.west),
    ),
    north: Cesium.Math.toDegrees(
      rectangle.south +
        (Math.max(...v) / 32767) * (rectangle.north - rectangle.south),
    ),
  };
  return { bytes: output, meshBoundsDegrees };
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
  const [pinnedTiles, imageryTemplates] = await Promise.all([
    loadPinnedMapTilesetAssets(),
    loadPinnedMapImageryTemplates(),
  ]);
  const imageryScheme = new Cesium.WebMercatorTilingScheme();
  const terrainScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: Cesium.Ellipsoid.WGS84,
  });
  const terrainCoverage = TERRAIN_LEVELS.map((level) => ({
    level,
    tiles: tileCoordinates(terrainScheme, ROUTE, level),
  }));
  const allImagerySkeletonDependencies = imagerySkeletonDependencyTiles(
    terrainCoverage,
    terrainScheme,
  );
  const imageryCoverage = IMAGERY_LEVELS.map((level) => ({
    level,
    tiles: tileCoordinates(imageryScheme, ROUTE, level),
  }));
  const routeImageryIds = new Set(
    imageryCoverage.flatMap(({ level, tiles }) =>
      tiles.map(({ x, y }) => `${level}/${x}/${y}`),
    ),
  );
  const imagerySkeletonDependencies = allImagerySkeletonDependencies.filter(
    (tile) => !routeImageryIds.has(`${tile.level}/${tile.x}/${tile.y}`),
  );
  for (const level of IMAGERY_LEVELS) {
    const tiles = imageryCoverage[level].tiles;
    const dependencyTiles = imagerySkeletonDependencies.filter(
      (tile) => tile.level === level,
    );
    const assetTiles = [
      ...new Map(
        [...tiles, ...dependencyTiles].map((tile) => [
          `${tile.level}/${tile.x}/${tile.y}`,
          tile,
        ]),
      ).values(),
    ].sort((left, right) => left.x - right.x || left.y - right.y);
    for (const tile of assetTiles) {
      const id = `imagery/${tile.level}/${tile.x}/${tile.y}`;
      const bytes = createImageryTileBytes(tile, imageryTemplates);
      assetRows.push(
        addAsset(assets, `${id}.png`, 'webmercator-imagery-png', bytes, tile),
      );
    }
  }
  const imageryServicePath = 'arcgis/rest/services/World_Imagery/MapServer';
  const imageryProjection = new Cesium.WebMercatorProjection();
  const imagerySouthwest = imageryProjection.project(
    Cesium.Cartographic.fromDegrees(ROUTE.west, ROUTE.south),
  );
  const imageryNortheast = imageryProjection.project(
    Cesium.Cartographic.fromDegrees(ROUTE.east, ROUTE.north),
  );
  const imageryServiceMetadata = {
    currentVersion: 11.2,
    serviceDescription: 'Deterministic synthetic Austin route imagery fixture.',
    mapName: 'Synthetic Austin Route Imagery',
    copyrightText: 'Synthetic fixture imagery; no live provider data.',
    capabilities: 'Map,Tilemap',
    spatialReference: { wkid: 102100, latestWkid: 3857 },
    singleFusedMapCache: true,
    tileInfo: {
      rows: 256,
      cols: 256,
      dpi: 96,
      format: 'PNG',
      compressionQuality: 0,
      origin: {
        x: -20_037_508.342789244,
        y: 20_037_508.342789244,
      },
      spatialReference: { wkid: 102100, latestWkid: 3857 },
      lods: IMAGERY_LEVELS.map((level) => {
        const resolution = 156_543.03392804097 / 2 ** level;
        return {
          level,
          resolution,
          scale: (resolution * 96) / 0.0254,
        };
      }),
    },
    fullExtent: {
      xmin: imagerySouthwest.x,
      ymin: imagerySouthwest.y,
      xmax: imageryNortheast.x,
      ymax: imageryNortheast.y,
      spatialReference: { wkid: 102100, latestWkid: 3857 },
    },
  };
  assetRows.push(
    addAsset(
      assets,
      `${imageryServicePath}/metadata.json`,
      'arcgis-mapserver-metadata-json',
      stableJson(imageryServiceMetadata),
      {
        servicePath: imageryServicePath,
        fixtureService: true,
        spatialReferenceWkid: 102100,
        tileWidth: 256,
        tileHeight: 256,
        maximumLevel: IMAGERY_LEVELS.at(-1),
        routeBoundsDegrees: ROUTE,
      },
    ),
  );
  const missingTileProbeLevel = IMAGERY_LEVELS.at(-1);
  const missingTileProbeBytes = deterministicPng({
    width: 256,
    height: 256,
    seed: seedFromId('arcgis-missing-tile-probe'),
    transparent: true,
    pixel: () => 0,
  });
  assetRows.push(
    addAsset(
      assets,
      `${imageryServicePath}/missing-tile-probe/${missingTileProbeLevel}/0/0.png`,
      'arcgis-missing-tile-probe-png',
      missingTileProbeBytes,
      {
        servicePath: imageryServicePath,
        level: missingTileProbeLevel,
        row: 0,
        column: 0,
        width: 256,
        height: 256,
        intendedAlpha: 0,
        reason:
          'default ArcGIS discard-policy probe outside Austin route coverage',
      },
    ),
  );
  const googleCreditPlaceholderBytes = deterministicPng({
    width: 64,
    height: 16,
    seed: seedFromId('synthetic-google-credit-placeholder-v1'),
    pixel(x, y, seed) {
      const border = x < 2 || x > 61 || y < 2 || y > 13;
      const hatch = ((x >> 2) + (y >> 2) + (seed & 1)) % 2 === 0;
      return border ? 3 : hatch ? 15 : 4;
    },
  });
  assetRows.push(
    addAsset(
      assets,
      'google/credit-placeholder.png',
      'synthetic-google-credit-placeholder-png',
      googleCreditPlaceholderBytes,
      {
        width: 64,
        height: 16,
        synthetic: true,
        providerBranding: false,
        reason:
          'visible generated placeholder for the native Cesium credit image request; not provider artwork',
      },
    ),
  );
  for (const { level, tiles } of terrainCoverage) {
    const yTileCount = terrainScheme.getNumberOfYTilesAtLevel(level);
    for (const tile of tiles) {
      const tmsY = yTileCount - tile.y - 1;
      const path = `terrain/${tile.level}/${tile.x}/${tmsY}.terrain`;
      const { bytes, meshBoundsDegrees } = createTerrainTile(tile);
      assetRows.push(
        addAsset(assets, path, 'quantized-mesh-1.0', bytes, {
          ...tile,
          tmsY,
          meshBoundsDegrees,
        }),
      );
    }
  }
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
  for (const node of tileNodes) {
    const id = `${node.level}/${node.x}/${node.y}`;
    const path = `tiles/level-${node.level}/${node.x}-${node.y}.glb`;
    const glb = pinnedTiles.get(path);
    if (!glb)
      throw new Error(
        `Pinned map tile inventory lacks generated identity ${id}.`,
      );
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
  const tilesetBytes = pinnedTiles.get('tileset/tileset.json');
  if (!tilesetBytes)
    throw new Error('Pinned map tile inventory lacks the canonical tileset.');
  assetRows.push(
    addAsset(assets, 'tileset/tileset.json', '3d-tiles-1.1', tilesetBytes, {
      rootChildren: rootNode.children.length,
      tileCount: tileNodes.length,
    }),
  );

  const pinnedRows = assetRows.filter((row) =>
    ['textured-glb', '3d-tiles-1.1'].includes(row.kind),
  );
  pinnedRows.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  validatePinnedMapTileRows(pinnedRows);

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
  const terrainAssetRows = assetRows.filter(
    (row) => row.kind === 'quantized-mesh-1.0',
  );
  const terrainMeshBoundsDegrees = {
    west: Math.min(
      ...terrainAssetRows.map((row) => row.identity.meshBoundsDegrees.west),
    ),
    south: Math.min(
      ...terrainAssetRows.map((row) => row.identity.meshBoundsDegrees.south),
    ),
    east: Math.max(
      ...terrainAssetRows.map((row) => row.identity.meshBoundsDegrees.east),
    ),
    north: Math.max(
      ...terrainAssetRows.map((row) => row.identity.meshBoundsDegrees.north),
    ),
  };
  const descriptor = {
    id: MAP_STREAMING_FIXTURE_ID,
    schema: MAP_STREAMING_FIXTURE_SCHEMA,
    generatorVersion: MAP_STREAMING_GENERATOR_VERSION,
    seed: 0x47a57,
    scope:
      'deterministic synthetic Austin route fixture; no live provider or credential inputs',
    canonicalTiles: {
      version: MAP_STREAMING_CANONICAL_TILE_ORIGIN.assetVersion,
      sourceRevision: MAP_STREAMING_CANONICAL_TILE_ORIGIN.sourceRevision,
      sourceManifestSha256:
        MAP_STREAMING_CANONICAL_TILE_ORIGIN.sourceManifestSha256,
      byteLength: MAP_STREAMING_CANONICAL_TILE_ORIGIN.assetBytes,
      assets: pinnedRows.map(
        ({ path, kind, identity, byteLength, sha256 }) => ({
          path,
          kind,
          identity,
          byteLength,
          sha256,
        }),
      ),
    },
    routeBoundsDegrees: ROUTE,
    imageryTemplateCorpus: IMAGERY_TEMPLATE_DESCRIPTOR,
    geometry: {
      terrainFormat: 'quantized-mesh-1.0',
      terrainTilingScheme: 'EPSG:4326 geographic with Cesium TMS URL y',
      terrainGridSize: TERRAIN_GRID_SIZE,
      terrainLevels: TERRAIN_LEVELS,
      terrainMeshBoundsDegrees,
      terrainCoverageKind:
        'route-clipped quantized mesh within available tiles',
      imageryFormat: 'PNG indexed-color 256x256',
      imageryTilingScheme: 'WebMercator XYZ',
      imageryRouteCoverageKind: 'route-bbox tiles only',
      imageryDependencyCoverage: IMAGERY_SKELETON_DEPENDENCY_DESCRIPTOR,
      imageryLevels: IMAGERY_LEVELS,
      tilesetVersion: '3D Tiles 1.1',
      gltfVersion: '2.0 GLB textured irregular-height grid',
      tilesetDepth: TILESET_DEPTH,
      tilesetNodeCount: tileNodes.length,
    },
    coverage: {
      imagery: imageryCoverage,
      imagerySkeletonDependencies,
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
    fixture.manifest.assets.length > MAP_STREAMING_MAX_ASSETS ||
    !(fixture.assets instanceof Map) ||
    fixture.assets.size !== fixture.manifest.assets.length
  )
    throw new TypeError(
      `Map streaming fixture manifest or asset inventory is invalid: ${JSON.stringify({ id: fixture?.id, schema: fixture?.manifest?.schema, generatorVersion: fixture?.manifest?.generatorVersion, assetRows: fixture?.manifest?.assets?.length ?? null, assetMapSize: fixture?.assets instanceof Map ? fixture.assets.size : null })}`,
    );
  validatePinnedMapTileRows(
    fixture.manifest.assets.filter((row) =>
      ['textured-glb', '3d-tiles-1.1'].includes(row.kind),
    ),
  );
  if (
    fixture.manifest.canonicalTiles?.version !==
      MAP_STREAMING_CANONICAL_TILE_ORIGIN.assetVersion ||
    fixture.manifest.canonicalTiles?.sourceRevision !==
      MAP_STREAMING_CANONICAL_TILE_ORIGIN.sourceRevision ||
    fixture.manifest.canonicalTiles?.sourceManifestSha256 !==
      MAP_STREAMING_CANONICAL_TILE_ORIGIN.sourceManifestSha256 ||
    fixture.manifest.canonicalTiles?.byteLength !==
      MAP_STREAMING_CANONICAL_TILE_ORIGIN.assetBytes ||
    !stableJson(fixture.manifest.canonicalTiles.assets).equals(
      stableJson(
        fixture.manifest.assets
          .filter((row) => ['textured-glb', '3d-tiles-1.1'].includes(row.kind))
          .map(({ path, kind, identity, byteLength, sha256 }) => ({
            path,
            kind,
            identity,
            byteLength,
            sha256,
          })),
      ),
    )
  )
    throw new Error('Map streaming canonical tile descriptor is invalid.');
  if (
    !stableJson(fixture.manifest.imageryTemplateCorpus).equals(
      stableJson(IMAGERY_TEMPLATE_DESCRIPTOR),
    )
  )
    throw new Error('Map streaming imagery template descriptor is invalid.');
  if (
    !stableJson(fixture.manifest.routeBoundsDegrees).equals(
      stableJson(ROUTE),
    ) ||
    !stableJson(fixture.manifest.geometry?.imageryLevels).equals(
      stableJson(IMAGERY_LEVELS),
    ) ||
    fixture.manifest.geometry?.imageryFormat !== 'PNG indexed-color 256x256' ||
    fixture.manifest.geometry?.imageryTilingScheme !== 'WebMercator XYZ' ||
    fixture.manifest.geometry?.imageryRouteCoverageKind !==
      'route-bbox tiles only' ||
    !stableJson(fixture.manifest.geometry?.imageryDependencyCoverage).equals(
      stableJson(IMAGERY_SKELETON_DEPENDENCY_DESCRIPTOR),
    )
  )
    throw new Error('Map streaming imagery route or geometry is invalid.');
  const expectedImageryCoverage = IMAGERY_LEVELS.map((level) => ({
    level,
    tiles: tileCoordinates(new Cesium.WebMercatorTilingScheme(), ROUTE, level),
  }));
  if (
    !stableJson(fixture.manifest.coverage?.imagery).equals(
      stableJson(expectedImageryCoverage),
    )
  )
    throw new Error('Map streaming imagery route coverage is invalid.');
  const terrainScheme = new Cesium.GeographicTilingScheme({
    ellipsoid: Cesium.Ellipsoid.WGS84,
  });
  const expectedTerrainCoverage = TERRAIN_LEVELS.map((level) => ({
    level,
    tiles: tileCoordinates(terrainScheme, ROUTE, level),
  }));
  if (
    !stableJson(fixture.manifest.coverage?.terrain).equals(
      stableJson(expectedTerrainCoverage),
    )
  )
    throw new Error('Map streaming terrain route coverage is invalid.');
  const allExpectedImageryDependencies = imagerySkeletonDependencyTiles(
    expectedTerrainCoverage,
    terrainScheme,
  );
  const expectedRouteImageryIds = new Set(
    expectedImageryCoverage.flatMap(({ level, tiles }) =>
      tiles.map(({ x, y }) => `${level}/${x}/${y}`),
    ),
  );
  const expectedImageryDependencies = allExpectedImageryDependencies.filter(
    (tile) => !expectedRouteImageryIds.has(`${tile.level}/${tile.x}/${tile.y}`),
  );
  if (
    !stableJson(fixture.manifest.coverage?.imagerySkeletonDependencies).equals(
      stableJson(expectedImageryDependencies),
    )
  )
    throw new Error(
      'Map streaming native imagery skeleton dependencies are invalid.',
    );
  const pinnedImagery = loadPinnedMapImageryTemplatesSync();
  const imageryTilesByLevel = new Map(
    IMAGERY_LEVELS.map((level) => [
      level,
      new Map(
        tileCoordinates(new Cesium.WebMercatorTilingScheme(), ROUTE, level).map(
          (tile) => [`${tile.level}/${tile.x}/${tile.y}`, tile],
        ),
      ),
    ]),
  );
  for (const tile of expectedImageryDependencies)
    imageryTilesByLevel
      .get(tile.level)
      ?.set(`${tile.level}/${tile.x}/${tile.y}`, tile);
  const expectedImageryRows = [];
  for (const level of IMAGERY_LEVELS)
    for (const tile of imageryTilesByLevel.get(level).values()) {
      const path = `imagery/${level}/${tile.x}/${tile.y}.png`;
      const bytes = createImageryTileBytes(tile, pinnedImagery);
      expectedImageryRows.push({
        path,
        kind: 'webmercator-imagery-png',
        identity: tile,
        byteLength: bytes.length,
        sha256: sha256(bytes),
      });
    }
  expectedImageryRows.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const actualImageryRows = fixture.manifest.assets
    .filter((row) => row.kind === 'webmercator-imagery-png')
    .map(({ path, kind, identity, byteLength, sha256: digestValue }) => ({
      path,
      kind,
      identity,
      byteLength,
      sha256: digestValue,
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  if (!stableJson(actualImageryRows).equals(stableJson(expectedImageryRows)))
    throw new Error(
      'Map streaming route and dependency imagery inventory is invalid.',
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
