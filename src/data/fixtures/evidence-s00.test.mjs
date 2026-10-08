import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('S00 synthetic evidence fixture has fixed, credential-free replay inputs', async () => {
  const fixture = JSON.parse(
    await readFile(new URL('./evidence-s00.json', import.meta.url), 'utf8'),
  );
  assert.equal(fixture.schema, 'gev-fixture/evidence-s00-v1');
  assert.equal(fixture.aircraft.completeness, 'partial');
  assert.equal(fixture.aircraft.records[0].id, fixture.aircraft.records[1].id);
  assert.equal(
    fixture.aircraft.records[0].positionTimeMs,
    fixture.aircraft.records[1].positionTimeMs,
  );
  assert.ok(
    fixture.aircraft.records[2].positionTimeMs <
      fixture.aircraft.records[0].positionTimeMs,
  );
  assert.equal(fixture.aircraft.records[3].positionTimeMs, null);
  assert.deepEqual(
    fixture.weather.frames
      .filter((frame) => !frame.available)
      .map((frame) => frame.reason),
    ['fixture gap'],
  );
  assert.equal(JSON.stringify(fixture).includes('token'), false);
});
