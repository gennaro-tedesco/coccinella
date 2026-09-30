// Renders a window of the active Rust-owned dataset.
// FEATURE: CSV data workspace
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { formatDateValue } from "../utils/dateFormats";
import { formatNumberValue } from "../utils/numberFormats";
import { calculateRowRange } from "../utils/rowRange";
import { DEFAULT_DATE_FORMAT } from "../utils/columnTypes";
import { Copy, Settings } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import ColumnSettings from "./ColumnSettings";
import CopyColumnButton from "./CopyColumnButton";
import { formatCopiedValue } from "../utils/copyText";
import { useScrollPercent } from "../hooks/useScrollPercent";
import {
  CELL_COPY_FEEDBACK_MS,
  ICON_SIZE_COMPACT,
  ROW_HEIGHT_CHANGE_THRESHOLD_PX,
  ROW_SELECTION_MAX_FRAME_MS,
  ROW_SELECTION_SCROLL_EDGE_PX,
  ROW_SELECTION_SCROLL_SPEED_PX_PER_SECOND,
  SOURCE_DATA_LINE_OFFSET,
  SOURCE_HEADER_LINE,
} from "../constants";

const DEFAULT_ROW_HEIGHT = 29;
const EMPTY_ROW_RANGE = { offset: 0, limit: 0 };
const MILLISECONDS_PER_SECOND = 1000;

