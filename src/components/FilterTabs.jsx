import { X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

function FilterTabs() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheets = useAppStore((state) => state.sheets);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeFilteredSheet = useAppStore((state) => state.closeFilteredSheet);

  const activeSheet = activeSheetId ? sheets[activeSheetId] : null;
  const rootId = activeSheet?.filterOf
    ? activeSheet.filterOf.sourceId
    : activeSheetId;
  const root = rootId ? sheets[rootId] : null;

  if (!root || root.children.length === 0) return null;

  return (
    <div className="filter-tabs">
      {root.children.map((childId) => {
        const child = sheets[childId];
        if (!child) return null;
        return (
          <div
            key={childId}
            className={
              "filter-tab" + (activeSheetId === childId ? " active" : "")
            }
          >
            <button type="button" onClick={() => setActiveSheetId(childId)}>
              {child.filterOf.pattern}
            </button>
            <button
              type="button"
              className="filter-tab-close"
              aria-label="Close filtered sheet"
              onClick={(event) => {
                event.stopPropagation();
                closeFilteredSheet(childId);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default FilterTabs;
