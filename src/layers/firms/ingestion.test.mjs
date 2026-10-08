import assert from 'node:assert/strict';
import test from 'node:test';
import { createIngestion } from './ingestion.js';

test('a missing historical fire window clears live records instead of showing Latest', async () => {
  const targetMs = 1_800_000_000_000;
  const liveFire = { index: 1, lat: 1, lon: 2, acqMs: targetMs - 1 };
  const layerState = {
    _dataSource: {},
    _enabled: true,
    _destroyed: false,
    _loading: false,
    _fires: [liveFire],
    _firesByFrp: [liveFire],
    _selectedFire: liveFire,
    _cellCacheByGrid: new Map([[1, []]]),
    _count: 1,
    _missingSources: [],
    _historyLoadedTargetMs: null,
    _historyStatus: 'loading',
    _historyEffectiveTime: targetMs,
    request: null,
  };
  let latestCalls = 0;
  const ingestion = createIngestion({
    layerState,
    services: {
      context: {
        clearSelectedEntityContextForLayer() {},
      },
    },
    components: {
      model: { formatFrp: String },
      selection: { clearFireSelection() {} },
      rendering: { renderCurrentLod() {} },
    },
    config: { id: 'firms' },
    feed: {
      async getSnapshot() {
        latestCalls++;
        return { fires: [liveFire] };
      },
      async getSnapshotAt() {
        throw new Error('provider history unavailable');
      },
    },
  });

  await ingestion.loadHeatmap(targetMs);
  assert.equal(latestCalls, 0);
  assert.deepEqual(layerState._fires, []);
  assert.deepEqual(layerState._firesByFrp, []);
  assert.equal(layerState._count, 0);
  assert.equal(layerState._historyStatus, 'unavailable');
  assert.equal(layerState._historyLoadedTargetMs, targetMs);
});
