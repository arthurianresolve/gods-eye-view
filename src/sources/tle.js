/**
 * Parse named TLE records without assuming every source record is complete.
 * A malformed or truncated record is skipped while scanning continues for the
 * next line 1, so one missing line cannot desynchronize the rest of a catalog.
 */
export function parseTleText(text) {
  const lines = String(text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const result = [];
  let name = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('2 ')) {
      // Ignore an orphan line 2 and any name that preceded it.
      name = null;
      continue;
    }
    if (line.startsWith('1 ')) {
      const line2 = lines[i + 1];
      if (line2?.startsWith('2 ')) {
        const normalizedName = name?.startsWith('0 ')
          ? name.slice(2).trim()
          : name;
        result.push({ name: normalizedName || 'UNKNOWN', line1: line, line2 });
        i++;
      }
      // Do not consume a following name or line 1 when this set is truncated.
      name = null;
      continue;
    }
    name = line;
  }
  return result;
}

const ALPHA5_PREFIXES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Decode a five-character NORAD/Alpha-5 catalog field, or return null. */
export function decodeTleCatalogNumber(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const raw = String(value ?? '').trim();
  // Some callers already hold a decoded NORAD number rather than the
  // five-character TLE field (for example a numeric satrec.satnum).
  if (/^\d{6}$/.test(raw) && Number(raw) <= 339_999) return Number(raw);
  const field = raw.slice(-5);
  if (/^\d{5}$/.test(field)) return Number(field);
  const match = /^([A-HJ-NP-Z])(\d{4})$/.exec(field);
  if (!match) return null;
  const prefixIndex = ALPHA5_PREFIXES.indexOf(match[1]);
  if (prefixIndex < 0) return null;
  return (prefixIndex + 10) * 10_000 + Number(match[2]);
}

/** The NORAD catalog number from TLE line 1, or null. */
export function tleCatalogNumber(line1) {
  const line = String(line1 ?? '').trim();
  return decodeTleCatalogNumber(
    line.startsWith('1 ') ? line.slice(2, 7) : line,
  );
}
