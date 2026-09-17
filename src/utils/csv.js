import Papa from "papaparse";

export function parseCsv(text, delimiter) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: delimiter || ",",
  });
  return {
    columns: result.meta.fields ?? [],
    rows: result.data,
  };
}
