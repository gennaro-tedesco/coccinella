// Renders a window of the active Rust-owned dataset.
// FEATURE: CSV data workspace
import { invoke } from "@tauri-apps/api/core";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Settings } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import ColumnSettings from "./ColumnSettings";
import {
  DEFAULT_COLUMN_PRECISION,
  ICON_SIZE_COMPACT,
  ROW_HEIGHT_CHANGE_THRESHOLD_PX,
  SOURCE_DATA_LINE_OFFSET,
  SOURCE_HEADER_LINE,
} from "../constants";

const PAGE_SIZE = 200;
const PAGE_STEP = 100;
const DEFAULT_ROW_HEIGHT = 29;

function DataTable(_props, ref) {
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
  const activeSearchMatch = useAppStore((state) => state.activeSearchMatch);
  const searchVersion = useAppStore((state) => state.searchVersion);
  const showError = useAppStore((state) => state.showError);
  const [openColumn, setOpenColumn] = useState(null);
  const [openColumnWidth, setOpenColumnWidth] = useState(null);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({ offset: 0, rows: [], matches: [] });
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const tableRef = useRef(null);
  const thRefs = useRef({});
  const pendingSnapRef = useRef(null);

  useImperativeHandle(ref, () => ({
    scrollToTop() {
      if (offset === 0) {
        tableRef.current?.parentElement?.scrollTo({ top: 0 });
        return;
      }
      pendingSnapRef.current = "top";
      setOffset(0);
    },
    scrollToBottom() {
      if (!sheet) return;
      const target = Math.max(0, sheet.rowCount - PAGE_SIZE);
      if (offset === target) {
        const scroller = tableRef.current?.parentElement;
        scroller?.scrollTo({ top: scroller.scrollHeight });
        return;
      }
      pendingSnapRef.current = "bottom";
      setOffset(target);
    },
  }));

  useEffect(() => {
    if (!openColumn) return;
    function handleOutsideClick() {
      setOpenColumn(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openColumn]);

  useEffect(() => {
    setOffset(0);
    setPage({ offset: 0, rows: [], matches: [] });
    tableRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [sheet?.datasetId]);

  useEffect(() => {
    const scroller = tableRef.current?.parentElement;
    if (!scroller || !sheet) return undefined;
    function updateOffset() {
      const visibleStart = Math.max(
        0,
        Math.floor(scroller.scrollTop / rowHeight) - PAGE_STEP,
      );
      setOffset(Math.floor(visibleStart / PAGE_STEP) * PAGE_STEP);
    }
    updateOffset();
    scroller.addEventListener("scroll", updateOffset, { passive: true });
    return () => scroller.removeEventListener("scroll", updateOffset);
  }, [sheet, rowHeight]);

  // Snaps the scroll position once the requested page (top or bottom row)
  // has actually rendered, so scrollToTop/scrollToBottom land on real data
  // instead of an estimated scroll offset.
  useEffect(() => {
    if (!pendingSnapRef.current) return;
    const snapTo = pendingSnapRef.current;
    pendingSnapRef.current = null;
    const scroller = tableRef.current?.parentElement;
    if (!scroller) return;
    scroller.scrollTo({ top: snapTo === "top" ? 0 : scroller.scrollHeight });
  }, [page]);

  useEffect(() => {
    if (!sheet) return undefined;
    let cancelled = false;
    invoke("get_rows", {
      datasetId: sheet.datasetId,
      offset,
      limit: PAGE_SIZE,
    })
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setPage({ offset, rows: [], matches: [] });
          showError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sheet?.datasetId, sheet?.dataVersion, searchVersion, offset, showError]);

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
            if (sheet?.columnTypes[name] === "number") {
              const number = Number(value);
              if (!Number.isNaN(number)) {
                return number.toFixed(
                  sheet?.columnPrecision[name] ?? DEFAULT_COLUMN_PRECISION,
                );
              }
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

  return (
    <table className="data-table" ref={tableRef}>
      <thead data-source-line={SOURCE_HEADER_LINE}>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => {
              const isSelected = selectedColumns.includes(header.id);
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

              return (
                <th
                  key={header.id}
                  className={`th-cell${isSelected ? " selected" : ""}`}
                  ref={(element) => {
                    thRefs.current[header.id] = element;
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
                    <span>
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <span className="sort-indicator" aria-hidden="true">
                        {{ asc: "▲", desc: "▼" }[sortDirection] ?? ""}
                        {sortDirection && sorting.length > 1 && (
                          <span className="sort-priority">{sortIndex + 1}</span>
                        )}
                      </span>
                    </span>
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
                    <ColumnSettings
                      sheet={sheet}
                      column={header.id}
                      minWidth={
                        openColumnWidth ? `${openColumnWidth}px` : undefined
                      }
                    />
                  )}
                </th>
              );
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {topSpacerHeight > 0 && (
          <tr className="virtual-spacer" aria-hidden="true">
            <td colSpan={sheet.columns.length} style={{ height: topSpacerHeight }} />
          </tr>
        )}
        {table.getRowModel().rows.map((row) => {
          const rowIndex = page.offset + row.index;
          return (
            <tr
              key={rowIndex}
              data-row-index={rowIndex}
              data-source-line={rowIndex + SOURCE_DATA_LINE_OFFSET}
            >
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
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <td
                    key={cell.id}
                    className={className || undefined}
                    aria-selected={isSelected || undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          );
        })}
        {bottomSpacerHeight > 0 && (
          <tr className="virtual-spacer" aria-hidden="true">
            <td
              colSpan={sheet.columns.length}
              style={{ height: bottomSpacerHeight }}
            />
          </tr>
        )}
      </tbody>
    </table>
  );
}

export default forwardRef(DataTable);
