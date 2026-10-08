import {
  IMPORT_LIMITS,
  createImportPreview,
  decodeImportText,
  parseImportInstant,
} from './geojsonCsv.js';

const MAX_XML_NODES = 50_000;
const MAX_XML_DEPTH = 32;

function xmlFail(message) {
  throw Object.assign(new Error(message), { code: 'invalid-xml' });
}

function entities(text) {
  const supported = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
  if (text.replace(supported, '').includes('&'))
    xmlFail('XML contains an unsupported entity reference.');
  return text.replace(supported, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity[0] !== '#') return named[entity.toLowerCase()];
    const numeric =
      entity[1].toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
    if (
      !Number.isSafeInteger(numeric) ||
      numeric < 0 ||
      numeric > 0x10ffff ||
      (numeric >= 0xd800 && numeric <= 0xdfff)
    )
      xmlFail('XML contains an invalid character reference.');
    return String.fromCodePoint(numeric);
  });
}

function tagEnd(source, start) {
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return -1;
}

function attributes(source) {
  const result = {};
  let rest = source.trim();
  while (rest) {
    const match = /^([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(
      rest,
    );
    if (!match) xmlFail('XML has a malformed attribute.');
    if (Object.hasOwn(result, match[1]))
      xmlFail('XML has a duplicate attribute.');
    result[match[1]] = entities(match[2] ?? match[3]);
    rest = rest.slice(match[0].length);
  }
  return result;
}

/** Parse a restricted XML tree. DTDs, entities, scripts and remote links never execute. */
function parseSafeXML(input) {
  const source = decodeImportText(input);
  if (/<!DOCTYPE|<!ENTITY|<\s*script\b/i.test(source))
    xmlFail('DTD, custom entities and script elements are unsupported.');
  const root = {
    name: '#document',
    local: '#document',
    attrs: {},
    children: [],
    text: '',
  };
  const stack = [root];
  let index = 0;
  let nodes = 0;
  while (index < source.length) {
    const open = source.indexOf('<', index);
    const rawText = source.slice(index, open < 0 ? source.length : open);
    if (rawText) {
      if (stack.length === 1 && rawText.trim())
        xmlFail('XML contains text outside the root element.');
      if (stack.length > 1) stack.at(-1).text += entities(rawText);
    }
    if (open < 0) break;
    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      if (end < 0) xmlFail('XML has an unclosed comment.');
      index = end + 3;
      continue;
    }
    if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open + 9);
      if (end < 0) xmlFail('XML has an unclosed CDATA section.');
      stack.at(-1).text += source.slice(open + 9, end);
      index = end + 3;
      continue;
    }
    if (source.startsWith('<?', open)) {
      const end = source.indexOf('?>', open + 2);
      if (end < 0 || !/^<\?xml\s/i.test(source.slice(open, end + 2)))
        xmlFail('XML processing instructions are unsupported.');
      index = end + 2;
      continue;
    }
    if (source.startsWith('<!', open))
      xmlFail('XML declarations are unsupported.');
    const end = tagEnd(source, open + 1);
    if (end < 0) xmlFail('XML has an unclosed tag.');
    const raw = source.slice(open, end + 1);
    const closing = /^<\/([A-Za-z_:][\w:.-]*)\s*>$/.exec(raw);
    if (closing) {
      if (stack.length <= 1 || stack.at(-1).name !== closing[1])
        xmlFail('XML tags are not properly nested.');
      stack.pop();
      index = end + 1;
      continue;
    }
    const opening = /^<([A-Za-z_:][\w:.-]*)([\s\S]*?)>$/.exec(raw);
    if (!opening) xmlFail('XML tag name is invalid.');
    const selfClosing = /\/\s*>$/.test(raw);
    let attrsSource = opening[2].trim();
    if (selfClosing) attrsSource = attrsSource.replace(/\/\s*$/, '').trim();
    const node = {
      name: opening[1],
      local: opening[1].split(':').at(-1).toLowerCase(),
      attrs: attributes(attrsSource),
      children: [],
      text: '',
    };
    for (const [name, value] of Object.entries(node.attrs)) {
      if (
        ['href', 'src'].includes(name.split(':').at(-1).toLowerCase()) &&
        /^(?:https?:|file:|\/\/)/i.test(value)
      )
        xmlFail('Remote resources are not loaded by geographic imports.');
    }
    if (node.local === 'networklink' || node.local === 'script')
      xmlFail('Network links and scripts are unsupported.');
    if (++nodes > MAX_XML_NODES) xmlFail('XML has too many elements.');
    if (stack.length >= MAX_XML_DEPTH)
      xmlFail('XML nesting exceeds the supported limit.');
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
    index = end + 1;
  }
  if (stack.length !== 1 || root.children.length !== 1)
    xmlFail('XML document is incomplete or has multiple roots.');
  return root.children[0];
}

