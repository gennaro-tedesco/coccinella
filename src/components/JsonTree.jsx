import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  encodedAncestorPaths,
  encodedRowSchemaPath,
  flattenJsonTree,
  JSON_ARRAY_ITEM_PATH_SEGMENT,
  JSON_ROOT_PATH,
  resolveJsonNavigationPath,
} from "../utils/jsonTree";
import {
  FALLBACK_ROW_HEIGHT_PX,
  GO_TO_LINE_HIGHLIGHT_MS,
  ICON_SIZE_COMPACT,
  JSON_TREE_OVERSCAN_ROWS,
  ROW_HEIGHT_CHANGE_THRESHOLD_PX,
} from "../constants";

const NO_OVERRIDES = new Map();

function JsonRow({ row, className, onToggle, children }) {
  const summary = row.type === "array" ? `${row.size} items` : `${row.size} keys`;
  return (
    <li className="json-node" style={{ "--json-depth": row.depth }}>
      <div className={className}>
        {row.expandable ? (
          <button
            type="button"
            className="json-node-toggle"
            aria-label={`${row.expanded ? "Collapse" : "Expand"} ${row.label}`}
            onClick={onToggle}
          >
            {row.expanded ? (
              <ChevronDown size={ICON_SIZE_COMPACT} />
            ) : (
              <ChevronRight size={ICON_SIZE_COMPACT} />
            )}
          </button>
        ) : (
          <span className="json-node-spacer" />
        )}
        {row.expandable ? (
          <button
            type="button"
            className="json-key json-key-trigger"
            aria-expanded={row.expanded}
            onClick={onToggle}
          >
            {row.label}
          </button>
        ) : (
          <span className="json-key">{row.label}</span>
        )}
        <span className="json-separator">:</span>
        <span className={`json-value json-${row.type}`}>
          {row.expandable ? summary : JSON.stringify(row.value)}
        </span>
      </div>
      {children}
    </li>
  );
}

function treeScrollGeometry(tree) {
  const scroller = tree?.closest(".content");
  if (!scroller) return null;
  const treeTop =
    tree.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop;
  return { scroller, treeTop };
}

