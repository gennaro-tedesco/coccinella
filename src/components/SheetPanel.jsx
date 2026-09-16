import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

function SheetPanel() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeSheet = useAppStore((state) => state.closeSheet);
  const sheetPanelOpen = useAppStore((state) => state.sheetPanelOpen);
  const toggleSheetPanel = useAppStore((state) => state.toggleSheetPanel);

  if (!sheetPanelOpen) {
    return (
      <div className="sheet-panel collapsed">
        <button
          type="button"
          className="panel-toggle"
          aria-label="Open sheets panel"
          onClick={toggleSheetPanel}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="sheet-panel">
      <div className="panel-header">
        <div className="panel-title">Sheets</div>
        <button
          type="button"
          className="panel-toggle"
          aria-label="Close sheets panel"
          onClick={toggleSheetPanel}
        >
          <ChevronLeft size={16} />
        </button>
      </div>
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
                  closeSheet(id);
                }}
              >
                <X size={12} />
              </button>
            </div>
            <ul className="sheet-versions" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SheetPanel;