const children = (node, name) =>
  node.children.filter((item) => item.local === name);
const descendants = (node, name, output = []) => {
  for (const child of node.children) {
    if (child.local === name) output.push(child);
    descendants(child, name, output);
  }
  return output;
};
const textOf = (node, name) => descendants(node, name)[0]?.text.trim() || '';

function coordinate(token) {
  const parts = token.split(',');
  if (parts.length < 2 || parts.length > 3)
    throw new Error('Coordinate must be longitude,latitude[,elevation].');
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (
    !Number.isFinite(lon) ||
    Math.abs(lon) > 180 ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90
  )
    throw new Error('Coordinate is outside WGS84 longitude/latitude bounds.');
  const point = [lon, lat];
  if (parts.length === 3 && parts[2] !== '') {
    const elevation = Number(parts[2]);
    if (
      !Number.isFinite(elevation) ||
      elevation < -12_000 ||
      elevation > 1_000_000
    )
      throw new Error('Elevation is outside the supported range.');
    point.push(elevation);
  }
  return point;
}

function timed(feature, text) {
  if (!text) return { ...feature, timeMs: null };
  const timeMs = parseImportInstant(text);
  if (timeMs === 'ambiguous')
    throw new Error('Timestamp must include an explicit UTC offset.');
  return { ...feature, timeMs };
}

function kmlGeometry(placemark) {
  const point = descendants(placemark, 'point')[0];
  if (point)
    return {
      type: 'Point',
      coordinates: coordinate(textOf(point, 'coordinates')),
    };
  const line = descendants(placemark, 'linestring')[0];
  if (line) {
    const coordinates = textOf(line, 'coordinates')
      .split(/\s+/)
      .filter(Boolean)
      .map(coordinate);
    if (coordinates.length < 2)
      throw new Error('LineString needs at least two positions.');
    return { type: 'LineString', coordinates };
  }
  const polygon = descendants(placemark, 'polygon')[0];
  if (polygon) {
    const outer = descendants(polygon, 'outerboundaryis')[0];
    const coords = outer && descendants(outer, 'coordinates')[0]?.text.trim();
    const ring = coords?.split(/\s+/).filter(Boolean).map(coordinate) || [];
    if (
      ring.length < 4 ||
      ring[0].some((value, index) => value !== ring.at(-1)[index])
    )
      throw new Error(
        'Polygon outer ring must be closed and contain four positions.',
      );
    const rings = [ring];
    for (const inner of descendants(polygon, 'innerboundaryis')) {
      const innerCoordinateText = descendants(
        inner,
        'coordinates',
      )[0]?.text.trim();
      const innerRing =
        innerCoordinateText?.split(/\s+/).filter(Boolean).map(coordinate) || [];
      if (
        innerRing.length < 4 ||
        innerRing[0].some((value, index) => value !== innerRing.at(-1)[index])
      )
        throw new Error(
          'Polygon inner rings must be closed and contain four positions.',
        );
      rings.push(innerRing);
    }
    return { type: 'Polygon', coordinates: rings };
  }
  throw new Error(
    'Placemark has no supported Point, LineString or Polygon geometry.',
  );
}

/** Stage the documented KML subset without fetching links or network resources. */
export async function previewKML(input, { signal, attribution = '' } = {}) {
  const root = parseSafeXML(input);
  if (root.local !== 'kml') xmlFail('Expected a KML root element.');
  const placemarks = descendants(root, 'placemark');
  if (placemarks.length > IMPORT_LIMITS.rows)
    xmlFail('KML is limited to 50,000 placemarks.');
  const records = [];
  const rejected = [];
  for (let i = 0; i < placemarks.length; i++) {
    signal?.throwIfAborted();
    try {
      const placemark = placemarks[i];
      const geometry = kmlGeometry(placemark);
      const timeText = textOf(placemark, 'when') || textOf(placemark, 'begin');
      records.push(
        timed(
          {
            id: textOf(placemark, 'name') || `placemark-${i + 1}`,
            geometry,
            properties: {
              name: textOf(placemark, 'name'),
              description: textOf(placemark, 'description').slice(0, 500),
              altitudeMode: textOf(placemark, 'altitudemode') || 'unspecified',
            },
          },
          timeText,
        ),
      );
    } catch (error) {
      rejected.push({
        row: i + 1,
        reason: String(error.message || error).slice(0, 180),
      });
    }
    if (i % 256 === 255) await Promise.resolve();
  }
  const altitudeModes = new Set(
    records
      .map((record) => record.properties.altitudeMode)
      .filter((mode) => mode !== 'unspecified' && mode !== 'clampToGround'),
  );
  return createImportPreview({
    kind: 'kml',
    records,
    rejected,
    attribution,
    timeField: placemarks.some(
      (node) => textOf(node, 'when') || textOf(node, 'begin'),
    )
      ? 'TimeStamp/TimeSpan'
      : null,
    warnings: altitudeModes.size
      ? [
          `KML altitude mode ${[...altitudeModes].join(', ')} is retained as metadata; rendering does not reproduce that mode.`,
        ]
      : [],
  });
}

