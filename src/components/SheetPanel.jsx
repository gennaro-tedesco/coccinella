import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Save, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { ICON_SIZE_DEFAULT, ICON_SIZE_SMALL } from "../constants";

async function saveFilteredSheet(sheet) {
  const filename = sheet.filename.replace(/[<>:"/\\|?*]/g, "-");
  await invoke("save_csv_file_dialog", {
    datasetId: sheet.datasetId,
    defaultName: filename.endsWith(".csv") ? filename : `${filename}.csv`,
    columns: sheet.columns,
  });
}

function SheetPanel() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeSheet = useAppStore((state) => state.closeSheet);
  const closeFilteredSheet = useAppStore((state) => state.closeFilteredSheet);
  const sheetPanelOpen = useAppStore((state) => state.sheetPanelOpen);
  const toggleSheetPanel = useAppStore((state) => state.toggleSheetPanel);
  const showError = useAppStore((state) => state.showError);

  if (!sheetPanelOpen) {
    return (
      <div className="sheet-panel collapsed">
        <button
          type="button"
          className="panel-toggle"
          aria-label="Open sheets panel"
          onClick={toggleSheetPanel}
        >
          <ChevronRight size={ICON_SIZE_DEFAULT} />
        </button>
      </div>
    );
  }

  return (
    <div className="sheet-panel">
      {sheetOrder.length === 0 && (
        <div className="panel-empty">No files open</div>
      )}
      <ul className="sheet-tree">
        {sheetOrder.map((id) => (
          <li key={id}>
            <div
              className={
                "sheet-node-row" + (id === activeSheetId ? " active" : "")
              }
            >
              <button
                type="button"
                className="sheet-node"
                onClick={() => setActiveSheetId(id)}
              >
                {sheets[id].filename}
              </button>
              <button
                type="button"
                className="sheet-node-close"
                aria-label="Close file"
                onClick={(event) => {
                  event.stopPropagation();
                  void closeSheet(id);
                }}
              >
                <X size={ICON_SIZE_SMALL} />
              </button>
            </div>
            {sheets[id].children.length > 0 && (
              <ul className="sheet-children">
                {sheets[id].children.map((childId) => {
                  const child = sheets[childId];
                  if (!child) return null;
                  return (
                    <li key={childId}>
                      <div
                        className={
                          "sheet-node-row" +
                          (childId === activeSheetId ? " active" : "")
                        }
                      >
                        <span className="sheet-tree-branch" aria-hidden="true" />
                        <div className="sheet-child-content">
                          <button
                            type="button"
                            className="sheet-node"
                            onClick={() => setActiveSheetId(childId)}
                          >
                            {child.filterOf.pattern}
                          </button>
                          <button
                            type="button"
                            className="sheet-node-action"
                            aria-label="Save filtered sheet"
                            title="Save filtered sheet"
                            onClick={(event) => {
                              event.stopPropagation();
                              void saveFilteredSheet(child).catch(showError);
                            }}
                          >
                            <Save size={ICON_SIZE_SMALL} />
                          </button>
                          <button
                            type="button"
                            className="sheet-node-action"
                            aria-label="Close filtered sheet"
                            onClick={(event) => {
                              event.stopPropagation();
                              void closeFilteredSheet(childId);
                            }}
                          >
                            <X size={ICON_SIZE_SMALL} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="panel-header">
        <div />
        <button
          type="button"
          className="panel-toggle"
          aria-label="Close sheets panel"
          onClick={toggleSheetPanel}
        >
          <ChevronLeft size={ICON_SIZE_DEFAULT} />
        </button>
      </div>
    </div>
  );
}

export default SheetPanel;
