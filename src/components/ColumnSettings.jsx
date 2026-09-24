// Renders per-column type, numeric precision, and summary-statistic controls.
// FEATURE: CSV data workspace
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, FunnelPlus } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { COLUMN_TYPES } from "../utils/columnTypes";
import ColumnStats from "./ColumnStats";
import {
  BLANK_VALUE_LABEL,
  DEFAULT_COLUMN_PRECISION,
  MAX_COLUMN_PRECISION,
  MIN_COLUMN_PRECISION,
  ICON_SIZE_SMALL,
} from "../constants";

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

function DistinctValuesMenu({ sheet, column }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(undefined);
  const [included, setIncluded] = useState([]);
  const showError = useAppStore((state) => state.showError);
  const createExpressionFilteredSheet = useAppStore(
    (state) => state.createExpressionFilteredSheet,
  );
  const includedValues = new Set(included);

  useEffect(() => {
    setValues(undefined);
    setIncluded([]);
  }, [sheet.datasetId, sheet.contentVersion, column]);

  const applyInclusion = () => {
    createExpressionFilteredSheet(sheet.id, column, {
      kind: "included",
      values: included,
    });
    setIncluded([]);
  };

  const toggleValue = (value) =>
    setIncluded((current) =>
      current.includes(value)
        ? current.filter((includedValue) => includedValue !== value)
        : [...current, value],
    );

  const valueClassName = (value) => {
    if (includedValues.has(value)) return "active";
    return included.length > 0 ? "excluded" : "";
  };

  useEffect(() => {
    if (!open || values !== undefined) return undefined;
    let cancelled = false;
    invoke("get_distinct_values", { datasetId: sheet.datasetId, column })
      .then((result) => {
        if (!cancelled) setValues(result);
      })
      .catch((error) => {
        if (!cancelled) showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [open, values, sheet.datasetId, column, showError]);

  return (
    <div
      className="has-submenu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button type="button" className="type-selector-trigger">
        distinct
      </button>
      {open && values && (
        <ul className="file-menu-dropdown submenu distinct-values-submenu">
          <li className="shortcut-item">
            {values.total} distinct
            {included.length > 0 && (
              <button
                type="button"
                className="type-selector-trigger"
                aria-label="Apply filter"
                title="Apply filter"
                onClick={applyInclusion}
              >
                <FunnelPlus size={ICON_SIZE_SMALL} />
              </button>
            )}
          </li>
          <li className="menu-separator" />
          {values.values.map(({ value, count }) => (
            <li key={value}>
              <button
                type="button"
                className={valueClassName(value)}
                aria-pressed={includedValues.has(value)}
                onClick={() => toggleValue(value)}
              >
                <span className="stat-value">{value || BLANK_VALUE_LABEL}</span>
                <span className="stat-label">{count}</span>
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
  const precision = sheet.columnPrecision[column] ?? DEFAULT_COLUMN_PRECISION;
  const hasStats = type !== "string" && type !== "uuid";
  const hasDistinct = type === "string" || type === "category";

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
      {hasDistinct && (
        <div className="column-settings-row">
          <span>Values</span>
          <DistinctValuesMenu sheet={sheet} column={column} />
        </div>
      )}
      {type === "number" && (
        <div className="column-settings-row">
          <span>Precision</span>
          <div className="precision-selector">
            <button
              type="button"
              className="type-selector-trigger"
              aria-label={`Decrease ${column} precision`}
              disabled={precision === MIN_COLUMN_PRECISION}
              onClick={() =>
                setColumnPrecision(sheet.id, column, precision - 1)
              }
            >
              <ChevronDown size={ICON_SIZE_SMALL} />
            </button>
            <output className="precision-value">
              {precision}
            </output>
            <button
              type="button"
              className="type-selector-trigger"
              aria-label={`Increase ${column} precision`}
              disabled={precision === MAX_COLUMN_PRECISION}
              onClick={() =>
                setColumnPrecision(sheet.id, column, precision + 1)
              }
            >
              <ChevronUp size={ICON_SIZE_SMALL} />
            </button>
          </div>
        </div>
      )}
      {hasStats && <div className="column-settings-separator" />}
      {hasStats && <ColumnStats sheet={sheet} column={column} />}
    </div>
  );
}

export default ColumnSettings;
