// Renders the active CSV sheet with sorting, visibility, and column controls.
// FEATURE: CSV data workspace
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";
import { Settings } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { compareByType } from "../utils/columnTypes";
import ColumnSettings from "./ColumnSettings";

function DataTable() {
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
  const [openColumn, setOpenColumn] = useState(null);
  const [openColumnWidth, setOpenColumnWidth] = useState(null);
  const thRefs = useRef({});

  useEffect(() => {
    if (!openColumn) return;
    function handleOutsideClick() {
      setOpenColumn(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openColumn]);

  const columns = useMemo(
    () =>
      (sheet?.columns ?? []).map((name) => ({
        id: name,
        accessorFn: (row) => row[name],
        header: name,
        cell: (info) => {
          const value = info.getValue();
          if (sheet?.columnTypes[name] === "number") {
            const num = Number(value);
            if (!Number.isNaN(num)) {
              return num.toFixed(sheet?.columnPrecision[name] ?? 2);
            }
          }
          return value;
        },
        sortingFn: (rowA, rowB) =>
          compareByType(
            sheet?.columnTypes[name],
            rowA.getValue(name),
            rowB.getValue(name),
          ),
      })),
    [sheet?.columns, sheet?.columnTypes, sheet?.columnPrecision],
  );

  const selectedColumns = sheet?.selectedColumns ?? [];
  const sorting = sheet?.sorting ?? [];

  const table = useReactTable({
    data: sheet?.rows ?? [],
    columns,
    state: {
      columnVisibility: sheet?.columnVisibility ?? {},
      sorting,
    },
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
      setSorting(activeSheetId, next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  function handleHeaderClick(event, header) {
    if (!activeSheetId) return;

    const column = header.column;
    const columnId = column.id;
    const isSelected = selectedColumns.includes(columnId);

    if (event.ctrlKey) {
      event.preventDefault();
      if (isSelected && sorting.length > 1) {
        setSorting(
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

    setSorting(activeSheetId, next);
  }

  if (!sheet) {
    return (
      <div className="data-table-placeholder">
        <p>No sheet selected</p>
      </div>
    );
  }

  return (
    <table className="data-table">
      <thead>
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
                  ref={(el) => {
                    thRefs.current[header.id] = el;
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
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenColumn((current) => {
                          if (current === header.id) return null;
                          setOpenColumnWidth(
                            thRefs.current[header.id]?.offsetWidth ?? null,
                          );
                          return header.id;
                        });
                      }}
                    >
                      <Settings size={13} />
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
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => {
              const isSelected = selectedColumns.includes(cell.column.id);
              return (
                <td
                  key={cell.id}
                  className={isSelected ? "selected" : undefined}
                  aria-selected={isSelected || undefined}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default DataTable;
