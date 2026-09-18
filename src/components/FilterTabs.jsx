import { X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { ICON_SIZE_SMALL } from "../constants";
import { rootSheetId } from "../utils/sheets";

function filterLevels(sheets, id) {
  const levels = [];
  let level = sheets[id]?.children ?? [];
  while (level.length > 0) {
    levels.push(level);
    level = level.flatMap((childId) => sheets[childId]?.children ?? []);
  }
  return levels;
}

function FilterTabs() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheets = useAppStore((state) => state.sheets);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const closeFilteredSheet = useAppStore((state) => state.closeFilteredSheet);

  const activeSheet = activeSheetId ? sheets[activeSheetId] : null;
  const rootId = activeSheet ? rootSheetId(sheets, activeSheetId) : null;
  const root = rootId ? sheets[rootId] : null;
  const levels = root ? filterLevels(sheets, rootId) : [];

  if (levels.length === 0) return null;

  return (
    <div className="filter-tab-levels">
      {levels.map((filters, depth) => (
        <div className="filter-tabs" key={depth}>
          {filters.map((childId) => {
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
                    void closeFilteredSheet(childId);
                  }}
                >
                  <X size={ICON_SIZE_SMALL} />
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default FilterTabs;
