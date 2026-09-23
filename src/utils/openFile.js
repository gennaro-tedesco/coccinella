import { invoke } from "@tauri-apps/api/core";

function addOpenedFile(opened, openSheet, openJson) {
  if (opened.kind === "json") {
    openJson(opened.filename, opened.id, opened.data, opened.sizeBytes, opened.path);
    return;
  }
  openSheet(opened.filename, opened.metadata, opened.path);
}

export async function openFileAtPath(candidate, openSheet, openJson, separator) {
  const opened = await invoke("load_indexed_file", {
    token: candidate.token,
    separator: separator || ",",
  });
  addOpenedFile(opened, openSheet, openJson);
}

export async function rescanCsvFile(datasetId, separator) {
  return invoke("rescan_csv_file", { datasetId, separator });
}

export async function openFile(openSheet, openJson) {
  const opened = await invoke("open_file_dialog", {
    separator: ",",
  });
  if (opened) addOpenedFile(opened, openSheet, openJson);
}
