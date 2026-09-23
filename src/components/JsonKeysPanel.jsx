import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  buildJsonKeyTree,
  JSON_ARRAY_ITEM_PATH_SEGMENT,
  resolveJsonNavigationTargets,
} from "../utils/jsonTree";
import { formatBytes } from "../utils/stats";
import { ICON_SIZE_COMPACT, ICON_SIZE_DEFAULT } from "../constants";

function KeyNode({ label, schema, schemaPath, sheet, navigate, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2);
  const children = Object.entries(schema.children ?? {});
  if (schema.item) children.unshift([JSON_ARRAY_ITEM_PATH_SEGMENT, schema.item]);
  const expandable = children.length > 0;

  return (
    <li className="column-row json-key-node">
      <div className="column-row-content">
        <button
          type="button"
          className="column-name json-key-name"
          onClick={() => {
            const targets = resolveJsonNavigationTargets(
              sheet.data,
              schemaPath,
            );
            if (targets.paths.length > 0) {
              navigate(sheet.id, targets.paths, targets.range);
            }
            if (expandable) setOpen((current) => !current);
          }}
        >
          <span className="json-key-label">{label}</span>
        </button>
        {expandable && (
          <button
            type="button"
            className="th-settings-trigger json-key-toggle"
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((current) => !current);
            }}
          >
            {open ? (
              <ChevronDown size={ICON_SIZE_COMPACT} />
            ) : (
              <ChevronRight size={ICON_SIZE_COMPACT} />
            )}
          </button>
        )}
      </div>
      {expandable && open && (
        <ul className="json-key-children">
          {children.map(([key, child], index) => (
            <KeyNode
              key={`${key}:${index}`}
              label={key === JSON_ARRAY_ITEM_PATH_SEGMENT ? "[]" : key}
              schema={child}
              schemaPath={[...schemaPath, key]}
              sheet={sheet}
              navigate={navigate}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function rootKeyEntries(schema) {
  const entries = Object.entries(schema.children ?? {});
  if (schema.item) entries.unshift([JSON_ARRAY_ITEM_PATH_SEGMENT, schema.item]);
  return entries;
}

function JsonKeysPanel() {
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const panelOpen = useAppStore((state) => state.columnPanelOpen);
  const togglePanel = useAppStore((state) => state.toggleColumnPanel);
  const navigate = useAppStore((state) => state.navigateToJsonKey);
  const schema = useMemo(
    () => (sheet?.kind === "json" ? buildJsonKeyTree(sheet.data) : null),
    [sheet],
  );

  if (!panelOpen) {
    return (
      <div className="column-panel collapsed">
        <button type="button" className="panel-toggle" aria-label="Open keys panel" onClick={togglePanel}>
          <ChevronLeft size={ICON_SIZE_DEFAULT} />
        </button>
      </div>
    );
  }
  if (!sheet || sheet.kind !== "json") return null;
  const entries = rootKeyEntries(schema);

  return (
    <div className="column-panel json-keys-panel">
      <div className="sheet-summary">
        <div className="sheet-summary-stats">
          <div>
            <span className="sheet-summary-value">{entries.length.toLocaleString()}</span>{" "}
            {entries.length === 1 ? "key" : "keys"}
          </div>
          <div><span className="sheet-summary-value">JSON</span></div>
          <div><span className="sheet-summary-value">{formatBytes(sheet.sizeBytes ?? 0)}</span></div>
        </div>
      </div>
      <ul className="column-list json-key-tree">
        {entries.length > 0 ? (
          entries.map(([key, child], index) => (
            <KeyNode
              key={`${key}:${index}`}
              label={key === JSON_ARRAY_ITEM_PATH_SEGMENT ? "[]" : key}
              schema={child}
              schemaPath={[key]}
              sheet={sheet}
              navigate={navigate}
            />
          ))
        ) : (
          <KeyNode
            label="value"
            schema={schema}
            schemaPath={[]}
            sheet={sheet}
            navigate={navigate}
          />
        )}
      </ul>
      <div className="panel-header">
        <button type="button" className="panel-toggle" aria-label="Close keys panel" onClick={togglePanel}>
          <ChevronRight size={ICON_SIZE_DEFAULT} />
        </button>
        <div />
      </div>
    </div>
  );
}

export default JsonKeysPanel;
