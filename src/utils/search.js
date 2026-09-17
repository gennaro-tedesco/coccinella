export function buildMatcher(pattern, isRegex) {
  if (!pattern) return null;
  const source = isRegex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

export function findMatches(rows, columns, matcher) {
  if (!matcher) return [];
  const matches = [];
  rows.forEach((row, rowIndex) => {
    for (const column of columns) {
      const value = row[column];
      if (value != null && matcher.test(String(value))) {
        matches.push({ rowIndex, columnId: column });
      }
    }
  });
  return matches;
}
