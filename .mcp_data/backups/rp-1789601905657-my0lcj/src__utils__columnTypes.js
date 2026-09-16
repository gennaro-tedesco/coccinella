// Defines supported column types and the rules used to infer and compare them.
// Inference preserves raw CSV values so users can still override ambiguous types.
export const COLUMN_TYPES = ["string", "number", "date", "boolean", "category"];

const DECIMAL_PATTERN =
  /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}(?:[T\s].*)?$/;

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() === "true";
}

function isNumber(value) {
  const text = String(value).trim();
  return DECIMAL_PATTERN.test(text) && Number.isFinite(Number(text));
}

function isDate(value) {
  const text = String(value).trim();
  return DATE_PATTERN.test(text) && !Number.isNaN(new Date(text).getTime());
}

function inferColumnType(values) {
  const populated = values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (populated.length === 0) return "string";
  if (populated.every((value) => /^(?:true|false)$/i.test(value))) {
    return "boolean";
  }
  if (populated.every(isNumber)) return "number";
  if (populated.every(isDate)) return "date";

  const uniqueCount = new Set(populated).size;
  if (uniqueCount <= 20 && uniqueCount / populated.length <= 0.5) {
    return "category";
  }
  return "string";
}

export function inferColumnTypes(columns, rows) {
  return Object.fromEntries(
    columns.map((column) => [
      column,
      inferColumnType(rows.map((row) => row[column])),
    ]),
  );
}

export function compareByType(type, a, b) {
  switch (type) {
    case "number":
      return Number(a) - Number(b);
    case "date":
      return new Date(a).getTime() - new Date(b).getTime();
    case "boolean":
      return Number(toBoolean(a)) - Number(toBoolean(b));
    case "category":
    case "string":
    default:
      return String(a).localeCompare(String(b));
  }
}
