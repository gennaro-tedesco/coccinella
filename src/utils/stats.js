import { BYTES_PER_UNIT, BYTE_DISPLAY_PRECISION } from "../constants";

export function formatBytes(bytes) {
  if (bytes < BYTES_PER_UNIT) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / BYTES_PER_UNIT;
  let unitIndex = 0;
  while (value >= BYTES_PER_UNIT && unitIndex < units.length - 1) {
    value /= BYTES_PER_UNIT;
    unitIndex += 1;
  }
  return `${value.toFixed(BYTE_DISPLAY_PRECISION)} ${units[unitIndex]}`;
}
