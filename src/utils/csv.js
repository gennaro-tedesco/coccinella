import Papa from "papaparse";

export function parseCsv(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  });
  return {
    columns: result.meta.fields ?? [],
    rows: result.data,
  };
}
