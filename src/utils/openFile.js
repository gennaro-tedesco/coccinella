import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { parseCsv } from "./csv";

export async function openCsvFileAtPath(path, openSheet, separator) {
  const text = await invoke("read_csv_file", { path });
  const { columns, rows } = parseCsv(text, separator);
  const filename = path.split(/[\\/]/).pop();
  const sizeBytes = new TextEncoder().encode(text).length;
  openSheet(filename, columns, rows, sizeBytes, path, separator || ",");
}

export async function rescanCsvFile(path, separator) {
  const text = await invoke("read_csv_file", { path });
  const { columns, rows } = parseCsv(text, separator);
  const sizeBytes = new TextEncoder().encode(text).length;
  return { columns, rows, sizeBytes };
}

export async function openCsvFile(openSheet) {
  const path = await open({
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return;

  await openCsvFileAtPath(path, openSheet);
}
