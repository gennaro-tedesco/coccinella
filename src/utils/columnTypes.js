// Defines the column types supported by the UI and Rust data engine.
// FEATURE: CSV data workspace
export const COLUMN_TYPES = [
  "string",
  "uuid",
  "number",
  "date",
  "boolean",
  "category",
];

export const DEFAULT_DATE_FORMAT = "auto";

export const DATE_FORMATS = [
  { value: DEFAULT_DATE_FORMAT, label: "Auto" },
  { value: "unix", label: "Unix timestamp" },
  { value: "timestamp", label: "YYYY-MM-DD HH:mm:ss.SSS" },
  { value: "ymd", label: "YYYY-MM-DD" },
  { value: "dmy", label: "DD/MM/YYYY" },
];
