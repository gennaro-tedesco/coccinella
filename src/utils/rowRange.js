const OVERSCAN_VIEWPORTS = 4;
const REFRESH_VIEWPORTS = 2;

export function calculateRowRange({
  scrollTop,
  viewportHeight,
  rowHeight,
  rowCount,
  currentRange,
}) {
  if (rowCount === 0) return { offset: 0, limit: 0 };

  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const visibleStart = Math.min(
    rowCount - 1,
    Math.max(0, Math.floor(scrollTop / rowHeight)),
  );
  const visibleEnd = Math.min(rowCount, visibleStart + visibleCount);
  const refreshRows = visibleCount * REFRESH_VIEWPORTS;
  const requiredStart = Math.max(0, visibleStart - refreshRows);
  const requiredEnd = Math.min(rowCount, visibleEnd + refreshRows);
  const currentEnd = currentRange.offset + currentRange.limit;

  if (
    currentRange.limit > 0 &&
    currentRange.offset <= requiredStart &&
    currentEnd >= requiredEnd
  ) {
    return currentRange;
  }

  const overscanRows = visibleCount * OVERSCAN_VIEWPORTS;
  const offset = Math.max(0, visibleStart - overscanRows);
  const end = Math.min(rowCount, visibleEnd + overscanRows);
  return { offset, limit: end - offset };
}

export function parseRowSelectionRange(value, rowCount) {
  const match = value.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || start > end || end > rowCount) return null;
  return { start: start - 1, end: end - 1 };
}
