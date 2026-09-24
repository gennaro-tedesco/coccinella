import { Channel, invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/useAppStore";

const FILE_LOADING_CANCELLED = "File loading cancelled";

function addOpenedFile(opened, openSheet, openJson) {
  if (opened.kind === "json") {
    openJson(opened.filename, opened.id, opened.data, opened.sizeBytes, opened.path);
    return;
  }
  openSheet(opened.filename, opened.metadata, opened.path);
}

async function invokeFileOpen(command, args) {
  const operationId = crypto.randomUUID();
  const onProgress = new Channel();
  onProgress.onmessage = (progress) =>
    useAppStore.getState().setFileLoadProgress(progress);
  try {
    return await invoke(command, { ...args, operationId, onProgress });
  } catch (error) {
    if (String(error) === FILE_LOADING_CANCELLED) return null;
    throw error;
  } finally {
    useAppStore.getState().clearFileLoadProgress(operationId);
  }
}

export async function openFileAtPath(candidate, openSheet, openJson, separator) {
  const opened = await invokeFileOpen("load_indexed_file", {
    token: candidate.token,
    separator: separator || ",",
  });
  if (!opened) return;
  addOpenedFile(opened, openSheet, openJson);
}

export async function rescanCsvFile(datasetId, separator) {
  return invoke("rescan_csv_file", { datasetId, separator });
}

export async function openFile(openSheet, openJson) {
  const opened = await invokeFileOpen("open_file_dialog", {
    separator: ",",
  });
  if (opened) addOpenedFile(opened, openSheet, openJson);
}
