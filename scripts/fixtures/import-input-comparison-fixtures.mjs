/** Keep byte-for-byte inputs aligned with the Node attribution fixture 99af2af3. */
export const IMPORT_INPUT_COMPARISON_FIXTURE_SHA256 = Object.freeze({
  csv: '08fd9f3332affc16a600018b7648b0a90c5b8dbcb29758a16e3864200b089e5d',
  geojson: '8c2077a1ab3d030c4327558cb66a2bc58bffd01e08642310a9fa480e25a1f756',
});

function readPageState(documentRef) {
  return {
    visibilityState: documentRef.visibilityState,
    hasFocus: documentRef.hasFocus(),
    osOcclusionChecked: false,
  };
}

/** Observe only DOM visibility/focus; this does not detect OS-level occlusion. */
export function createImportComparisonPageStateTracker(
  documentRef = document,
  windowRef = window,
) {
  const events = { visibilityChange: 0, blur: 0, focus: 0 };
  let becameHidden = documentRef.visibilityState === 'hidden';
  let lostFocus = !documentRef.hasFocus();
  const start = readPageState(documentRef);
  const onVisibilityChange = () => {
    events.visibilityChange++;
    if (documentRef.visibilityState === 'hidden') becameHidden = true;
  };
  const onBlur = () => {
    events.blur++;
    lostFocus = true;
  };
  const onFocus = () => events.focus++;
  documentRef.addEventListener('visibilitychange', onVisibilityChange);
  windowRef.addEventListener('blur', onBlur);
  windowRef.addEventListener('focus', onFocus);
  let finished = false;

  return {
    start,
    finish() {
      if (finished) throw new Error('Page-state tracker was already finished.');
      finished = true;
      documentRef.removeEventListener('visibilitychange', onVisibilityChange);
      windowRef.removeEventListener('blur', onBlur);
      windowRef.removeEventListener('focus', onFocus);
      const end = readPageState(documentRef);
      if (end.visibilityState === 'hidden') becameHidden = true;
      if (!end.hasFocus) lostFocus = true;
      return {
        start,
        end,
        events,
        becameHidden,
        lostFocus,
        valid:
          start.visibilityState === 'visible' &&
          start.hasFocus &&
          end.visibilityState === 'visible' &&
          end.hasFocus &&
          !becameHidden &&
          !lostFocus,
        scope: 'DOM visibility/focus only; OS occlusion is not checked.',
      };
    },
  };
}

/** Keep the pair and each completed arm available if a later arm fails. */
export async function runAndRecordImportComparisonPair({
  pairs,
  trial,
  order,
  runArm,
  synchronousMode,
  alternateMode,
}) {
  const pair = { trial, order, status: 'running' };
  pairs.push(pair);
  try {
    for (const mode of order) pair[mode] = await runArm(mode);
    pair.equal =
      pair[synchronousMode].resultSha256 === pair[alternateMode].resultSha256;
    pair.status = pair.equal ? 'passed' : 'failed';
    return pair;
  } catch (error) {
    pair.status = 'failed';
    throw error;
  }
}

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
