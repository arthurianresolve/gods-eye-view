import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as Cesium from 'cesium';

export const IMPORTED_ENTITY_COUNT = 5_000;
export const EXTERNAL_ENTITY_COUNT = 100;
export const REMOVAL_PAIRS = 5;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const median = (values) => [...values].sort((a, b) => a - b)[2];

export function removeByIdsIndividually(collection, ids) {
  for (const id of ids) {
    const entity = collection.getById(id);
    if (entity) collection.remove(entity);
  }
}

export function removeOwnedByIdsBatched(collection, ids) {
  const values = collection.values;
  let allOwned = values.length === ids.size;
  if (allOwned) {
    for (const entity of values) {
      if (!ids.has(entity.id)) {
        allOwned = false;
        break;
      }
    }
  }
  if (allOwned) {
    collection.removeAll();
    return;
  }

  collection.suspendEvents();
  try {
    for (const id of ids) collection.removeById(id);
  } finally {
    collection.resumeEvents();
  }
}

function makeCollection(mode, trial) {
  const collection = new Cesium.EntityCollection();
  const ownedIds = new Set();
  for (let index = 0; index < IMPORTED_ENTITY_COUNT; index += 1) {
    const id = `gev-import:bench:${trial}:${index}`;
    ownedIds.add(id);
    collection.add({
      id,
      name: `Imported site ${index}`,
      position: Cesium.Cartesian3.fromDegrees(
        -120 + (index % 240) * 0.25,
        -50 + (index % 100) * 0.5,
      ),
      point: {
        pixelSize: 9,
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
      },
    });
  }
  const externalIds = new Set();
  if (mode === 'mixed') {
    for (let index = 0; index < EXTERNAL_ENTITY_COUNT; index += 1) {
      const id = `unrelated:${trial}:${index}`;
      externalIds.add(id);
      collection.add({
        id,
        name: `Unrelated ${index}`,
        position: Cesium.Cartesian3.fromDegrees(10, 20),
        point: { pixelSize: 4, color: Cesium.Color.YELLOW },
      });
    }
  }
  const events = { count: 0, removed: [] };
  collection.collectionChanged.addEventListener(
    (_collection, _added, removed) => {
      events.count += 1;
      for (const entity of removed) events.removed.push(entity.id);
    },
  );
  return { collection, ownedIds, externalIds, events };
}

function verify(mode, strategy, collection, ownedIds, externalIds, events) {
  const survivorIds = collection.values.map((entity) => entity.id).sort();
  const expectedSurvivors = [...externalIds].sort();
  const removedIds = [...events.removed].sort();
  const expectedRemovedIds = [...ownedIds].sort();
  assertExact(removedIds.length === ownedIds.size, 'wrong number of removals');
  assertExact(
    removedIds.every((id, index) => id === expectedRemovedIds[index]),
    'removed IDs differ from the owned import cohort',
  );
  assertExact(
    JSON.stringify(survivorIds) === JSON.stringify(expectedSurvivors),
    `${mode} survivor set changed`,
  );
  const expectedEvents = strategy === 'individual' ? ownedIds.size : 1;
  assertExact(events.count === expectedEvents, 'unexpected event count');
  return {
    removedCount: removedIds.length,
    removedIds,
    removedIdsSha256: sha256(Buffer.from(removedIds.join('\n'))),
    survivorIds,
    collectionChangedEvents: events.count,
  };
}

function assertExact(condition, message) {
  if (!condition) throw new Error(message);
}

function runRemoval(mode, strategy, index) {
  const { collection, ownedIds, externalIds, events } = makeCollection(
    mode,
    `${mode}:${index}`,
  );
  const started = performance.now();
  if (strategy === 'individual') removeByIdsIndividually(collection, ownedIds);
  else removeOwnedByIdsBatched(collection, ownedIds);
  const elapsedMs = performance.now() - started;
  const evidence = verify(
    mode,
    strategy,
    collection,
    ownedIds,
    externalIds,
    events,
  );
  return { elapsedMs, ...evidence };
}

function warm(mode) {
  runRemoval(mode, 'individual', 'warm-individual');
  runRemoval(mode, 'batched', 'warm-batched');
}

export function runEntityCollectionRemovalComparison({
  baseCommit,
  sourceSha256,
  harnessSha256,
} = {}) {
  const conditions = {};
  for (const mode of ['isolated', 'mixed']) {
    warm(mode);
    const pairs = [];
    for (let index = 0; index < REMOVAL_PAIRS; index += 1) {
      const order =
        index % 2 === 0 ? ['individual', 'batched'] : ['batched', 'individual'];
      const runs = {};
      for (const strategy of order)
        runs[strategy] = runRemoval(mode, strategy, index);
      pairs.push({ index, order, runs });
    }
    conditions[mode] = {
      importedEntityCount: IMPORTED_ENTITY_COUNT,
      externalEntityCount: mode === 'mixed' ? EXTERNAL_ENTITY_COUNT : 0,
      eventSemantics:
        'same exact removed ids and survivors; counts observed after setup',
      pairs,
      individualMedianMs: median(
        pairs.map((pair) => pair.runs.individual.elapsedMs),
      ),
      batchedMedianMs: median(pairs.map((pair) => pair.runs.batched.elapsedMs)),
      pairedChangePercent: pairs.map(
        (pair) =>
          (pair.runs.batched.elapsedMs / pair.runs.individual.elapsedMs - 1) *
          100,
      ),
    };
  }
  return {
    schema: 'gev-entity-collection-removal-comparison/v1',
    baseCommit: baseCommit || null,
    sourceSha256: sourceSha256 || null,
    harnessSha256: harnessSha256 || null,
    cesiumVersion: Cesium.VERSION,
    conditions,
    limits: {
      noBrowserOrFrameClaim: true,
      removeAllOnlyWhenAllCurrentEntitiesAreLayerOwned: true,
      mixedCollectionsSuspendAndResumeEvents: true,
      fiveAlternatingPairsAfterOneUnmeasuredWarmupPerSide: true,
    },
  };
}

const invoked =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  const outputPath = process.argv[2] ? resolve(process.argv[2]) : null;
  if (outputPath) {
    if (existsSync(outputPath))
      throw new Error('Refusing to overwrite report.');
    mkdirSync(dirname(outputPath), { recursive: true });
  }
  const runtimePath = 'src/imports/runtimeLayer.js';
  const harnessPath =
    'scripts/performance/entityCollectionRemovalComparison.mjs';
  const report = runEntityCollectionRemovalComparison({
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    sourceSha256: sha256(readFileSync(runtimePath)),
    harnessSha256: sha256(readFileSync(harnessPath)),
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) writeFileSync(outputPath, json, { flag: 'wx' });
  else process.stdout.write(json);
}
