import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { GO_TO_LINE_HIGHLIGHT_MS, ICON_SIZE_COMPACT } from "../constants";

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function pathIsAncestor(path, targetPath) {
  return (
    path.length < targetPath.length &&
    path.every((segment, index) => segment === targetPath[index])
  );
}

function pathsMatch(path, targetPath) {
  return (
    path.length === targetPath.length &&
    path.every((segment, index) => segment === targetPath[index])
  );
}

function JsonNode({
  label,
  value,
  path,
  navigationPaths,
  navigationRange,
  searchMatchPaths,
  activeSearchPath,
  depth = 0,
}) {
  const [open, setOpen] = useState(depth < 2);
  const type = valueType(value);
  const entries =
    type === "array"
      ? value.map((item, index) => [index, item])
      : type === "object"
        ? Object.entries(value)
        : null;
  const expandable = entries !== null;
  const forcedOpen =
    navigationPaths.length > 0 &&
    navigationPaths.some(
      (navigationPath) =>
        pathIsAncestor(path, navigationPath) ||
        (navigationRange && pathsMatch(path, navigationPath)),
    );
  useEffect(() => {
    if (forcedOpen) setOpen(true);
  }, [forcedOpen]);
  const expanded = open || forcedOpen;
  const summary =
    type === "array"
      ? `${entries.length} items`
      : `${entries?.length ?? 0} keys`;
  const encodedPath = JSON.stringify(path);
  const rowClassName = [
    "json-node-row",
    searchMatchPaths.has(encodedPath) && "search-match",
    activeSearchPath && pathsMatch(path, activeSearchPath) && "search-match-active",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className="json-node">
      <div className={rowClassName} data-json-path={encodedPath}>
        {expandable ? (
          <button
            type="button"
            className="json-node-toggle"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
            onClick={() => setOpen((current) => !current)}
          >
            {expanded ? (
              <ChevronDown size={ICON_SIZE_COMPACT} />
            ) : (
              <ChevronRight size={ICON_SIZE_COMPACT} />
            )}
          </button>
        ) : (
          <span className="json-node-spacer" />
        )}
        {expandable ? (
          <button
            type="button"
            className="json-key json-key-trigger"
            aria-expanded={expanded}
            onClick={() => setOpen((current) => !current)}
          >
            {label}
          </button>
        ) : (
          <span className="json-key">{label}</span>
        )}
        <span className="json-separator">:</span>
        <span className={`json-value json-${type}`}>
          {expandable ? summary : JSON.stringify(value)}
        </span>
      </div>
      {expandable && expanded && entries.length > 0 && (
        <ul className="json-children">
          {entries.map(([key, child]) => (
            <JsonNode
              key={key}
              label={String(key)}
              value={child}
              path={[...path, key]}
              navigationPaths={navigationPaths}
              navigationRange={navigationRange}
              searchMatchPaths={searchMatchPaths}
              activeSearchPath={activeSearchPath}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function JsonTree() {
  const treeRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  const highlightedNodesRef = useRef([]);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const navigation = useAppStore((state) => state.jsonNavigation);
  const clearNavigation = useAppStore((state) => state.clearJsonNavigation);
  const searchMatches = useAppStore((state) => state.jsonSearchMatches);
  const activeSearchMatch = useAppStore((state) => state.activeSearchMatch);
  const navigationPaths =
    navigation?.sheetId === sheet?.id ? navigation.paths : [];
  const navigationRange = Boolean(
    navigation?.sheetId === sheet?.id && navigation.range,
  );
  const activeSearchPath = activeSearchMatch?.path ?? null;
  const focusPaths =
    navigationPaths.length > 0
      ? navigationPaths
      : activeSearchPath
        ? [activeSearchPath]
        : [];
  const searchMatchPaths = useMemo(
    () => new Set(searchMatches.map((match) => JSON.stringify(match.path))),
    [searchMatches],
  );

  useEffect(() => {
    if (navigationPaths.length === 0) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const targets = navigationPaths
        .map((path) => {
          const encodedPath = JSON.stringify(path);
          const targetRow =
            path.length === 0
              ? treeRef.current
              : treeRef.current?.querySelector(
                  `[data-json-path="${CSS.escape(encodedPath)}"]`,
                );
          return navigationRange && path.length > 0
            ? targetRow?.closest(".json-node")
            : targetRow;
        })
        .filter(Boolean);
      const scroller = treeRef.current?.closest(".content");
      if (targets.length === 0 || !scroller) return;
      const firstTarget = targets[0];
      const scrollTop =
        scroller.scrollTop +
        firstTarget.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: Math.max(0, scrollTop), behavior: "smooth" });
      window.clearTimeout(highlightTimeoutRef.current);
      for (const node of highlightedNodesRef.current) {
        node.classList.remove("go-to-line-highlight");
        node.style.removeProperty("--go-to-line-highlight-duration");
      }
      for (const target of targets) {
        target.style.setProperty(
          "--go-to-line-highlight-duration",
          `${GO_TO_LINE_HIGHLIGHT_MS}ms`,
        );
        void target.offsetWidth;
        target.classList.add("go-to-line-highlight");
      }
      highlightedNodesRef.current = targets;
      highlightTimeoutRef.current = window.setTimeout(() => {
        for (const target of targets) {
          target.classList.remove("go-to-line-highlight");
          target.style.removeProperty("--go-to-line-highlight-duration");
        }
        highlightedNodesRef.current = [];
      }, GO_TO_LINE_HIGHLIGHT_MS);
      clearNavigation();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationPaths, navigationRange, clearNavigation]);

  useEffect(() => {
    if (!activeSearchPath) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const encodedPath = JSON.stringify(activeSearchPath);
      const target = treeRef.current?.querySelector(
        `[data-json-path="${CSS.escape(encodedPath)}"]`,
      );
      const scroller = treeRef.current?.closest(".content");
      if (!target || !scroller) return;
      const scrollTop =
        scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top;
      scroller.scrollTo({ top: Math.max(0, scrollTop), behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSearchPath]);

  useEffect(() => {
    return () => {
      window.clearTimeout(highlightTimeoutRef.current);
      for (const node of highlightedNodesRef.current) {
        node.classList.remove("go-to-line-highlight");
        node.style.removeProperty("--go-to-line-highlight-duration");
      }
    };
  }, []);
  if (!sheet || sheet.kind !== "json") return null;

  const rootType = valueType(sheet.data);
  const entries =
    rootType === "array"
      ? sheet.data.map((item, index) => [index, item])
      : rootType === "object"
        ? Object.entries(sheet.data)
        : null;

  return (
    <ul className="json-tree" ref={treeRef} data-json-path={JSON.stringify([])}>
      {entries?.length > 0 ? (
        entries.map(([key, value]) => (
          <JsonNode
            key={key}
            label={String(key)}
            value={value}
            path={[key]}
            navigationPaths={focusPaths}
            navigationRange={navigationRange}
            searchMatchPaths={searchMatchPaths}
            activeSearchPath={activeSearchPath}
          />
        ))
      ) : (
        <JsonNode
          label="value"
          value={sheet.data}
          path={[]}
          navigationPaths={focusPaths}
          navigationRange={navigationRange}
          searchMatchPaths={searchMatchPaths}
          activeSearchPath={activeSearchPath}
        />
      )}
    </ul>
  );
}

export default JsonTree;
