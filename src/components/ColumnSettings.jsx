// Renders per-column type, numeric precision, and summary-statistic controls.
// FEATURE: CSV data workspace
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FunnelPlus } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  COLUMN_TYPES,
  DATE_FORMATS,
  DEFAULT_DATE_FORMAT,
} from "../utils/columnTypes";
import { ColumnStatsSummary, useColumnStats } from "./ColumnStats";
import {
  BLANK_VALUE_LABEL,
  DEFAULT_COLUMN_PRECISION,
  EXPRESSION_NO_MATCHES_MESSAGE,
  MAX_COLUMN_PRECISION,
  MIN_COLUMN_PRECISION,
  ICON_SIZE_SMALL,
  ICON_SIZE_STATUS,
  RANGE_SLIDER_ICON_ASPECT_RATIO,
  SEARCH_DEBOUNCE_MS,
} from "../constants";

function submenuTriggerProps(openOnClick, setOpen) {
  if (openOnClick) return {};
  return {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
  };
}

function useSubmenuPlacement(open, ready, detectOverflow) {
  const submenuRef = useRef(null);
  const [openBelow, setOpenBelow] = useState(false);

  useLayoutEffect(() => {
    if (!open || !ready || !detectOverflow) {
      setOpenBelow(false);
      return;
    }
    setOpenBelow(
      submenuRef.current.getBoundingClientRect().right >
        document.documentElement.clientWidth,
    );
  }, [open, ready, detectOverflow]);

  return [submenuRef, openBelow];
}

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