function DataTable({ selectedRowRange, onSelectRowRange }) {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const setColumnVisibility = useAppStore(
    (state) => state.setColumnVisibility,
  );
  const setSorting = useAppStore((state) => state.setSorting);
  const toggleColumnSelection = useAppStore(
    (state) => state.toggleColumnSelection,
  );
  const setHoveredColumn = useAppStore((state) => state.setHoveredColumn);
  const copiedColumn = useAppStore((state) => state.copiedColumn);
  const activeSearchMatch = useAppStore((state) => state.activeSearchMatch);
  const searchVersion = useAppStore((state) => state.searchVersion);
  const showError = useAppStore((state) => state.showError);
  const copyWithQuotes = useAppStore((state) => state.copyWithQuotes);
  const copyQuote = useAppStore((state) => state.copyQuote);
  const showRowIndex = useAppStore((state) => state.showRowIndex);
  const setColumnWidth = useAppStore((state) => state.setColumnWidth);
  const resetColumnWidth = useAppStore((state) => state.resetColumnWidth);
  const [openColumn, setOpenColumn] = useState(null);
  const [openColumnWidth, setOpenColumnWidth] = useState(null);
  const [rowRange, setRowRange] = useState(EMPTY_ROW_RANGE);
  const [page, setPage] = useState({ offset: 0, rows: [], matches: [] });
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [copiedCellKey, setCopiedCellKey] = useState(null);
  const [rowSelection, setRowSelection] = useState(null);
  const tableRef = useRef(null);
  const thRefs = useRef({});
  const pivotSuperHeaderRef = useRef(null);
  const copyFeedbackTimeoutRef = useRef(null);
  const pointerPositionRef = useRef(null);
  const rowSelectionPointerRef = useRef(null);
  const rowSelectionFrameRef = useRef(null);
  const rowSelectionFrameTimeRef = useRef(null);
  const rowSelectionMetricsRef = useRef(null);
  const [pivotSuperHeaderHeight, setPivotSuperHeaderHeight] = useState(0);
  rowSelectionMetricsRef.current = {
    rowCount: sheet?.rowCount ?? 0,
    rowHeight,
  };

  useScrollPercent(tableRef, null, sheet?.datasetId);

  useEffect(() => {
    if (!openColumn) return;
    function handleOutsideClick() {
      setOpenColumn(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openColumn]);

  useEffect(() => {
    setRowRange(EMPTY_ROW_RANGE);
    setPage({ offset: 0, rows: [], matches: [] });
    setRowSelection(null);
    rowSelectionPointerRef.current = null;
    window.cancelAnimationFrame(rowSelectionFrameRef.current);
    tableRef.current?.classList.remove("cell-hover-disabled");
    tableRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [sheet?.datasetId]);

  useEffect(
    () => () => {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
      window.cancelAnimationFrame(rowSelectionFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const scroller = tableRef.current?.parentElement;
    if (!scroller || !sheet) return undefined;
    function updateRange() {
      setRowRange((currentRange) =>
        calculateRowRange({
          scrollTop: scroller.scrollTop,
          viewportHeight: scroller.clientHeight,
          rowHeight,
          rowCount: sheet.rowCount,
          currentRange,
        }),
      );
    }
    function handleScroll() {
      tableRef.current?.classList.add("cell-hover-disabled");
      updateRange();
    }
    updateRange();
    const observer = new ResizeObserver(updateRange);
    observer.observe(scroller);
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", handleScroll);
    };
  }, [sheet?.datasetId, sheet?.rowCount, rowHeight]);

  useEffect(() => {
    if (!sheet || rowRange.limit === 0) return undefined;
    let cancelled = false;
    invoke("get_rows", {
      datasetId: sheet.datasetId,
      offset: rowRange.offset,
      limit: rowRange.limit,
    })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setPage({ offset: rowRange.offset, rows: [], matches: [] });
          showError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    sheet?.datasetId,
    sheet?.dataVersion,
    searchVersion,
    rowRange,
    showError,
  ]);

  useEffect(() => {
    const row = tableRef.current?.querySelector("tbody tr[data-row-index]");
    if (!row) return undefined;
    function measure() {
      const measured = row.getBoundingClientRect().height;
      setRowHeight((current) =>
        measured &&
        Math.abs(measured - current) > ROW_HEIGHT_CHANGE_THRESHOLD_PX
          ? measured
          : current,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [page]);

  useEffect(() => {
    const superHeader = pivotSuperHeaderRef.current;
    if (!superHeader) {
      setPivotSuperHeaderHeight(0);
      return undefined;
    }
    function measure() {
      setPivotSuperHeaderHeight(superHeader.getBoundingClientRect().height);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(superHeader);
    return () => observer.disconnect();
  }, [sheet?.pivotTable, sheet?.datasetId]);

  const columns = useMemo(
    () =>
      (sheet?.columns ?? []).map((name) => {
        const columnIndex = sheet.sourceColumns.indexOf(name);
        return {
          id: name,
          accessorFn: (row) => row[columnIndex],
          header: name,
          cell: (info) => {
            const value = info.getValue();
            if (value === null || value === undefined || value === "") {
              if (sheet?.pivotTable && name === sheet?.pivotRowDimension) return "(blank)";
              return value;
            }
            if (sheet?.columnTypes[name] === "number") {
              const number = Number(value);
              if (!Number.isNaN(number)) {
                return formatNumberValue(value, sheet?.columnPrecision[name]);
              }
            }
            if (sheet?.columnTypes[name] === "date") {
              return formatDateValue(
                value,
                sheet?.columnDateFormats?.[name] ?? DEFAULT_DATE_FORMAT,
              );
            }
            return value;
          },
        };
      }),
    [
      sheet?.columns,
      sheet?.sourceColumns,
      sheet?.columnTypes,
      sheet?.columnPrecision,
      sheet?.columnDateFormats,
      sheet?.pivotTable,
      sheet?.pivotRowDimension,
    ],
  );

  const selectedColumns = sheet?.selectedColumns ?? [];
  const sorting = sheet?.sorting ?? [];
  const searchMatchKeys = useMemo(
    () =>
      new Set(
        page.matches.map(
          (match) => `${match.rowIndex}:${match.columnId}`,
        ),
      ),
    [page.matches],
  );

  useEffect(() => {
    if (!activeSearchMatch) return;
    tableRef.current?.parentElement?.scrollTo({
      top: activeSearchMatch.rowIndex * rowHeight,
    });
  }, [activeSearchMatch, rowHeight]);

  const table = useReactTable({
    data: page.rows,
    columns,
    state: {
      columnVisibility: sheet?.columnVisibility ?? {},
      sorting,
    },
    manualSorting: true,
    onColumnVisibilityChange: (updater) => {
      if (!activeSheetId) return;
      const next =
        typeof updater === "function"
          ? updater(sheet?.columnVisibility ?? {})
          : updater;
      setColumnVisibility(activeSheetId, next);
    },
    onSortingChange: (updater) => {
      if (!activeSheetId) return;
      const next = typeof updater === "function" ? updater(sorting) : updater;
      void setSorting(activeSheetId, next);
    },
    getCoreRowModel: getCoreRowModel(),
  });

  function handleHeaderClick(event, header) {
    if (!activeSheetId) return;

    const column = header.column;
    const columnId = column.id;
    const isSelected = selectedColumns.includes(columnId);

    if (event.ctrlKey) {
      event.preventDefault();
      if (isSelected && sorting.length > 1) {
        void setSorting(
          activeSheetId,
          sorting.filter((sort) => sort.id !== columnId),
        );
      }
      toggleColumnSelection(activeSheetId, columnId);
      return;
    }

    const isMultiSort = isSelected && selectedColumns.length > 1;
    const direction = column.getNextSortingOrder(isMultiSort);
    const next = isMultiSort
      ? sorting.filter((sort) => selectedColumns.includes(sort.id))
      : sorting.filter((sort) => sort.id === columnId);
    const sortIndex = next.findIndex((sort) => sort.id === columnId);

    if (direction === false) {
      if (sortIndex !== -1) next.splice(sortIndex, 1);
    } else {
      const sort = { id: columnId, desc: direction === "desc" };
      if (sortIndex === -1) next.push(sort);
      else next[sortIndex] = sort;
    }

    void setSorting(activeSheetId, next);
  }

  async function fittedDisplayTexts(columnId) {
    const columnType = sheet.columnTypes[columnId];
    if (columnType !== "number") {
      return [
        await invoke("get_longest_value", {
          datasetId: sheet.datasetId,
          column: columnId,
        }),
      ];
    }
    const stats = await invoke("get_column_stats", {
      datasetId: sheet.datasetId,
      column: columnId,
      columnType,
    });
    if (!stats) return [];
    return [stats.min, stats.max].map((value) =>
      formatNumberValue(value, sheet.columnPrecision[columnId]),
    );
  }

  async function toggleColumnFit(columnId) {
    if (sheet.columnWidths?.[columnId] !== undefined) {
      resetColumnWidth(sheet.id, columnId);
      return;
    }
    const cellValue = tableRef.current?.querySelector("tbody td .cell-value");
    if (!cellValue) return;
    try {
      const texts = await fittedDisplayTexts(columnId);
      const textStyle = getComputedStyle(cellValue);
      const cellStyle = getComputedStyle(cellValue.closest("td"));
      const context = document.createElement("canvas").getContext("2d");
      context.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
      const textWidth = Math.max(
        0,
        ...texts.map((text) => context.measureText(text).width),
      );
      const width =
        textWidth +
        parseFloat(cellStyle.paddingLeft) +
        parseFloat(cellStyle.paddingRight) +
        parseFloat(cellStyle.borderRightWidth);
      setColumnWidth(sheet.id, columnId, Math.ceil(width));
    } catch (error) {
      showError(error);
    }
  }

  function rowIndexAtPoint(clientX, clientY) {
    const cell = document
      .elementFromPoint(clientX, clientY)
      ?.closest("td.row-index-cell[data-row-index]");
    if (!cell || cell.closest("table") !== tableRef.current) return null;
    return Number(cell.dataset.rowIndex);
  }

  function handleRowSelectionStart(event, rowIndex) {
    if (event.button !== 0) return;
    event.preventDefault();
    const table = tableRef.current;
    const scroller = table?.parentElement;
    if (!table || !scroller) return;
    table.setPointerCapture(event.pointerId);
    rowSelectionPointerRef.current = {
      pointerId: event.pointerId,
      clientY: event.clientY,
      bounds: scroller.getBoundingClientRect(),
      headerHeight: table.tHead?.getBoundingClientRect().height ?? 0,
    };
    setRowSelection({
      pointerId: event.pointerId,
      start: rowIndex,
      end: rowIndex,
    });
    rowSelectionFrameTimeRef.current = null;
    rowSelectionFrameRef.current = window.requestAnimationFrame(
      autoScrollRowSelection,
    );
  }

  function autoScrollRowSelection(timestamp) {
    const pointer = rowSelectionPointerRef.current;
    const scroller = tableRef.current?.parentElement;
    const metrics = rowSelectionMetricsRef.current;
    if (!pointer || !scroller || !metrics) return;
    const { bounds, headerHeight } = pointer;
    const direction =
      pointer.clientY <= bounds.top + ROW_SELECTION_SCROLL_EDGE_PX
        ? -1
        : pointer.clientY >= bounds.bottom - ROW_SELECTION_SCROLL_EDGE_PX
          ? 1
          : 0;
    const previousTime = rowSelectionFrameTimeRef.current;
    rowSelectionFrameTimeRef.current = timestamp;
    if (direction && previousTime !== null) {
      const elapsed = Math.min(
        timestamp - previousTime,
        ROW_SELECTION_MAX_FRAME_MS,
      );
      const previousScrollTop = scroller.scrollTop;
      scroller.scrollTop +=
        direction *
        ROW_SELECTION_SCROLL_SPEED_PX_PER_SECOND *
        (elapsed / MILLISECONDS_PER_SECOND);
      if (scroller.scrollTop !== previousScrollTop) {
        if (metrics.rowCount === 0) return;
        const pointerOffset = Math.min(
          Math.max(pointer.clientY - bounds.top, headerHeight),
          scroller.clientHeight,
        );
        const rowIndex = Math.min(
          metrics.rowCount - 1,
          Math.max(
            0,
            Math.floor(
              (scroller.scrollTop + pointerOffset - headerHeight) /
                metrics.rowHeight,
            ),
          ),
        );
        setRowSelection((selection) =>
          selection?.pointerId === pointer.pointerId
            ? { ...selection, end: rowIndex }
            : selection,
        );
      }
    }
    rowSelectionFrameRef.current = window.requestAnimationFrame(
      autoScrollRowSelection,
    );
  }

  function handleRowSelectionMove(event) {
    if (rowSelectionPointerRef.current?.pointerId !== event.pointerId) return;
    rowSelectionPointerRef.current.clientY = event.clientY;
    const rowIndex = rowIndexAtPoint(event.clientX, event.clientY);
    if (rowIndex === null) return;
    setRowSelection((selection) => {
      if (!selection || selection.pointerId !== event.pointerId) return selection;
      if (rowIndex === selection.end) return selection;
      return { ...selection, end: rowIndex };
    });
  }

  function handleRowSelectionEnd(event) {
    if (!rowSelection || rowSelection.pointerId !== event.pointerId) return;
    if (tableRef.current?.hasPointerCapture(event.pointerId)) {
      tableRef.current.releasePointerCapture(event.pointerId);
    }
    rowSelectionPointerRef.current = null;
    window.cancelAnimationFrame(rowSelectionFrameRef.current);
    const start = Math.min(rowSelection.start, rowSelection.end);
    const end = Math.max(rowSelection.start, rowSelection.end);
    onSelectRowRange({ start, end });
    setRowSelection(null);
  }

  if (!sheet) {
    return (
      <div className="data-table-placeholder">
        <p>No sheet selected</p>
      </div>
    );
  }

  const topSpacerHeight = page.offset * rowHeight;
  const bottomSpacerHeight =
    Math.max(0, sheet.rowCount - page.offset - page.rows.length) * rowHeight;
  const activeRowSelection = rowSelection ?? selectedRowRange;
  const selectionStart = activeRowSelection
    ? Math.min(activeRowSelection.start, activeRowSelection.end)
    : null;
  const selectionEnd = activeRowSelection
    ? Math.max(activeRowSelection.start, activeRowSelection.end)
    : null;

  return (
    <table
      className={`data-table${sheet.pivotTable ? " pivot-table" : ""}${showRowIndex ? " show-row-index" : ""}`}
      ref={tableRef}
      onPointerMove={(event) => {
        const previous = pointerPositionRef.current;
        pointerPositionRef.current = { x: event.clientX, y: event.clientY };
        if (
          !previous ||
          previous.x !== event.clientX ||
          previous.y !== event.clientY
        ) {
          tableRef.current?.classList.remove("cell-hover-disabled");
        }
        handleRowSelectionMove(event);
      }}
      onPointerUp={handleRowSelectionEnd}
      onPointerCancel={() => {
        rowSelectionPointerRef.current = null;
        window.cancelAnimationFrame(rowSelectionFrameRef.current);
        setRowSelection(null);
      }}
    >
      <thead data-source-line={SOURCE_HEADER_LINE}>
        {sheet.pivotTable && (
          <tr className="pivot-super-header" ref={pivotSuperHeaderRef}>
            {showRowIndex && (
              <th className="row-index-cell" rowSpan={2}>
                #
              </th>
            )}
            <th className="th-cell">{sheet.pivotMeasureLabel}</th>
            <th className="th-cell" colSpan={table.getVisibleLeafColumns().length - 1}>
              {sheet.pivotColumnDimension}
            </th>
          </tr>
        )}
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {showRowIndex && !sheet.pivotTable && (
              <th className="row-index-cell">#</th>
            )}
            {headerGroup.headers.map((header) => {
              const isSelected = selectedColumns.includes(header.id);
              const isCopied =
                copiedColumn?.datasetId === sheet.datasetId &&
                copiedColumn.column === header.id;
              const sortDirection = header.column.getIsSorted();
              const sortIndex = header.column.getSortIndex();
              const ariaSort =
                sortDirection && sortIndex === 0
                  ? sorting.length > 1
                    ? "other"
                    : sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                  : undefined;

              const fittedWidth = sheet.columnWidths?.[header.id];

              return (
                <th
                  key={header.id}
                  className={`th-cell${isSelected ? " selected" : ""}${isCopied ? " copied" : ""}${sheet.pivotDimensions?.includes(header.id) ? " pivot-dimension" : ""}${fittedWidth !== undefined ? " fitted" : ""}`}
                  ref={(element) => {
                    thRefs.current[header.id] = element;
                  }}
                  style={{
                    ...(sheet.pivotTable && { top: pivotSuperHeaderHeight }),
                    ...(fittedWidth !== undefined && {
                      width: fittedWidth,
                      minWidth: fittedWidth,
                    }),
                  }}
                  aria-selected={isSelected || undefined}
                  aria-sort={ariaSort}
                  onMouseEnter={() => setHoveredColumn(header.id)}
                  onMouseLeave={() => {
                    setHoveredColumn(null);
                    setOpenColumn(null);
                  }}
                >
                  <div
                    className="th-content"
                    onClick={(event) => handleHeaderClick(event, header)}
                    onContextMenu={(event) => {
                      if (event.ctrlKey) event.preventDefault();
                    }}
                  >
                    <span className="th-heading">
                      <span className="th-label">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </span>
                      <span className="sort-indicator" aria-hidden="true">
                        {{ asc: "▲", desc: "▼" }[sortDirection] ?? ""}
                        {sortDirection && sorting.length > 1 && (
                          <span className="sort-priority">{sortIndex + 1}</span>
                        )}
                      </span>
                    </span>
                    <CopyColumnButton sheet={sheet} column={header.id} />
                    <button
                      type="button"
                      className="th-settings-trigger"
                      aria-label={`${header.id} settings`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenColumn((current) => {
                          if (current === header.id) return null;
                          setOpenColumnWidth(
                            thRefs.current[header.id]?.offsetWidth ?? null,
                          );
                          return header.id;
                        });
                      }}
                    >
                      <Settings size={ICON_SIZE_COMPACT} />
                    </button>
                  </div>
                  {openColumn === header.id && (
                    <div
                      popover="manual"
                      className="column-settings-layer"
                      ref={(layer) => {
                        if (layer && !layer.matches(":popover-open")) {
                          layer.showPopover();
                        }
                      }}
                    >
                      <ColumnSettings
                        sheet={sheet}
                        column={header.id}
                        openOnClick
                        detectSubmenuOverflow
                        minWidth={
                          openColumnWidth ? `${openColumnWidth}px` : undefined
                        }
                      />
                    </div>
                  )}
                  <div
                    className="th-resize-handle"
                    aria-hidden="true"
                    onDoubleClick={() => void toggleColumnFit(header.id)}
                  />
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {topSpacerHeight > 0 && (
          <tr className="virtual-spacer" aria-hidden="true">
            <td
              colSpan={table.getVisibleLeafColumns().length + Number(showRowIndex)}
              style={{ height: topSpacerHeight }}
            />
          </tr>
        )}
        {table.getRowModel().rows.map((row) => {
          const rowIndex = page.offset + row.index;
          const isRowSelected =
            selectionStart !== null &&
            rowIndex >= selectionStart &&
            rowIndex <= selectionEnd;
          return (
            <tr
              key={rowIndex}
              className={isRowSelected ? "row-range-selected" : undefined}
              data-row-index={rowIndex}
              data-source-line={rowIndex + SOURCE_DATA_LINE_OFFSET}
            >
              {showRowIndex && (
                <td
                  className="row-index-cell"
                  data-row-index={rowIndex}
                  onPointerDown={(event) =>
                    handleRowSelectionStart(event, rowIndex)
                  }
                >
                  {rowIndex + 1}
                </td>
              )}
              {row.getVisibleCells().map((cell) => {
                const isSelected = selectedColumns.includes(cell.column.id);
                const cellKey = `${rowIndex}:${cell.column.id}`;
                const isMatch = searchMatchKeys.has(cellKey);
                const isActiveMatch =
                  activeSearchMatch?.rowIndex === rowIndex &&
                  activeSearchMatch?.columnId === cell.column.id;
                const className = [
                  isSelected && "selected",
                  isMatch && "search-match",
                  isActiveMatch && "search-match-active",
                  copiedCellKey === cellKey && "copied",
                  copiedColumn?.datasetId === sheet.datasetId &&
                    copiedColumn.column === cell.column.id &&
                    "copied",
                  sheet.columnWidths?.[cell.column.id] !== undefined && "fitted",
                  sheet.pivotDimensions?.includes(cell.column.id) && "pivot-dimension",
                ]
                  .filter(Boolean)
                  .join(" ");
                const content = flexRender(
                  cell.column.columnDef.cell,
                  cell.getContext(),
                );
                return (
                  <td
                    key={cell.id}
                    className={className || undefined}
                    aria-selected={isSelected || undefined}
                  >
                    <div className="cell-content">
                      <span className="cell-value">{content}</span>
                      <button
                        type="button"
                        className="cell-copy-trigger"
                        aria-label={`Copy ${cell.column.id} cell`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void navigator.clipboard
                            .writeText(
                              formatCopiedValue(
                                cell.getValue(),
                                copyWithQuotes ? copyQuote : null,
                              ),
                            )
                            .then(() => {
                              window.clearTimeout(
                                copyFeedbackTimeoutRef.current,
                              );
                              setCopiedCellKey(cellKey);
                              copyFeedbackTimeoutRef.current = window.setTimeout(
                                () => setCopiedCellKey(null),
                                CELL_COPY_FEEDBACK_MS,
                              );
                            })
                            .catch(showError);
                        }}
                      >
                        <Copy size={ICON_SIZE_COMPACT} />
                      </button>
                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}
        {bottomSpacerHeight > 0 && (
          <tr className="virtual-spacer" aria-hidden="true">
            <td
              colSpan={table.getVisibleLeafColumns().length + Number(showRowIndex)}
              style={{ height: bottomSpacerHeight }}
            />
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default DataTable;
