import { DEFAULT_COLUMN_PRECISION } from "../constants.js";

export function formatNumberValue(value, precision) {
  const number = Number(value);
  const decimalPlaces =
    precision ?? (Number.isInteger(number) ? 0 : DEFAULT_COLUMN_PRECISION);
  return number.toFixed(decimalPlaces);
}
