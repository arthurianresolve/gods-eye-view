/** Keep byte-for-byte inputs aligned with the Node attribution fixture 99af2af3. */
export function createImportInputComparisonFixtures() {
  return [
    {
      kind: 'csv',
      count: 50_000,
      firstId: '0',
      lastId: '49999',
      text:
        'id,latitude,longitude,label\r\n' +
        Array.from(
          { length: 50_000 },
          (_, index) =>
            `${index},30.2,-97.7,"Public reference ${index}, fixed"`,
        ).join('\r\n'),
    },
    {
      kind: 'geojson',
      count: 25_000,
      firstId: '0',
      lastId: '24999',
      text: JSON.stringify({
        type: 'FeatureCollection',
        features: Array.from({ length: 25_000 }, (_, index) => ({
          type: 'Feature',
          id: String(index),
          properties: { label: `Public reference ${index}, fixed` },
          geometry: { type: 'Point', coordinates: [-97.7, 30.2] },
        })),
      }),
    },
  ];
}
