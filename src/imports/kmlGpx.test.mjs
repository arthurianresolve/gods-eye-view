import assert from 'node:assert/strict';
import test from 'node:test';
import { previewGPX, previewKML } from './kmlGpx.js';

test('KML stages namespaced points, lines and closed polygons with explicit time', async () => {
  const xml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
    <Placemark><name>Point &amp; site</name><TimeStamp><when>2026-02-03T04:05:00Z</when></TimeStamp><Point><coordinates>179,10,12</coordinates></Point></Placemark>
    <Placemark><name>Route</name><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark>
    <Placemark><name>Area</name><Polygon><outerBoundaryIs><LinearRing><coordinates>0,0 1,0 1,1 0,0</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs><LinearRing><coordinates>0.2,0.2 0.4,0.2 0.4,0.4 0.2,0.2</coordinates></LinearRing></innerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Altitude example</name><Point><altitudeMode>absolute</altitudeMode><coordinates>2,2,100</coordinates></Point></Placemark>
  </Document></kml>`;
  const preview = await previewKML(xml, { attribution: 'Survey' });
  assert.equal(preview.accepted, 4);
  assert.equal(preview.records[0].properties.name, 'Point & site');
  assert.equal(preview.records[0].timeMs, Date.parse('2026-02-03T04:05:00Z'));
  assert.deepEqual(preview.records[0].geometry.coordinates, [179, 10, 12]);
  assert.deepEqual(preview.records[1].geometry.coordinates, [
    [0, 0],
    [1, 1],
  ]);
  assert.equal(
    preview.records[2].geometry.coordinates.length,
    2,
    'polygon holes survive the import',
  );
  assert.match(preview.warnings[0], /does not reproduce that mode/);
  assert.deepEqual(preview.bounds, [0, 0, 179, 10]);
});

test('GPX stages waypoint, route, and track times; untimed points stay unknown', async () => {
  const xml = `<gpx version="1.1"><wpt lat="10" lon="179"><name>Harbor</name></wpt>
    <rte><name>Route A</name><rtept lat="0" lon="0"><time>2026-03-01T00:00:00+00:00</time></rtept><rtept lat="1" lon="1" /></rte>
    <trk><name>Track A</name><trkseg><trkpt lat="2" lon="2"><time>2026-03-01T01:00:00Z</time></trkpt><trkpt lat="3" lon="3" /></trkseg></trk></gpx>`;
  const preview = await previewGPX(xml);
  assert.equal(preview.accepted, 3);
  assert.equal(preview.records[0].timeMs, null);
  assert.equal(preview.records[1].timeMs, Date.parse('2026-03-01T00:00:00Z'));
  assert.equal(preview.records[2].properties.times[1], null);
});

test('XML adapters reject DTDs, remote network links, scripts, bad XML and ambiguous time', async () => {
  await assert.rejects(
    previewKML('<!DOCTYPE kml [<!ENTITY x SYSTEM "file:///secret">]><kml/>'),
    /DTD/,
  );
  await assert.rejects(
    previewKML(
      '<kml><NetworkLink><Link><href>https://example.com/x.kml</href></Link></NetworkLink></kml>',
    ),
    /Network links/,
  );
  await assert.rejects(
    previewGPX('<gpx><script>alert(1)</script></gpx>'),
    /script/,
  );
  const ambiguous = await previewGPX(
    '<gpx><wpt lat="1" lon="2"><time>01/02/2026</time></wpt></gpx>',
  );
  assert.equal(ambiguous.accepted, 0);
  assert.match(ambiguous.rejectedRows[0].reason, /UTC offset/);
  await assert.rejects(previewKML('<kml><Placemark></kml>'), /nested/);
});