function gpxPoint(node) {
  const lat = Number(node.attrs.lat);
  const lon = Number(node.attrs.lon);
  if (
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    !Number.isFinite(lon) ||
    Math.abs(lon) > 180
  )
    throw new Error('GPX point needs valid WGS84 lat/lon attributes.');
  const point = [lon, lat];
  const elevation = Number(textOf(node, 'ele'));
  if (
    Number.isFinite(elevation) &&
    elevation >= -12_000 &&
    elevation <= 1_000_000
  )
    point.push(elevation);
  const time = textOf(node, 'time');
  return { point, time };
}

function gpxLine(points) {
  const normalized = points.map(gpxPoint);
  if (normalized.length < 2)
    throw new Error('Route or track segment needs two points.');
  return {
    geometry: {
      type: 'LineString',
      coordinates: normalized.map(({ point }) => point),
    },
    times: normalized.map(({ time }) =>
      time ? parseImportInstant(time) : null,
    ),
  };
}

/** Stage GPX waypoints, routes and track segments; missing point times remain unknown. */
export async function previewGPX(input, { signal, attribution = '' } = {}) {
  const root = parseSafeXML(input);
  if (root.local !== 'gpx') xmlFail('Expected a GPX root element.');
  const records = [];
  const rejected = [];
  const add = (id, feature, properties, row) => {
    try {
      const times = feature.times || [];
      if (times.some((time) => time === 'ambiguous'))
        throw new Error('Timestamp must include an explicit UTC offset.');
      records.push({
        id,
        geometry: feature.geometry,
        properties: { ...properties, times },
        timeMs: times.find(Number.isSafeInteger) ?? null,
      });
    } catch (error) {
      rejected.push({
        row,
        reason: String(error.message || error).slice(0, 180),
      });
    }
  };
  let row = 0;
  for (const waypoint of children(root, 'wpt')) {
    signal?.throwIfAborted();
    row++;
    try {
      const { point, time } = gpxPoint(waypoint);
      const timeMs = time ? parseImportInstant(time) : null;
      if (timeMs === 'ambiguous')
        throw new Error('Timestamp must include an explicit UTC offset.');
      records.push({
        id: textOf(waypoint, 'name') || `waypoint-${row}`,
        geometry: { type: 'Point', coordinates: point },
        properties: {
          name: textOf(waypoint, 'name'),
          description: textOf(waypoint, 'desc'),
        },
        timeMs,
      });
    } catch (error) {
      rejected.push({
        row,
        reason: String(error.message || error).slice(0, 180),
      });
    }
  }
  for (const route of children(root, 'rte')) {
    signal?.throwIfAborted();
    row++;
    try {
      add(
        textOf(route, 'name') || `route-${row}`,
        gpxLine(children(route, 'rtept')),
        { name: textOf(route, 'name'), type: 'route' },
        row,
      );
    } catch (error) {
      rejected.push({
        row,
        reason: String(error.message || error).slice(0, 180),
      });
    }
  }
  for (const track of children(root, 'trk')) {
    const segments = descendants(track, 'trkseg');
    for (let index = 0; index < segments.length; index++) {
      signal?.throwIfAborted();
      row++;
      try {
        add(
          `${textOf(track, 'name') || `track-${row}`}-segment-${index + 1}`,
          gpxLine(children(segments[index], 'trkpt')),
          { name: textOf(track, 'name'), type: 'track' },
          row,
        );
      } catch (error) {
        rejected.push({
          row,
          reason: String(error.message || error).slice(0, 180),
        });
      }
    }
  }
  if (records.length + rejected.length > IMPORT_LIMITS.rows)
    xmlFail('GPX is limited to 50,000 features.');
  return createImportPreview({
    kind: 'gpx',
    records,
    rejected,
    attribution,
    timeField: records.some((record) =>
      record.properties.times?.some(Number.isSafeInteger),
    )
      ? 'GPX point time'
      : null,
  });
}
