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

  const sorting = useMemo(
    () =>
      sheet?.sorting
        ? [
            {
              id: sheet.sorting.columnName,
              desc: sheet.sorting.direction === "desc",
            },
          ]
        : [],
    [sheet?.sorting],
  );

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
      const [first] = next;
      setSorting(
        activeSheetId,
        first
          ? { columnName: first.id, direction: first.desc ? "desc" : "asc" }
          : null,
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

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
            {headerGroup.headers.map((header) => (
              <th
                key={header.id}
                className="th-cell"
                ref={(el) => {
                  thRefs.current[header.id] = el;
                }}
                onMouseEnter={() => setHoveredColumn(header.id)}
                onMouseLeave={() => setHoveredColumn(null)}
              >
                <div
                  className="th-content"
                  onClick={header.column.getToggleSortingHandler()}
                >
                  <span>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                    {{ asc: " ▲", desc: " ▼" }[
                      header.column.getIsSorted()
                    ] ?? ""}
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
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default DataTable;
