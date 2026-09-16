import { useAppStore } from "../store/useAppStore";
import { formatBytes } from "../utils/stats";

function ColumnPanel() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const setColumnVisibility = useAppStore(
    (state) => state.setColumnVisibility,
  );

  if (!sheet) {
    return (
      <div className="column-panel">
        <div className="panel-title">Columns</div>
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
      <div className="panel-title">Columns</div>
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
          <li key={column} className="column-row">
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
    </div>
  );
}

export default ColumnPanel;
