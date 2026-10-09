/**
 * Select the existing render cohort without cloning the entire stored dataset.
 * Workspace storage retains all records; this only prepares the bounded view.
 */
export function selectImportRenderRecords(imports, limit) {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const selected = [];
  let total = 0;
  for (const source of Array.isArray(imports) ? imports : []) {
    if (!Array.isArray(source?.records)) continue;
    total += source.records.length;
    const take = Math.min(source.records.length, cap - selected.length);
    for (let i = 0; i < take; i++)
      selected.push({ record: source.records[i], source });
  }
  return { selected, total };
}
