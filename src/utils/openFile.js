import { invoke } from "@tauri-apps/api/core";

function addOpenedSheet(opened, openSheet) {
  openSheet(opened.filename, opened.metadata, opened.path);
}

export async function openCsvFileAtPath(candidate, openSheet, separator) {
  const opened = await invoke("load_indexed_csv_file", {
    token: candidate.token,
    separator: separator || ",",
  });
  addOpenedSheet(opened, openSheet);
}

export async function rescanCsvFile(datasetId, separator) {
  return invoke("rescan_csv_file", { datasetId, separator });
}

export async function openCsvFile(openSheet) {
  const opened = await invoke("open_csv_dialog", {
    separator: ",",
  });
  if (opened) addOpenedSheet(opened, openSheet);
}
