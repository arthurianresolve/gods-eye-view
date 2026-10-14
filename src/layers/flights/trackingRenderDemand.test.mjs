import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracking } from './tracking.js';

test('military suppression reconciles the civil owner after deleting its last visuals', () => {
  const removed = [];
  const reconciliations = [];
  const militaryBillboard = { id: 'mil-1' };
  const flightState = {
    _viewer: {},
    _billboardCollection: {
      show: true,
      remove(billboard) {
        removed.push(billboard);
      },
    },
    _billboards: new Map([['mil-1', militaryBillboard]]),
    _trackedIcao: null,
    _models: new Set(),
    _cullPositions: new Map([['mil-1', {}]]),
    _positionHistory: new Map([['mil-1', []]]),
    _displayCourse: new Map([['mil-1', 0]]),
    _groundSnap: { forget() {} },
    records: {
      data: new Map([['mil-1', {}]]),
      missingPolls: new Map([['mil-1', 1]]),
    },
    feed: { _count: 1 },
  };
  const parts = {
    lifecycle: {
      syncRenderDemand() {
        reconciliations.push(
          flightState._billboards.size > 0 || flightState._models.size > 0,
        );
      },
    },
    rendering: {
      _releaseModel(id) {
        flightState._models.delete(id);
      },
    },
  };
  const services = {
    context: {
      selectTrackedSubjectContext() {},
      clearTrackedSubjectContext() {},
      refreshTrackedSubjectContext() {},
    },
    aircraftPresentation: {
      isTr3b() {},
      tr3bTypeLabel() {},
      tr3bConvertedIds: new Set(),
    },
    trails: { createTrail() {} },
    geoid: { ensureGeoidReady() {}, geoidHeight() {} },
    groundFloor: {
      resolveGroundFloorCellsBounded() {},
      floorAltitudeM() {},
      cachedGroundFloor() {},
    },
    focus: { clearFocusTarget() {} },
    militaryRegistry: {
      isMilitaryLayerActive() {},
      isMilitaryIcao: (id) => id === 'mil-1',
    },
    readout: { trackedLabelModelFromText() {}, refreshTrackedReadout() {} },
    camera: { applyTrackedCameraFrame() {} },
    picking: { resolvePickId() {}, isOwnedByOtherLayer() {} },
  };

  const tracking = createTracking({ flightState, services, parts, layer: {} });
  tracking._onMilitaryActiveChange(true);

  assert.deepEqual(removed, [militaryBillboard]);
  assert.equal(flightState._billboards.size, 0);
  assert.equal(flightState._models.size, 0);
  assert.equal(flightState.feed._count, 0);
  assert.deepEqual(reconciliations, [false]);
});
