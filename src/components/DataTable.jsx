import { useEffect, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table";
import { Settings } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { compareByType, COLUMN_TYPES } from "../utils/columnTypes";
import { computeColumnStats } from "../utils/stats";

function StatRow({ label, value }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function ColumnStats({ sheet, column }) {
  const type = sheet.columnTypes[column];
  const precision = sheet.columnPrecision[column] ?? 2;
  const stats = useMemo(
    () => computeColumnStats(type, sheet.rows.map((row) => row[column])),
    [type, sheet.rows, column],
  );

  if (!stats) return <div className="column-stats-empty">No data</div>;

  if (stats.type === "number") {
    return (
      <div className="column-stats">
        <StatRow label="Sum" value={stats.sum.toFixed(precision)} />
        <StatRow label="Average" value={stats.avg.toFixed(precision)} />
        <StatRow label="Min" value={stats.min.toFixed(precision)} />
        <StatRow label="Max" value={stats.max.toFixed(precision)} />
        <StatRow label="Std dev" value={stats.stdDev.toFixed(precision)} />
        <StatRow label="Mode" value={Number(stats.mode).toFixed(precision)} />
      </div>
    );
  }

  if (stats.type === "date") {
    return (
      <div className="column-stats">
        <StatRow label="Min" value={stats.min.toISOString()} />
        <StatRow label="Max" value={stats.max.toISOString()} />
      </div>
    );
  }

  if (stats.type === "category") {
    return (
      <div className="column-stats">
        <StatRow
          label="Most"
          value={`${stats.most[0]} (${stats.most[1]})`}
        />
        <StatRow label="Min" value={`${stats.least[0]} (${stats.least[1]})`} />
      </div>
    );
  }

  return (
    <div className="column-stats">
      <StatRow label="Mode" value={String(stats.mode)} />
    </div>
  );
}

function ColumnSettings({ sheet, column, isOpen }) {
  const setColumnType = useAppStore((state) => state.setColumnType);
  const setColumnPrecision = useAppStore((state) => state.setColumnPrecision);
  const type = sheet.columnTypes[column];

  return (
    <div
      className={"column-settings-popover" + (isOpen ? " open" : "")}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="column-settings-inner">
        <label className="column-settings-field">
          Type
          <select
            value={type}
            onChange={(e) => setColumnType(sheet.id, column, e.target.value)}
          >
            {COLUMN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {type === "number" && (
          <label className="column-settings-field">
            Significant digits
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
        {isOpen && <ColumnStats sheet={sheet} column={column} />}
      </div>
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
              <th key={header.id} className="th-cell">
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
                      setOpenColumn((current) =>
                        current === header.id ? null : header.id,
                      );
                    }}
                  >
                    <Settings size={13} />
                  </button>
                </div>
                <ColumnSettings
                  sheet={sheet}
                  column={header.id}
                  isOpen={openColumn === header.id}
                />
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