function JsonTree() {
  const treeRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const navigation = useAppStore((state) => state.jsonNavigation);
  const clearNavigation = useAppStore((state) => state.clearJsonNavigation);
  const searchMatches = useAppStore((state) => state.jsonSearchMatches);
  const activeSearchMatch = useAppStore((state) => state.activeSearchMatch);
  const activeSearchPath = activeSearchMatch?.path ?? null;
  const [openState, setOpenState] = useState({ sheetId: null, overrides: NO_OVERRIDES });
  const [pendingFocus, setPendingFocus] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [firstVisibleRow, setFirstVisibleRow] = useState(0);
  const [viewportRows, setViewportRows] = useState(0);
  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW_HEIGHT_PX);
  const sheetId = sheet?.kind === "json" ? sheet.id : null;
  const overrides = openState.sheetId === sheetId ? openState.overrides : NO_OVERRIDES;
  const rows = useMemo(
    () => (sheetId ? flattenJsonTree(sheet.data, overrides) : []),
    [sheetId, sheet?.data, overrides],
  );
  const searchMatchPaths = useMemo(
    () => new Set(searchMatches.map((match) => JSON.stringify(match.path))),
    [searchMatches],
  );
  const activeSearchEncodedPath = activeSearchPath ? JSON.stringify(activeSearchPath) : null;

  function updateOverrides(update) {
    setOpenState((current) => {
      const next = new Map(current.sheetId === sheetId ? current.overrides : NO_OVERRIDES);
      update(next);
      return { sheetId, overrides: next };
    });
  }

  function expandAncestors(paths, includeSelf) {
    updateOverrides((next) => {
      for (const path of paths) {
        for (const encodedPath of encodedAncestorPaths(path, includeSelf)) {
          next.set(encodedPath, true);
        }
      }
    });
  }

  useEffect(() => {
    if (!navigation || navigation.sheetId !== sheetId) return;
    clearNavigation();
    const { schemaPath } = navigation;
    const range = schemaPath.at(-1) === JSON_ARRAY_ITEM_PATH_SEGMENT;
    const firstPath = resolveJsonNavigationPath(sheet.data, schemaPath);
    if (!firstPath) return;
    expandAncestors([firstPath], range);
    setPendingFocus({
      target: JSON.stringify(firstPath),
      highlight: {
        schemaPath: JSON.stringify(range ? schemaPath.slice(0, -1) : schemaPath),
        range,
      },
    });
  }, [navigation, sheetId, clearNavigation]);

  useEffect(() => {
    if (!activeSearchPath) return;
    expandAncestors([activeSearchPath], false);
    setPendingFocus({ target: JSON.stringify(activeSearchPath), highlight: null });
  }, [activeSearchPath]);

  useEffect(() => {
    if (!pendingFocus) return;
    setPendingFocus(null);
    const geometry = treeScrollGeometry(treeRef.current);
    const index = pendingFocus.target === JSON_ROOT_PATH
      ? 0
      : rows.findIndex((row) => row.encodedPath === pendingFocus.target);
    if (!geometry || index < 0) return;
    geometry.scroller.scrollTo({
      top: Math.max(0, geometry.treeTop + index * rowHeight),
      behavior: "smooth",
    });
    if (!pendingFocus.highlight) return;
    setHighlight((current) => ({
      ...pendingFocus.highlight,
      generation: (current?.generation ?? 0) + 1,
    }));
    window.clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = window.setTimeout(
      () => setHighlight(null),
      GO_TO_LINE_HIGHLIGHT_MS,
    );
  }, [pendingFocus, rows, rowHeight]);

  useEffect(() => () => window.clearTimeout(highlightTimeoutRef.current), []);

  useEffect(() => {
    const tree = treeRef.current;
    const scroller = tree?.closest(".content");
    if (!scroller) return undefined;
    function updateWindow() {
      const geometry = treeScrollGeometry(tree);
      setFirstVisibleRow(
        Math.floor(Math.max(0, scroller.scrollTop - geometry.treeTop) / rowHeight),
      );
      setViewportRows(Math.ceil(scroller.clientHeight / rowHeight));
    }
    updateWindow();
    scroller.addEventListener("scroll", updateWindow, { passive: true });
    const observer = new ResizeObserver(updateWindow);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", updateWindow);
      observer.disconnect();
    };
  }, [sheetId, rowHeight]);

  const windowStart = Math.min(
    rows.length,
    Math.max(0, firstVisibleRow - JSON_TREE_OVERSCAN_ROWS),
  );
  const windowEnd = Math.min(
    rows.length,
    firstVisibleRow + viewportRows + JSON_TREE_OVERSCAN_ROWS,
  );

  useEffect(() => {
    const row = treeRef.current?.querySelector(".json-node");
    if (!row) return undefined;
    function measure() {
      const measured = row.getBoundingClientRect().height;
      setRowHeight((current) =>
        measured && Math.abs(measured - current) > ROW_HEIGHT_CHANGE_THRESHOLD_PX
          ? measured
          : current,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [rows, windowStart]);

  const subtreeEnds = useMemo(() => new Map(), [rows]);

  if (!sheetId) return null;

  function matchesHighlight(rowIndex) {
    return encodedRowSchemaPath(rows, rowIndex) === highlight.schemaPath;
  }

  function subtreeEnd(start) {
    if (!subtreeEnds.has(start)) {
      let end = start + 1;
      while (end < rows.length && rows[end].depth > rows[start].depth) end += 1;
      subtreeEnds.set(start, end);
    }
    return subtreeEnds.get(start);
  }

  const highlightsTree = Boolean(highlight?.range && highlight.schemaPath === JSON_ROOT_PATH);
  const rangeAnchors = new Map();
  if (highlight?.range && !highlightsTree) {
    const addRange = (start, anchor) => {
      rangeAnchors.set(anchor, [
        ...(rangeAnchors.get(anchor) ?? []),
        { start, end: subtreeEnd(start), depth: rows[start].depth, anchor },
      ]);
    };
    for (
      let ancestor = rows[windowStart]?.parent ?? -1;
      ancestor >= 0;
      ancestor = rows[ancestor].parent
    ) {
      if (matchesHighlight(ancestor)) addRange(ancestor, windowStart);
    }
    for (let rowIndex = windowStart; rowIndex < windowEnd; rowIndex += 1) {
      if (matchesHighlight(rowIndex)) addRange(rowIndex, rowIndex);
    }
  }

  const visibleRows = [];
  for (let rowIndex = windowStart; rowIndex < windowEnd; rowIndex += 1) {
    const row = rows[rowIndex];
    const highlighted = Boolean(
      highlight && !highlight.range && matchesHighlight(rowIndex),
    );
    const className = [
      "json-node-row",
      searchMatchPaths.has(row.encodedPath) && "search-match",
      row.encodedPath === activeSearchEncodedPath && "search-match-active",
      highlighted && "go-to-line-highlight",
    ]
      .filter(Boolean)
      .join(" ");
    visibleRows.push(
      <JsonRow
        key={highlighted ? `${highlight.generation}:${row.encodedPath}` : row.encodedPath}
        row={row}
        className={className}
        onToggle={() =>
          updateOverrides((next) => next.set(row.encodedPath, !row.expanded))
        }
      >
        {rangeAnchors.get(rowIndex)?.map((range) => (
          <div
            key={`${highlight.generation}:${range.start}`}
            className="json-range-highlight go-to-line-highlight"
            aria-hidden="true"
            style={{
              "--json-depth": range.depth,
              height: (range.end - range.anchor) * rowHeight,
            }}
          />
        ))}
      </JsonRow>,
    );
  }

  return (
    <ul
      className="json-tree"
      ref={treeRef}
      style={{ "--go-to-line-highlight-duration": `${GO_TO_LINE_HIGHLIGHT_MS}ms` }}
    >
      {windowStart > 0 && (
        <li className="virtual-spacer" aria-hidden="true" style={{ height: windowStart * rowHeight }} />
      )}
      {highlightsTree && (
        <li
          key={highlight.generation}
          className="json-tree-highlight go-to-line-highlight"
          aria-hidden="true"
        />
      )}
      {visibleRows}
      {windowEnd < rows.length && (
        <li
          className="virtual-spacer"
          aria-hidden="true"
          style={{ height: (rows.length - windowEnd) * rowHeight }}
        />
      )}
    </ul>
  );
}

export default JsonTree;
