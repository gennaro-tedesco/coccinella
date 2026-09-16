export const COLUMN_TYPES = ["string", "number", "date", "boolean", "category"];

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() === "true";
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
