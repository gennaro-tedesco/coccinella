import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { COLUMN_TYPES } from "../utils/columnTypes";
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
      {type !== "string" && <div className="column-settings-separator" />}
      <ColumnStats sheet={sheet} column={column} />
    </div>
  );
}

export default ColumnSettings;
