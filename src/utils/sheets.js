// Provides traversal helpers for the normalized sheet hierarchy.
// FEATURE: CSV data workspace
export function rootSheetId(sheets, id) {
  let rootId = id;
  while (sheets[rootId]?.filterOf) rootId = sheets[rootId].filterOf.sourceId;
  return rootId;
}

export function descendantSheetIds(sheets, id) {
  const descendants = [];
  const pending = [...(sheets[id]?.children ?? [])];
  while (pending.length > 0) {
    const childId = pending.pop();
    descendants.push(childId);
    pending.push(...(sheets[childId]?.children ?? []));
  }
  return descendants;
}
