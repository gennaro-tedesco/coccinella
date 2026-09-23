import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { EXPRESSION_NO_MATCHES_MESSAGE, ICON_SIZE_SMALL, SEARCH_DEBOUNCE_MS } from "../constants";

const TABS = [
  { id: "merge", label: "Merge" },
  { id: "append", label: "Append" },
  { id: "aggregate", label: "Aggregate" },
  { id: "expression", label: "Expression", submitLabel: "Apply" },
];

const EXPRESSION_COLUMN_TYPES = ["number", "date", "boolean"];

const DATE_DIRECTIONS = [
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
];

const BOOLEAN_VALUES = [
  { id: true, label: "True" },
  { id: false, label: "False" },
];

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function Calendar({ value, onChange }) {
  const [viewDate, setViewDate] = useState(() => (value ? new Date(`${value}T00:00:00`) : new Date()));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  return (
    <div className="expression-calendar">
      <div className="expression-calendar-header">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setViewDate(new Date(year, month - 1, 1))}
        >
          <ChevronLeft size={ICON_SIZE_SMALL} />
        </button>
        <span>{viewDate.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setViewDate(new Date(year, month + 1, 1))}
        >
          <ChevronRight size={ICON_SIZE_SMALL} />
        </button>
      </div>
      <div className="expression-calendar-weekdays">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="expression-calendar-days">
        {cells.map((day, index) => {
          if (day === null) return <span key={`empty-${index}`} />;
          const iso = toISODate(new Date(year, month, day));
          return (
            <button
              type="button"
              key={iso}
              className={`expression-calendar-day${value === iso ? " active" : ""}`}
              onClick={() => onChange(iso)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const JOIN_TYPES = [
  { id: "left", label: "LEFT", description: "All rows from the first dataset" },
  { id: "inner", label: "INNER", description: "Only matching rows" },
  { id: "right", label: "RIGHT", description: "All rows from the second dataset" },
];

const AGGREGATIONS = {
  number: [
    ["mean", "Mean"],
    ["standard_deviation", "Stdev"],
    ["max", "Max"],
    ["min", "Min"],
    ["sum", "Sum"],
    ["count", "Count"],
    ["count_distinct", "Count distinct"],
    ["mode", "Mode"],
  ],
  date: [
    ["max", "Max"],
    ["min", "Min"],
    ["count", "Count"],
    ["count_distinct", "Count distinct"],
    ["mode", "Mode"],
  ],
  default: [
    ["count", "Count"],
    ["count_distinct", "Count distinct"],
    ["mode", "Mode"],
  ],
};

function commonColumns(left, right) {
  const rightColumns = new Set(right?.columns ?? []);
  return (left?.columns ?? []).filter((column) => rightColumns.has(column));
}

function sameColumns(left, right) {
  return left.columns.length === right.columns.length
    && left.columns.every((column, index) => column === right.columns[index]);
}

function JoinIcon({ type }) {
  return (
    <span className={`join-icon join-icon-${type}`} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function MenuSelector({ value, placeholder, options, disabled, open, onToggle, onSelect, buttonRef }) {
  const selected = options.find((option) => option.id === value);
  return (
    <div className="merge-dataset-selector">
      <button
        ref={buttonRef}
        type="button"
        className="merge-dataset-trigger"
        disabled={disabled}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown size={ICON_SIZE_SMALL} />
      </button>
      {open && (
        <ul className="file-menu-dropdown merge-dataset-dropdown" onClick={(event) => event.stopPropagation()}>
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className={option.id === value ? "active" : ""}
                onClick={() => onSelect(option.id)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DatasetSelector({ value, ids, sheets, ...props }) {
  return (
    <MenuSelector
      {...props}
      value={value}
      placeholder="Select a dataset"
      options={ids.map((id) => ({ id, label: sheets[id].filename }))}
    />
  );
}

function ColumnSelector({ columns, values, open, onToggle, onChange }) {
  const allSelected = values.length === columns.length;
  const label = allSelected && columns.length > 0
    ? "All columns"
    : values.length > 0
      ? values.join(", ")
      : "Select columns";
  return (
    <div className="merge-column-selector">
      <button
        type="button"
        className="merge-dataset-trigger"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span>{label}</span>
        <ChevronDown size={ICON_SIZE_SMALL} />
      </button>
      {open && (
        <ul className="file-menu-dropdown multi-field-dropdown merge-column-dropdown" onClick={(event) => event.stopPropagation()}>
          <li>
            <label>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) => onChange(event.target.checked ? columns : [])}
              />
              All columns
            </label>
          </li>
          <li className="menu-separator" />
          {columns.map((column) => (
            <li key={column}>
              <label>
                <input
                  type="checkbox"
                  checked={values.includes(column)}
                  onChange={() => onChange(values.includes(column)
                    ? values.filter((selected) => selected !== column)
                    : [...values, column])}
                />
                {column}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MergeFields({ sheets, sheetOrder, state, setState, openSelector, setOpenSelector, firstSelectorRef }) {
  const compatibleIds = state.leftId
    ? sheetOrder.filter((id) => id !== state.leftId && commonColumns(sheets[state.leftId], sheets[id]).length > 0)
    : [];
  const columns = state.rightId ? commonColumns(sheets[state.leftId], sheets[state.rightId]) : [];
  return (
    <>
      <div className="merge-datasets">
        <div className="merge-dataset-field">
          <span>First dataset</span>
          <DatasetSelector
            buttonRef={firstSelectorRef}
            value={state.leftId}
            ids={sheetOrder}
            sheets={sheets}
            open={openSelector === "left"}
            onToggle={() => setOpenSelector(openSelector === "left" ? null : "left")}
            onSelect={(leftId) => {
              setState({ ...state, leftId, rightId: "", columns: [] });
              setOpenSelector(null);
            }}
          />
        </div>
        <div className="merge-dataset-field">
          <span>Second dataset</span>
          <DatasetSelector
            value={state.rightId}
            disabled={!state.leftId || compatibleIds.length === 0}
            ids={compatibleIds}
            sheets={sheets}
            open={openSelector === "right"}
            onToggle={() => setOpenSelector(openSelector === "right" ? null : "right")}
            onSelect={(rightId) => {
              setState({ ...state, rightId, columns: commonColumns(sheets[state.leftId], sheets[rightId]) });
              setOpenSelector(null);
            }}
          />
        </div>
      </div>
      {state.leftId && compatibleIds.length === 0 && <div className="merge-empty">No files with columns to merge</div>}
      {state.rightId && (
        <div className="merge-columns">
          <span>Merge on</span>
          <ColumnSelector
            columns={columns}
            values={state.columns}
            open={openSelector === "columns"}
            onToggle={() => setOpenSelector(openSelector === "columns" ? null : "columns")}
            onChange={(columns) => setState({ ...state, columns })}
          />
        </div>
      )}
      <fieldset className="merge-types">
        <legend>Join type</legend>
        <div className="merge-type-grid">
          {JOIN_TYPES.map((type) => (
            <button
              type="button"
              key={type.id}
              className={`merge-type${state.joinType === type.id ? " active" : ""}`}
              aria-pressed={state.joinType === type.id}
              onClick={() => setState({ ...state, joinType: type.id })}
            >
              <JoinIcon type={type.id} />
              <strong>{type.label}</strong>
              <span>{type.description}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

function AppendFields({ sheets, sheetOrder, selected, onChange, firstSelectorRef }) {
  const anchor = selected[0] ? sheets[selected[0]] : null;
  return (
    <div className="operation-column-list" ref={firstSelectorRef} tabIndex="-1">
      <span>Select datasets in their append order</span>
      <ul className="multi-field-dropdown">
        {sheetOrder.map((id) => {
          const compatible = !anchor || selected.includes(id) || sameColumns(anchor, sheets[id]);
          return (
            <li key={id}>
              <label className={!compatible ? "disabled" : ""}>
                <input
                  type="checkbox"
                  disabled={!compatible}
                  checked={selected.includes(id)}
                  onChange={() => onChange(selected.includes(id)
                    ? selected.filter((selectedId) => selectedId !== id)
                    : [...selected, id])}
                />
                {sheets[id].filename}
              </label>
            </li>
          );
        })}
      </ul>
      {anchor && selected.length < 2 && <div className="merge-empty">Only datasets with exactly the same columns can be selected</div>}
    </div>
  );
}

function AggregateFields({ sheets, sheetOrder, state, setState, openSelector, setOpenSelector, firstSelectorRef }) {
  const sheet = state.datasetId ? sheets[state.datasetId] : null;
  const aggregatedColumns = Object.keys(state.aggregations);
  const groupColumns = sheet ? sheet.columns.filter((column) => !aggregatedColumns.includes(column)) : [];
  const canPivot = aggregatedColumns.length === 1 && state.groupBy.length === 2;
  return (
    <>
      <div className="merge-dataset-field">
        <span>Dataset</span>
        <DatasetSelector
          buttonRef={firstSelectorRef}
          value={state.datasetId}
          ids={sheetOrder}
          sheets={sheets}
          open={openSelector === "aggregate-dataset"}
          onToggle={() => setOpenSelector(openSelector === "aggregate-dataset" ? null : "aggregate-dataset")}
          onSelect={(datasetId) => {
            setState({ datasetId, aggregations: {}, groupBy: [], pivotTable: false });
            setOpenSelector(null);
          }}
        />
      </div>
      {sheet && (
        <div className="aggregate-lists">
          <div className="operation-column-list">
            <span>Aggregate columns</span>
            <ul className="multi-field-dropdown aggregate-column-list">
              {sheet.columns.map((column) => {
                const options = AGGREGATIONS[sheet.columnTypes[column]] ?? AGGREGATIONS.default;
                const selected = state.aggregations[column];
                const selectorId = `aggregation-${column}`;
                return (
                  <li key={column}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(selected)}
                        onChange={() => {
                          const aggregations = { ...state.aggregations };
                          if (selected) delete aggregations[column];
                          else aggregations[column] = options[0][0];
                          const groupBy = state.groupBy.filter((value) => value !== column);
                          const pivotTable = state.pivotTable
                            && Object.keys(aggregations).length === 1
                            && groupBy.length === 2;
                          setState({ ...state, aggregations, groupBy, pivotTable });
                        }}
                      />
                      <span>{column}</span>
                    </label>
                    <MenuSelector
                      value={selected ?? options[0][0]}
                      options={options.map(([id, label]) => ({ id, label }))}
                      disabled={!selected}
                      open={openSelector === selectorId}
                      onToggle={() => setOpenSelector(openSelector === selectorId ? null : selectorId)}
                      onSelect={(value) => {
                        setState({ ...state, aggregations: { ...state.aggregations, [column]: value } });
                        setOpenSelector(null);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="operation-column-list">
            <span>Group by</span>
            <ul className="multi-field-dropdown">
              {groupColumns.map((column) => (
                <li key={column}>
                  <label>
                    <input
                      type="checkbox"
                      checked={state.groupBy.includes(column)}
                      onChange={() => {
                        const groupBy = state.groupBy.includes(column)
                          ? state.groupBy.filter((value) => value !== column)
                          : [...state.groupBy, column];
                        const pivotTable = state.pivotTable
                          && aggregatedColumns.length === 1
                          && groupBy.length === 2;
                        setState({ ...state, groupBy, pivotTable });
                      }}
                    />
                    {column}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {sheet && (
        <label className={`operation-checkbox${canPivot ? "" : " disabled"}`}>
          <input
            type="checkbox"
            checked={state.pivotTable}
            disabled={!canPivot}
            onChange={(event) => setState({ ...state, pivotTable: event.target.checked })}
          />
          Display result as a pivot table
        </label>
      )}
      {sheet && groupColumns.length === 0 && (
        <div className="merge-empty">Select fewer aggregate columns to make columns available for grouping</div>
      )}
    </>
  );
}

function ExpressionFields({ sheets, sheetOrder, state, setState, message, openSelector, setOpenSelector, firstSelectorRef }) {
  const sheet = state.datasetId ? sheets[state.datasetId] : null;
  const columns = sheet
    ? sheet.columns.filter((column) => EXPRESSION_COLUMN_TYPES.includes(sheet.columnTypes[column]))
    : [];
  const columnType = sheet && state.column ? sheet.columnTypes[state.column] : null;

  return (
    <>
      <div className="merge-dataset-field">
        <span>Dataset</span>
        <DatasetSelector
          buttonRef={firstSelectorRef}
          value={state.datasetId}
          ids={sheetOrder}
          sheets={sheets}
          open={openSelector === "expression-dataset"}
          onToggle={() => setOpenSelector(openSelector === "expression-dataset" ? null : "expression-dataset")}
          onSelect={(datasetId) => {
            setState({ ...state, datasetId, column: "" });
            setOpenSelector(null);
          }}
        />
      </div>
      {sheet && columns.length === 0 && (
        <div className="merge-empty">No number, date or boolean columns available</div>
      )}
      {sheet && columns.length > 0 && (
        <div className="merge-dataset-field">
          <span>Column</span>
          <MenuSelector
            value={state.column}
            placeholder="Select a column"
            options={columns.map((column) => ({ id: column, label: column }))}
            open={openSelector === "expression-column"}
            onToggle={() => setOpenSelector(openSelector === "expression-column" ? null : "expression-column")}
            onSelect={(column) => {
              setState({
                ...state,
                column,
                numberExpression: "",
                dateValue: "",
                dateDirection: "before",
                booleanValue: true,
              });
              setOpenSelector(null);
            }}
          />
        </div>
      )}
      {columnType === "number" && (
        <div className="merge-dataset-field">
          <span>Expression</span>
          <input
            type="text"
            className="merge-dataset-trigger"
            placeholder="x > 100 && x < 200"
            value={state.numberExpression}
            onChange={(event) => setState({ ...state, numberExpression: event.target.value })}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
        </div>
      )}
      {columnType === "date" && (
        <>
          <div className="merge-dataset-field">
            <span>Date</span>
            <Calendar
              key={state.column}
              value={state.dateValue}
              onChange={(dateValue) => setState({ ...state, dateValue })}
            />
          </div>
          <div className="expression-radio-group">
            {DATE_DIRECTIONS.map((direction) => (
              <label className="expression-radio" key={direction.id}>
                <input
                  type="radio"
                  name="expression-date-direction"
                  checked={state.dateDirection === direction.id}
                  onChange={() => setState({ ...state, dateDirection: direction.id })}
                />
                {direction.label}
              </label>
            ))}
          </div>
        </>
      )}
      {columnType === "boolean" && (
        <fieldset className="merge-types">
          <legend>Value</legend>
          <div className="expression-choice-grid">
            {BOOLEAN_VALUES.map((option) => (
              <button
                type="button"
                key={String(option.id)}
                className={`merge-type${state.booleanValue === option.id ? " active" : ""}`}
                aria-pressed={state.booleanValue === option.id}
                onClick={() => setState({ ...state, booleanValue: option.id })}
              >
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {message && <div className="merge-empty">{message}</div>}
    </>
  );
}

function MergePanel({ onClose, initialTab }) {
  const sheets = useAppStore((state) => state.sheets);
  const allSheetIds = useAppStore((state) => state.sheetOrder);
  const sheetOrder = allSheetIds.filter((id) => sheets[id]?.kind !== "json");
  const createJoinedSheet = useAppStore((state) => state.createJoinedSheet);
  const createAppendedSheet = useAppStore((state) => state.createAppendedSheet);
  const createAggregatedSheet = useAppStore((state) => state.createAggregatedSheet);
  const createExpressionFilteredSheet = useAppStore((state) => state.createExpressionFilteredSheet);
  const expressionConditionMatches = useAppStore((state) => state.expressionConditionMatches);
  const [tab, setTab] = useState(
    initialTab ?? (sheetOrder.length === 1 ? "aggregate" : "merge")
  );
  const [merge, setMerge] = useState({ leftId: "", rightId: "", columns: [], joinType: "inner" });
  const [appendIds, setAppendIds] = useState([]);
  const [aggregate, setAggregate] = useState({
    datasetId: sheetOrder.length === 1 ? sheetOrder[0] : "",
    aggregations: {},
    groupBy: [],
    pivotTable: false,
  });
  const [expression, setExpression] = useState({
    datasetId: sheetOrder.length === 1 ? sheetOrder[0] : "",
    column: "",
    numberExpression: "",
    dateValue: "",
    dateDirection: "before",
    booleanValue: true,
  });
  const [expressionCheck, setExpressionCheck] = useState({ key: null, hasMatches: false, error: null });
  const [submitting, setSubmitting] = useState(false);
  const [openSelector, setOpenSelector] = useState(null);
  const firstSelectorRef = useRef(null);

  useEffect(() => {
    firstSelectorRef.current?.focus();
  }, [tab]);

  useEffect(() => {
    if (!openSelector) return undefined;
    function closeSelector() {
      setOpenSelector(null);
    }
    document.addEventListener("click", closeSelector);
    return () => document.removeEventListener("click", closeSelector);
  }, [openSelector]);

  const expressionColumnType = expression.datasetId && expression.column
    ? sheets[expression.datasetId]?.columnTypes[expression.column]
    : null;

  const expressionCondition = expressionColumnType === "number"
    ? (expression.numberExpression.trim()
      ? { kind: "number", expression: expression.numberExpression.trim() }
      : null)
    : expressionColumnType === "date"
      ? (expression.dateValue
        ? { kind: "date", date: expression.dateValue, direction: expression.dateDirection }
        : null)
      : expressionColumnType === "boolean"
        ? { kind: "boolean", value: expression.booleanValue }
        : null;

  const expressionCheckKey = expression.datasetId && expression.column && expressionCondition
    ? JSON.stringify([expression.datasetId, expression.column, expressionCondition])
    : null;
  const expressionChecked = expressionCheckKey !== null && expressionCheck.key === expressionCheckKey;
  const expressionMessage = expressionChecked
    ? expressionCheck.error ?? (expressionCheck.hasMatches ? null : EXPRESSION_NO_MATCHES_MESSAGE)
    : null;

  useEffect(() => {
    if (!expressionCheckKey) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      expressionConditionMatches(expression.datasetId, expression.column, expressionCondition)
        .then((hasMatches) => {
          if (!cancelled) setExpressionCheck({ key: expressionCheckKey, hasMatches, error: null });
        })
        .catch((error) => {
          if (!cancelled) setExpressionCheck({ key: expressionCheckKey, hasMatches: false, error: String(error) });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [expressionCheckKey, expressionConditionMatches]);

  const canSubmit = tab === "merge"
    ? merge.leftId && merge.rightId && merge.columns.length > 0
    : tab === "append"
      ? appendIds.length >= 2
      : tab === "aggregate"
        ? aggregate.datasetId
          && Object.keys(aggregate.aggregations).length > 0
          && (!aggregate.pivotTable
            || (Object.keys(aggregate.aggregations).length === 1 && aggregate.groupBy.length === 2))
        : Boolean(expressionChecked && expressionCheck.hasMatches);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    let created;
    if (tab === "merge") {
      created = await createJoinedSheet(merge.leftId, merge.rightId, merge.columns, merge.joinType);
    } else if (tab === "append") {
      created = await createAppendedSheet(appendIds);
    } else if (tab === "aggregate") {
      created = await createAggregatedSheet(
        aggregate.datasetId,
        Object.entries(aggregate.aggregations).map(([column, func]) => ({ column, function: func })),
        aggregate.groupBy,
        aggregate.pivotTable,
      );
    } else {
      created = await createExpressionFilteredSheet(expression.datasetId, expression.column, expressionCondition);
    }
    setSubmitting(false);
    if (created) onClose();
  }

  return (
    <div className="fuzzy-finder-overlay merge-overlay" onMouseDown={onClose}>
      <form
        className="merge-panel"
        role="dialog"
        aria-label="Dataset operations"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="operation-tabs" role="tablist" aria-label="Dataset operation">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setOpenSelector(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="operation-content" role="tabpanel">
          {tab === "merge" && (
            <MergeFields
              sheets={sheets}
              sheetOrder={sheetOrder}
              state={merge}
              setState={setMerge}
              openSelector={openSelector}
              setOpenSelector={setOpenSelector}
              firstSelectorRef={firstSelectorRef}
            />
          )}
          {tab === "append" && (
            <AppendFields
              sheets={sheets}
              sheetOrder={sheetOrder}
              selected={appendIds}
              onChange={setAppendIds}
              firstSelectorRef={firstSelectorRef}
            />
          )}
          {tab === "aggregate" && (
            <AggregateFields
              sheets={sheets}
              sheetOrder={sheetOrder}
              state={aggregate}
              setState={setAggregate}
              openSelector={openSelector}
              setOpenSelector={setOpenSelector}
              firstSelectorRef={firstSelectorRef}
            />
          )}
          {tab === "expression" && (
            <ExpressionFields
              sheets={sheets}
              sheetOrder={sheetOrder}
              state={expression}
              setState={setExpression}
              message={expressionMessage}
              openSelector={openSelector}
              setOpenSelector={setOpenSelector}
              firstSelectorRef={firstSelectorRef}
            />
          )}
        </div>
        <div className="merge-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="merge-submit" disabled={!canSubmit || submitting}>
            {(() => {
              const activeTab = TABS.find(({ id }) => id === tab);
              const label = activeTab.submitLabel ?? activeTab.label;
              return submitting ? `${label}...` : label;
            })()}
          </button>
        </div>
      </form>
    </div>
  );
}

export default MergePanel;
