import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { ICON_SIZE_SMALL } from "../constants";

const JOIN_TYPES = [
  { id: "left", label: "LEFT", description: "All rows from the first dataset" },
  { id: "inner", label: "INNER", description: "Only matching rows" },
  { id: "right", label: "RIGHT", description: "All rows from the second dataset" },
];

function commonColumns(left, right) {
  const rightColumns = new Set(right?.columns ?? []);
  return (left?.columns ?? []).filter((column) => rightColumns.has(column));
}

function JoinIcon({ type }) {
  return (
    <span className={`join-icon join-icon-${type}`} aria-hidden="true">
      <span />
      <span />
    </span>
  );
}

function DatasetSelector({
  value,
  ids,
  sheets,
  disabled,
  open,
  onToggle,
  onSelect,
  buttonRef,
}) {
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
        <span>{value ? sheets[value].filename : "Select a dataset"}</span>
        <ChevronDown size={ICON_SIZE_SMALL} />
      </button>
      {open && (
        <ul
          className="file-menu-dropdown merge-dataset-dropdown"
          onClick={(event) => event.stopPropagation()}
        >
          {ids.map((id) => (
            <li key={id}>
              <button
                type="button"
                className={id === value ? "active" : ""}
                onClick={() => onSelect(id)}
              >
                {sheets[id].filename}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ColumnSelector({ columns, values, open, onToggle, onChange }) {
  const allSelected = values.length === columns.length;
  const label = allSelected
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
        <ul
          className="file-menu-dropdown multi-field-dropdown merge-column-dropdown"
          onClick={(event) => event.stopPropagation()}
        >
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
                  onChange={() =>
                    onChange(
                      values.includes(column)
                        ? values.filter((selected) => selected !== column)
                        : [...values, column],
                    )
                  }
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

function MergePanel({ onClose }) {
  const sheets = useAppStore((state) => state.sheets);
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const createJoinedSheet = useAppStore((state) => state.createJoinedSheet);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [selectedColumns, setSelectedColumns] = useState([]);
  const [joinType, setJoinType] = useState("inner");
  const [submitting, setSubmitting] = useState(false);
  const [openSelector, setOpenSelector] = useState(null);
  const firstSelectorRef = useRef(null);

  useEffect(() => {
    firstSelectorRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!openSelector) return undefined;
    function closeSelector() {
      setOpenSelector(null);
    }
    document.addEventListener("click", closeSelector);
    return () => document.removeEventListener("click", closeSelector);
  }, [openSelector]);

  const compatibleIds = leftId
    ? sheetOrder.filter(
        (id) => id !== leftId && commonColumns(sheets[leftId], sheets[id]).length > 0,
      )
    : [];
  const columns = rightId ? commonColumns(sheets[leftId], sheets[rightId]) : [];

  function selectLeft(id) {
    setLeftId(id);
    setRightId("");
    setSelectedColumns([]);
  }

  function selectRight(id) {
    setRightId(id);
    setSelectedColumns(id ? commonColumns(sheets[leftId], sheets[id]) : []);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!leftId || !rightId || selectedColumns.length === 0 || submitting) return;
    setSubmitting(true);
    const created = await createJoinedSheet(
      leftId,
      rightId,
      selectedColumns,
      joinType,
    );
    setSubmitting(false);
    if (created) onClose();
  }

  return (
    <div className="fuzzy-finder-overlay merge-overlay" onMouseDown={onClose}>
      <form
        className="merge-panel"
        role="dialog"
        aria-labelledby="merge-title"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="merge-header">
          <div>
            <h2 id="merge-title">Merge datasets</h2>
            <p>Join two open datasets on matching columns.</p>
          </div>
          <button type="button" className="merge-close" aria-label="Close merge" onClick={onClose}>
            <X size={ICON_SIZE_SMALL} />
          </button>
        </div>

        <div className="merge-datasets">
          <div className="merge-dataset-field">
            <span>First dataset</span>
            <DatasetSelector
              buttonRef={firstSelectorRef}
              value={leftId}
              ids={sheetOrder}
              sheets={sheets}
              open={openSelector === "left"}
              onToggle={() =>
                setOpenSelector((current) => current === "left" ? null : "left")
              }
              onSelect={(id) => {
                selectLeft(id);
                setOpenSelector(null);
              }}
            />
          </div>
          <div className="merge-dataset-field">
            <span>Second dataset</span>
            <DatasetSelector
              value={rightId}
              disabled={!leftId || compatibleIds.length === 0}
              ids={compatibleIds}
              sheets={sheets}
              open={openSelector === "right"}
              onToggle={() =>
                setOpenSelector((current) => current === "right" ? null : "right")
              }
              onSelect={(id) => {
                selectRight(id);
                setOpenSelector(null);
              }}
            />
          </div>
        </div>

        {leftId && compatibleIds.length === 0 && (
          <div className="merge-empty">No files with columns to merge</div>
        )}

        {rightId && (
          <div className="merge-columns">
            <span>Merge on</span>
            <ColumnSelector
              columns={columns}
              values={selectedColumns}
              open={openSelector === "columns"}
              onToggle={() =>
                setOpenSelector((current) =>
                  current === "columns" ? null : "columns"
                )
              }
              onChange={setSelectedColumns}
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
                className={`merge-type${joinType === type.id ? " active" : ""}`}
                aria-pressed={joinType === type.id}
                onClick={() => setJoinType(type.id)}
              >
                <JoinIcon type={type.id} />
                <strong>{type.label}</strong>
                <span>{type.description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="merge-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            className="merge-submit"
            disabled={!leftId || !rightId || selectedColumns.length === 0 || submitting}
          >
            {submitting ? "Merging..." : "Merge"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default MergePanel;
