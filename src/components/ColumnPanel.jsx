// Renders column controls and statistics for the currently hovered column.
// FEATURE: CSV data workspace
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Settings } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { formatBytes } from "../utils/stats";
import { rescanCsvFile } from "../utils/openFile";
import ColumnStats from "./ColumnStats";
import ColumnSettings from "./ColumnSettings";

function ColumnPanel() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const setColumnVisibility = useAppStore(
    (state) => state.setColumnVisibility,
  );
  const moveColumn = useAppStore((state) => state.moveColumn);
  const rescanSheet = useAppStore((state) => state.rescanSheet);
  const columnPanelOpen = useAppStore((state) => state.columnPanelOpen);
  const toggleColumnPanel = useAppStore((state) => state.toggleColumnPanel);
  const hoveredColumn = useAppStore((state) => state.hoveredColumn);
  const setHoveredColumn = useAppStore((state) => state.setHoveredColumn);
  const [openSettingsColumn, setOpenSettingsColumn] = useState(null);
  const [draggedColumn, setDraggedColumn] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [separatorInput, setSeparatorInput] = useState(sheet?.separator ?? ",");
  const dragStateRef = useRef(null);
  const dropTargetRef = useRef(null);
  const ignoreClickUntilRef = useRef(0);

  useEffect(() => {
    setSeparatorInput(sheet?.separator ?? ",");
  }, [activeSheetId, sheet?.separator]);

  async function handleRescan() {
    if (!sheet?.path || !separatorInput) return;
    try {
      const metadata = await rescanCsvFile(
        sheet.datasetId,
        sheet.path,
        separatorInput,
      );
      rescanSheet(activeSheetId, separatorInput, metadata);
    } catch (error) {
      console.error("Failed to rescan CSV with new separator:", error);
    }
  }

  useEffect(() => {
    if (!openSettingsColumn) return;
    function handleOutsideClick() {
      setOpenSettingsColumn(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openSettingsColumn]);

  useEffect(() => {
    if (openSettingsColumn && hoveredColumn !== openSettingsColumn) {
      setOpenSettingsColumn(null);
    }
  }, [hoveredColumn, openSettingsColumn]);

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
        <div className="panel-empty">No sheet selected</div>
        <div className="panel-header">
          <button
            type="button"
            className="panel-toggle"
            aria-label="Close columns panel"
            onClick={toggleColumnPanel}
          >
            <ChevronRight size={16} />
          </button>
          <div />
        </div>
      </div>
    );
  }

  function toggleVisibility(column) {
    setColumnVisibility(activeSheetId, {
      ...sheet.columnVisibility,
      [column]: !sheet.columnVisibility[column],
    });
  }

  function clearColumnDrag() {
    dragStateRef.current = null;
    dropTargetRef.current = null;
    setDraggedColumn(null);
    setDropTarget(null);
  }

  function handleColumnPointerMove(event) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.active) {
      const distance = Math.hypot(
        event.clientX - drag.startX,
        event.clientY - drag.startY,
      );
      if (distance < 4) return;
      drag.active = true;
      setOpenSettingsColumn(null);
      setDraggedColumn(drag.column);
    }

    event.preventDefault();
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest(".column-row");
    const targetColumn = row?.dataset.column;
    if (!targetColumn || targetColumn === drag.column) {
      dropTargetRef.current = null;
      setDropTarget(null);
      return;
    }

    const bounds = row.getBoundingClientRect();
    const position =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    const nextTarget = { column: targetColumn, position };
    dropTargetRef.current = nextTarget;
    setDropTarget((current) =>
      current?.column === targetColumn && current.position === position
        ? current
        : nextTarget,
    );
  }

  function handleColumnPointerUp(event) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.active) {
      const target = dropTargetRef.current;
      if (target) {
        moveColumn(
          activeSheetId,
          drag.column,
          target.column,
          target.position,
        );
      }
      ignoreClickUntilRef.current = performance.now() + 100;
    }
    clearColumnDrag();
  }

  return (
    <div className="column-panel">
      <div className="sheet-summary">
        <div className="sheet-summary-stats">
          <div>
            <span className="sheet-summary-value">
              {sheet.rowCount.toLocaleString()}
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
        <div className="separator-control">
          <input
            type="text"
            className="separator-input"
            maxLength={1}
            aria-label="CSV separator"
            title="CSV separator"
            value={separatorInput}
            onChange={(event) => setSeparatorInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleRescan();
            }}
          />
          <button
            type="button"
            className="type-selector-trigger"
            aria-label="Rescan CSV with separator"
            disabled={!sheet.path || !separatorInput}
            onClick={handleRescan}
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <ul className="column-list">
        {sheet.columns.map((column) => (
          <li
            key={column}
            data-column={column}
            className={
              "column-row" +
              (draggedColumn === column ? " dragging" : "") +
              (dropTarget?.column === column
                ? ` drag-over-${dropTarget.position}`
                : "")
            }
            onMouseEnter={() => setHoveredColumn(column)}
            onMouseLeave={() => setHoveredColumn(null)}
          >
            <div className="column-row-content">
              <button
                type="button"
                className={
                  "column-name" +
                  (sheet.columnVisibility[column] ? "" : " disabled")
                }
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragStateRef.current = {
                    column,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    active: false,
                  };
                }}
                onPointerMove={handleColumnPointerMove}
                onPointerUp={handleColumnPointerUp}
                onPointerCancel={() => clearColumnDrag()}
                onClick={() => {
                  if (performance.now() < ignoreClickUntilRef.current) return;
                  toggleVisibility(column);
                }}
              >
                {column}
              </button>
              <button
                type="button"
                className="th-settings-trigger"
                aria-label={`${column} settings`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenSettingsColumn((current) =>
                    current === column ? null : column,
                  );
                }}
              >
                <Settings size={13} />
              </button>
            </div>
            {openSettingsColumn === column && (
              <ColumnSettings sheet={sheet} column={column} />
            )}
          </li>
        ))}
      </ul>
      {hoveredColumn &&
        !["string", "uuid"].includes(sheet.columnTypes[hoveredColumn]) && (
        <div className="column-hover-stats">
          <ColumnStats sheet={sheet} column={hoveredColumn} />
        </div>
      )}
      <div className="panel-header">
        <button
          type="button"
          className="panel-toggle"
          aria-label="Close columns panel"
          onClick={toggleColumnPanel}
        >
          <ChevronRight size={16} />
        </button>
        <div />
      </div>
    </div>
  );
}

export default ColumnPanel;
