import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

export async function openCsvFileAtPath(path, openSheet, separator) {
  const metadata = await invoke("load_csv_file", {
    path,
    separator: separator || ",",
  });
  const filename = path.split(/[\\/]/).pop();
  openSheet(filename, metadata, path);
}

export async function rescanCsvFile(datasetId, path, separator) {
  return invoke("rescan_csv_file", { datasetId, path, separator });
}

export async function openCsvFile(openSheet) {
  const path = await open({
    multiple: false,
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return;

  await openCsvFileAtPath(path, openSheet);
}
