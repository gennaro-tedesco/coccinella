import { useEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";
import { Settings } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { compareByType, COLUMN_TYPES } from "../utils/columnTypes";
import ColumnStats from "./ColumnStats";

function TypeSelector({ sheet, column }) {
  const [open, setOpen] = useState(false);
  const setColumnType = useAppStore((state) => state.setColumnType);
  const type = sheet.columnTypes[column];

  return (
    <div className="type-selector">
      <button
        type="button"
        className="type-selector-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {type}
      </button>
      {open && (
        <ul
          className="file-menu-dropdown type-selector-dropdown"
          onClick={(e) => e.stopPropagation()}
        >
          {COLUMN_TYPES.map((t) => (
            <li key={t}>
              <button
                type="button"
                className={t === type ? "active" : ""}
                onClick={() => {
                  setColumnType(sheet.id, column, t);
                  setOpen(false);
                }}
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColumnSettings({ sheet, column, minWidth }) {
  const setColumnPrecision = useAppStore((state) => state.setColumnPrecision);
  const type = sheet.columnTypes[column];

  return (
    <div
      className="column-settings-popover"
      style={minWidth ? { minWidth } : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="column-settings-row">
        <span>Type</span>
        <TypeSelector sheet={sheet} column={column} />
      </div>
      {type === "number" && (
        <label className="column-settings-row">
          <span>Precision</span>
          <input
            type="number"
            min={0}
            max={10}
            value={sheet.columnPrecision[column] ?? 2}
            onChange={(e) =>
              setColumnPrecision(sheet.id, column, Number(e.target.value))
            }
          />
        </label>
      )}
      <div className="column-settings-separator" />
      <ColumnStats sheet={sheet} column={column} />
    </div>
  );
}

function DataTable() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const setColumnVisibility = useAppStore(
    (state) => state.setColumnVisibility,
  );
  const setSorting = useAppStore((state) => state.setSorting);
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