function DistinctValuesMenu({
  sheet,
  column,
  openOnClick,
  detectSubmenuOverflow,
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(undefined);
  const [included, setIncluded] = useState([]);
  const showError = useAppStore((state) => state.showError);
  const createExpressionFilteredSheet = useAppStore(
    (state) => state.createExpressionFilteredSheet,
  );
  const includedValues = new Set(included);
  const [submenuRef, openBelow] = useSubmenuPlacement(
    open,
    values !== undefined,
    detectSubmenuOverflow,
  );

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
    <div className="has-submenu" {...submenuTriggerProps(openOnClick, setOpen)}>
      <button
        type="button"
        className="type-selector-trigger"
        onClick={openOnClick ? () => setOpen((o) => !o) : undefined}
      >
        distinct
      </button>
      {open && values && (
        <ul
          ref={submenuRef}
          className={`file-menu-dropdown submenu distinct-values-submenu${openBelow ? " submenu-below" : ""}`}
        >
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

function DateFormatMenu({
  sheet,
  column,
  openOnClick,
  detectSubmenuOverflow,
}) {
  const [open, setOpen] = useState(false);
  const setColumnDateFormat = useAppStore((state) => state.setColumnDateFormat);
  const format = sheet.columnDateFormats?.[column] ?? DEFAULT_DATE_FORMAT;
  const selected = DATE_FORMATS.find((candidate) => candidate.value === format);
  const [submenuRef, openBelow] = useSubmenuPlacement(
    open,
    true,
    detectSubmenuOverflow,
  );

  return (
    <div className="has-submenu" {...submenuTriggerProps(openOnClick, setOpen)}>
      <button
        type="button"
        className="type-selector-trigger"
        onClick={openOnClick ? () => setOpen((o) => !o) : undefined}
      >
        {selected?.label ?? format}
      </button>
      {open && (
        <ul
          ref={submenuRef}
          className={`file-menu-dropdown submenu date-formats-submenu${openBelow ? " submenu-below" : ""}`}
        >
          {DATE_FORMATS.map((candidate) => (
            <li key={candidate.value}>
              <button
                type="button"
                className={candidate.value === format ? "active" : ""}
                onClick={() => {
                  setColumnDateFormat(sheet.id, column, candidate.value);
                  setOpen(false);
                }}
              >
                {candidate.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RangeSliderIcon({ size }) {
  return (
    <svg
      width={size * RANGE_SLIDER_ICON_ASPECT_RATIO}
      height={size}
      viewBox="0 0 72 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="6" cy="12" r="5" />
      <line x1="11" y1="12" x2="61" y2="12" />
      <circle cx="66" cy="12" r="5" />
    </svg>
  );
}

function NumberRangeMenu({
  sheet,
  column,
  stats,
  precision,
  openOnClick,
  detectSubmenuOverflow,
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState([stats.min, stats.max]);
  const [matchCheck, setMatchCheck] = useState({
    range: null,
    hasMatches: false,
  });
  const showError = useAppStore((state) => state.showError);
  const expressionConditionMatches = useAppStore(
    (state) => state.expressionConditionMatches,
  );
  const createExpressionFilteredSheet = useAppStore(
    (state) => state.createExpressionFilteredSheet,
  );
  const [low, high] = range;
  const isFiltered = low > stats.min || high < stats.max;
  const isChecked =
    isFiltered && matchCheck.range?.[0] === low && matchCheck.range?.[1] === high;
  const [submenuRef, openBelow] = useSubmenuPlacement(
    open,
    true,
    detectSubmenuOverflow,
  );

  useEffect(() => {
    setRange([stats.min, stats.max]);
  }, [stats]);

  useEffect(() => {
    if (!isFiltered) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      expressionConditionMatches(sheet.id, column, {
        kind: "range",
        min: low,
        max: high,
      })
        .then((hasMatches) => {
          if (!cancelled) setMatchCheck({ range: [low, high], hasMatches });
        })
        .catch((error) => {
          if (!cancelled) showError(error);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isFiltered, low, high, sheet.id, column, expressionConditionMatches, showError]);

  const applyRange = () => {
    createExpressionFilteredSheet(sheet.id, column, {
      kind: "range",
      min: low,
      max: high,
    });
    setRange([stats.min, stats.max]);
  };

  const sliderProps = {
    type: "range",
    min: stats.min,
    max: stats.max,
    step: "any",
  };

  return (
    <div className="has-submenu" {...submenuTriggerProps(openOnClick, setOpen)}>
      <button
        type="button"
        className="type-selector-trigger"
        aria-label={`Filter ${column} range`}
        onClick={openOnClick ? () => setOpen((o) => !o) : undefined}
      >
        <RangeSliderIcon size={ICON_SIZE_STATUS} />
      </button>
      {open && (
        <ul
          ref={submenuRef}
          className={`file-menu-dropdown submenu number-range-submenu${openBelow ? " submenu-below" : ""}`}
        >
          <li className="shortcut-item">
            {low.toFixed(precision)} – {high.toFixed(precision)}
            {isChecked && matchCheck.hasMatches && (
              <button
                type="button"
                className="type-selector-trigger"
                aria-label="Apply filter"
                title="Apply filter"
                onClick={applyRange}
              >
                <FunnelPlus size={ICON_SIZE_SMALL} />
              </button>
            )}
          </li>
          <li className="menu-separator" />
          <li className="number-range-slider">
            <input
              {...sliderProps}
              aria-label={`${column} minimum`}
              value={low}
              onChange={(e) =>
                setRange([Math.min(Number(e.target.value), high), high])
              }
            />
            <input
              {...sliderProps}
              aria-label={`${column} maximum`}
              value={high}
              onChange={(e) =>
                setRange([low, Math.max(Number(e.target.value), low)])
              }
            />
          </li>
          {isChecked && !matchCheck.hasMatches && (
            <li className="shortcut-item">{EXPRESSION_NO_MATCHES_MESSAGE}</li>
          )}
        </ul>
      )}
    </div>
  );
}

function ColumnSettings({
  sheet,
  column,
  minWidth,
  openOnClick = false,
  detectSubmenuOverflow = false,
}) {
  const setColumnPrecision = useAppStore((state) => state.setColumnPrecision);
  const type = sheet.columnTypes[column];
  const precision = sheet.columnPrecision[column] ?? DEFAULT_COLUMN_PRECISION;
  const hasStats = type !== "string" && type !== "uuid";
  const hasDistinct = type === "string" || type === "category";
  const stats = useColumnStats(sheet, column);
  const hasRange = stats?.type === "number" && stats.min < stats.max;

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
          <DistinctValuesMenu
            sheet={sheet}
            column={column}
            openOnClick={openOnClick}
            detectSubmenuOverflow={detectSubmenuOverflow}
          />
        </div>
      )}
      {type === "date" && (
        <div className="column-settings-row">
          <span>Parsing</span>
          <DateFormatMenu
            sheet={sheet}
            column={column}
            openOnClick={openOnClick}
            detectSubmenuOverflow={detectSubmenuOverflow}
          />
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
      {hasRange && (
        <div className="column-settings-row">
          <span>Range</span>
          <NumberRangeMenu
            sheet={sheet}
            column={column}
            stats={stats}
            precision={precision}
            openOnClick={openOnClick}
            detectSubmenuOverflow={detectSubmenuOverflow}
          />
        </div>
      )}
      {hasStats && <div className="column-settings-separator" />}
      {hasStats && (
        <ColumnStatsSummary sheet={sheet} column={column} stats={stats} />
      )}
    </div>
  );
}

export default ColumnSettings;
