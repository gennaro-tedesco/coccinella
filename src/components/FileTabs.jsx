import { X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { useDragReorder } from "../hooks/useDragReorder";
import { ICON_SIZE_SMALL } from "../constants";
import { rootSheetId } from "../utils/sheets";

function FileTabs() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeSheet = useAppStore((state) => state.closeSheet);
  const moveSheet = useAppStore((state) => state.moveSheet);

  const activeSheet = activeSheetId ? sheets[activeSheetId] : null;
  const activeRootId = activeSheet ? rootSheetId(sheets, activeSheetId) : null;

  const {
    draggedItem: draggedSheetId,
    dropTarget,
    shouldIgnoreClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
  } = useDragReorder({
    selector: "[data-file-tab]",
    axis: "x",
    onMove: moveSheet,
  });

  return (
    <div className="file-tabs">
      {sheetOrder.map((id) => (
        <div
          key={id}
          data-file-tab
          data-item={id}
          className={
            "file-tab" +
            (id === activeRootId ? " active" : "") +
            (draggedSheetId === id ? " dragging" : "") +
            (dropTarget?.item === id ? ` drag-over-${dropTarget.position}` : "")
          }
        >
          <button
            type="button"
            className="file-tab-label"
            onPointerDown={handlePointerDown(id)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onClick={() => {
              if (shouldIgnoreClick()) return;
              setActiveSheetId(id);
            }}
          >
            {sheets[id].filename}
          </button>
          <button
            type="button"
            className="file-tab-close"
            aria-label="Close file"
            onClick={(event) => {
              event.stopPropagation();
              void closeSheet(id);
            }}
          >
            <X size={ICON_SIZE_SMALL} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default FileTabs;
