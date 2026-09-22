import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { ICON_SIZE_SMALL } from "../constants";

const TABS = [
  { id: "merge", label: "Merge" },
  { id: "append", label: "Append" },
  { id: "aggregate", label: "Aggregate" },
];

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

const CENTERED_RESIZE_FACTOR = 2;

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

function MergePanel({ onClose }) {
  const sheets = useAppStore((state) => state.sheets);
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const createJoinedSheet = useAppStore((state) => state.createJoinedSheet);
  const createAppendedSheet = useAppStore((state) => state.createAppendedSheet);
  const createAggregatedSheet = useAppStore((state) => state.createAggregatedSheet);
  const [tab, setTab] = useState(sheetOrder.length === 1 ? "aggregate" : "merge");
  const [merge, setMerge] = useState({ leftId: "", rightId: "", columns: [], joinType: "inner" });
  const [appendIds, setAppendIds] = useState([]);
  const [aggregate, setAggregate] = useState({
    datasetId: sheetOrder.length === 1 ? sheetOrder[0] : "",
    aggregations: {},
    groupBy: [],
    pivotTable: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [openSelector, setOpenSelector] = useState(null);
  const firstSelectorRef = useRef(null);
  const panelRef = useRef(null);
  const resizeRef = useRef(null);

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

  const canSubmit = tab === "merge"
    ? merge.leftId && merge.rightId && merge.columns.length > 0
    : tab === "append"
      ? appendIds.length >= 2
      : aggregate.datasetId
        && Object.keys(aggregate.aggregations).length > 0
        && (!aggregate.pivotTable
          || (Object.keys(aggregate.aggregations).length === 1 && aggregate.groupBy.length === 2));

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    let created;
    if (tab === "merge") {
      created = await createJoinedSheet(merge.leftId, merge.rightId, merge.columns, merge.joinType);
    } else if (tab === "append") {
      created = await createAppendedSheet(appendIds);
    } else {
      created = await createAggregatedSheet(
        aggregate.datasetId,
        Object.entries(aggregate.aggregations).map(([column, func]) => ({ column, function: func })),
        aggregate.groupBy,
        aggregate.pivotTable,
      );
    }
    setSubmitting(false);
    if (created) onClose();
  }

  function handleResizePointerDown(event) {
    const panel = panelRef.current;
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function handleResizePointerMove(event) {
    const resize = resizeRef.current;
    const panel = panelRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !panel) return;
    panel.style.width = `${Math.max(0, resize.width + ((resize.startX - event.clientX) * CENTERED_RESIZE_FACTOR))}px`;
    panel.style.height = `${Math.max(0, resize.height + event.clientY - resize.startY)}px`;
  }

  function stopResizing(event) {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null;
  }

  return (
    <div className="fuzzy-finder-overlay merge-overlay" onMouseDown={onClose}>
      <form
        ref={panelRef}
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
        </div>
        <div className="merge-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="merge-submit" disabled={!canSubmit || submitting}>
            {submitting ? `${TABS.find(({ id }) => id === tab).label}...` : TABS.find(({ id }) => id === tab).label}
          </button>
        </div>
        <span
          className="merge-resize-handle"
          aria-hidden="true"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={stopResizing}
          onPointerCancel={stopResizing}
          onLostPointerCapture={stopResizing}
        />
      </form>
    </div>
  );
}

export default MergePanel;
