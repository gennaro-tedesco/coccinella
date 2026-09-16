import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { formatBytes } from "../utils/stats";
import ColumnStats from "./ColumnStats";

function ColumnPanel() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const setColumnVisibility = useAppStore(
    (state) => state.setColumnVisibility,
  );
  const columnPanelOpen = useAppStore((state) => state.columnPanelOpen);
  const toggleColumnPanel = useAppStore((state) => state.toggleColumnPanel);
  const [hoveredColumn, setHoveredColumn] = useState(null);

  if (!columnPanelOpen) {
    return (
      <div className="column-panel collapsed">
        <button
          type="button"
          className="panel-toggle"
          aria-label="Open columns panel"
          onClick={toggleColumnPanel}
        >
          <ChevronLeft size={16} />
        </button>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="column-panel">
        <div className="panel-header">
          <div />
          <button
            type="button"
            className="panel-toggle"
            aria-label="Close columns panel"
            onClick={toggleColumnPanel}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="panel-empty">No sheet selected</div>
      </div>
    );
  }

  function toggleVisibility(column) {
    setColumnVisibility(activeSheetId, {
      ...sheet.columnVisibility,
      [column]: !sheet.columnVisibility[column],
    });
  }

  return (
    <div className="column-panel">
      <div className="panel-header">
        <div />
        <button
          type="button"
          className="panel-toggle"
          aria-label="Close columns panel"
          onClick={toggleColumnPanel}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="sheet-summary">
        <div>
          <span className="sheet-summary-value">
            {sheet.rows.length.toLocaleString()}
          </span>{" "}
          rows
        </div>
        <div>
          <span className="sheet-summary-value">{sheet.columns.length}</span>{" "}
          columns
        </div>
        <div>
          <span className="sheet-summary-value">
            {formatBytes(sheet.sizeBytes ?? 0)}
          </span>
        </div>
      </div>
      <ul className="column-list">
        {sheet.columns.map((column) => (
          <li
            key={column}
            className="column-row"
            onMouseEnter={() => setHoveredColumn(column)}
            onMouseLeave={() =>
              setHoveredColumn((current) => (current === column ? null : current))
            }
          >
            <button
              type="button"
              className={
                "column-name" +
                (sheet.columnVisibility[column] ? "" : " disabled")
              }
              onClick={() => toggleVisibility(column)}
            >
              {column}
            </button>
          </li>
        ))}
      </ul>
      {hoveredColumn && sheet.columnTypes[hoveredColumn] !== "string" && (
        <div className="column-hover-stats">
          <ColumnStats sheet={sheet} column={hoveredColumn} />
        </div>
      )}
    </div>
  );
}

export default ColumnPanel;
