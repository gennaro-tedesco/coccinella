import { X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { ICON_SIZE_SMALL } from "../constants";
import { rootSheetId } from "../utils/sheets";

function FileTabs() {
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const sheets = useAppStore((state) => state.sheets);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeSheet = useAppStore((state) => state.closeSheet);

  const activeSheet = activeSheetId ? sheets[activeSheetId] : null;
  const activeRootId = activeSheet ? rootSheetId(sheets, activeSheetId) : null;

  return (
    <div className="file-tabs">
      {sheetOrder.map((id) => (
        <div
          key={id}
          className={"file-tab" + (id === activeRootId ? " active" : "")}
        >
          <button
            type="button"
            className="file-tab-label"
            onClick={() => setActiveSheetId(id)}
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
