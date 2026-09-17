// Renders the application workspace and handles global keyboard shortcuts.
// FEATURE: CSV data workspace
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { useAppStore } from "./store/useAppStore";
import { buildMatcher, findMatches } from "./utils/search";
import TopBar from "./components/TopBar";
import SheetPanel from "./components/SheetPanel";
import FileTabs from "./components/FileTabs";
import FilterTabs from "./components/FilterTabs";
import SearchPanel from "./components/SearchPanel";
import DataTable from "./components/DataTable";
import ColumnPanel from "./components/ColumnPanel";
import ChartBuilder from "./components/ChartBuilder";
import EmptyState from "./components/EmptyState";
import FuzzyFinder from "./components/FuzzyFinder";
import GoToLine from "./components/GoToLine";
import { openCsvFile, openCsvFileAtPath } from "./utils/openFile";

const GO_TO_LINE_HIGHLIGHT_MS = 2000;

function App() {
  const mode = useAppStore((state) => state.mode);
  const theme = useAppStore((state) => state.theme);
  const sheetPanelOpen = useAppStore((state) => state.sheetPanelOpen);
  const columnPanelOpen = useAppStore((state) => state.columnPanelOpen);
  const toggleSheetPanel = useAppStore((state) => state.toggleSheetPanel);
  const toggleColumnPanel = useAppStore((state) => state.toggleColumnPanel);
  const hasSheets = useAppStore((state) => state.sheetOrder.length > 0);
  const sheets = useAppStore((state) => state.sheets);
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const openSheet = useAppStore((state) => state.openSheet);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const switchToPreviousSheet = useAppStore(
    (state) => state.switchToPreviousSheet,
  );
  const searchOpen = useAppStore((state) => state.searchOpen);
  const openSearch = useAppStore((state) => state.openSearch);
  const closeSearch = useAppStore((state) => state.closeSearch);
  const searchQuery = useAppStore((state) => state.searchQuery);
  const searchIsRegex = useAppStore((state) => state.searchIsRegex);
  const searchIsCaseSensitive = useAppStore(
    (state) => state.searchIsCaseSensitive,
  );
  const searchActiveIndex = useAppStore((state) => state.searchActiveIndex);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const setSearchActiveIndex = useAppStore(
    (state) => state.setSearchActiveIndex,
  );
  const createFilteredSheet = useAppStore(
    (state) => state.createFilteredSheet,
  );

  const activeSheet = activeSheetId ? sheets[activeSheetId] : null;
  const searchMatchCount = useMemo(() => {
    const matcher = buildMatcher(
      searchQuery,
      searchIsRegex,
      searchIsCaseSensitive,
    );
    if (!matcher || !activeSheet) return 0;
    return findMatches(activeSheet.rows, activeSheet.columns, matcher).length;
  }, [searchQuery, searchIsRegex, searchIsCaseSensitive, activeSheet]);
  const canFilterFromSearch = searchMatchCount > 0 && !activeSheet?.filterOf;

  const [finder, setFinder] = useState(null);
  const [csvFiles, setCsvFiles] = useState(null);
  const [fontSize, setFontSize] = useState(14);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const contentRef = useRef(null);
  const highlightedLineRef = useRef(null);
  const highlightTimeoutRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    return () => document.documentElement.style.removeProperty("font-size");
  }, [fontSize]);

  useEffect(() => {
    return () => {
      window.clearTimeout(highlightTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (mode !== "data") setGoToLineOpen(false);
    contentRef.current?.style.removeProperty("padding-bottom");
  }, [activeSheetId, mode]);

  useEffect(() => {
    if (mode !== "data") closeSearch();
  }, [mode, closeSearch]);

  useEffect(() => {
    async function openFileFinder() {
      const fzfAvailable = await invoke("fzf_available");
      if (!fzfAvailable) {
        await openCsvFile(openSheet);
        return;
      }

      setFinder("files");
      if (csvFiles === null) {
        invoke("list_csv_files").then(setCsvFiles);
      }
    }

    function handleKeyDown(event) {
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"));

      if (
        mode === "data" &&
        !searchOpen &&
        searchQuery &&
        event.key === "Escape"
      ) {
        event.preventDefault();
        setSearchQuery("");
        return;
      }

      if (
        !isEditing &&
        mode === "data" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === ":"
      ) {
        event.preventDefault();
        closeSearch();
        setGoToLineOpen(true);
        return;
      }

      if (
        !isEditing &&
        mode === "data" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === "/"
      ) {
        event.preventDefault();
        setGoToLineOpen(false);
        openSearch();
        return;
      }

      if (
        !isEditing &&
        mode === "data" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "n" || event.key === "N") &&
        searchMatchCount > 0
      ) {
        event.preventDefault();
        setSearchActiveIndex(
          (searchActiveIndex +
            (event.key === "N" ? -1 : 1) +
            searchMatchCount) %
            searchMatchCount,
        );
        return;
      }

      if (
        !isEditing &&
        mode === "data" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === '"' &&
        canFilterFromSearch
      ) {
        event.preventDefault();
        createFilteredSheet(
          activeSheetId,
          searchQuery,
          searchIsRegex,
          searchIsCaseSensitive,
        );
        closeSearch();
        return;
      }

      if (
        !isEditing &&
        mode === "data" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === "z"
      ) {
        event.preventDefault();
        toggleSheetPanel();
        toggleColumnPanel();
        return;
      }

      if (
        !isEditing &&
        event.ctrlKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "^" || event.code === "Digit6")
      ) {
        event.preventDefault();
        if (!event.repeat) switchToPreviousSheet();
        return;
      }

      if (
        !isEditing &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.code === "Equal" ||
          event.code === "Minus" ||
          event.code === "NumpadAdd" ||
          event.code === "NumpadSubtract")
      ) {
        event.preventDefault();
        const increasing =
          event.code === "Equal" || event.code === "NumpadAdd";
        setFontSize((size) =>
          increasing ? Math.min(size + 1, 24) : Math.max(size - 1, 10),
        );
        return;
      }

      const content = contentRef.current;
      if (!isEditing && mode === "data" && content) {
        if (
          event.ctrlKey &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.altKey &&
          (event.key.toLowerCase() === "u" ||
            event.key.toLowerCase() === "d")
        ) {
          event.preventDefault();
          const direction = event.key.toLowerCase() === "u" ? -1 : 1;
          content.scrollBy({ top: direction * content.clientHeight * 0.5 });
          return;
        }

        if (
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.altKey &&
          "hjkl".includes(event.key)
        ) {
          event.preventDefault();
          const rowHeight =
            content
              .querySelector(".data-table tbody tr")
              ?.getBoundingClientRect().height ?? 32;
          const movement = {
            h: { left: -80 },
            j: { top: rowHeight },
            k: { top: -rowHeight },
            l: { left: 80 },
          };
          content.scrollBy(movement[event.key]);
          return;
        }
      }

      if (
        !isEditing &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        if (event.code === "Equal" || event.key === "+") {
          event.preventDefault();
          setFontSize((size) => Math.min(size + 1, 24));
          return;
        }
        if (event.code === "Minus" || event.key === "_") {
          event.preventDefault();
          setFontSize((size) => Math.max(size - 1, 10));
          return;
        }
      }

      if (
        !isEditing &&
        mode === "data" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === "f" || event.key === "F")
      ) {
        event.preventDefault();
        setGoToLineOpen(false);
        openSearch();
        return;
      }

      if (!event.ctrlKey) return;
      if (event.key === "p" || event.key === "P") {
        event.preventDefault();
        void openFileFinder();
      } else if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        setFinder("sheets");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    csvFiles,
    mode,
    openSheet,
    switchToPreviousSheet,
    toggleSheetPanel,
    toggleColumnPanel,
    openSearch,
    closeSearch,
    activeSheetId,
    searchOpen,
    searchQuery,
    searchIsRegex,
    searchIsCaseSensitive,
    searchActiveIndex,
    setSearchQuery,
    setSearchActiveIndex,
    searchMatchCount,
    canFilterFromSearch,
    createFilteredSheet,
  ]);

  function handleGoToLine(line) {
    const content = contentRef.current;
    const target = content?.querySelector(`[data-source-line="${line}"]`);
    if (!content || !target) return;

    window.clearTimeout(highlightTimeoutRef.current);
    highlightedLineRef.current?.classList.remove("go-to-line-highlight");
    highlightedLineRef.current?.style.removeProperty(
      "--go-to-line-highlight-duration",
    );

    content.style.removeProperty("padding-bottom");
    const baseScrollHeight = content.scrollHeight;
    const headerHeight =
      content.querySelector(".data-table thead")?.getBoundingClientRect()
        .height ?? 0;
    const targetTop =
      line === 1
        ? 0
        : content.scrollTop +
          target.getBoundingClientRect().top -
          content.getBoundingClientRect().top -
          headerHeight;
    const scrollTop = Math.max(0, targetTop);
    const maxScrollTop = Math.max(0, baseScrollHeight - content.clientHeight);

    if (scrollTop > maxScrollTop) {
      content.style.paddingBottom = `${scrollTop - maxScrollTop}px`;
    }

    content.scrollTo({ top: scrollTop, behavior: "smooth" });
    target.style.setProperty(
      "--go-to-line-highlight-duration",
      `${GO_TO_LINE_HIGHLIGHT_MS}ms`,
    );
    // Restart the fade when navigating to the same line repeatedly.
    void target.offsetWidth;
    target.classList.add("go-to-line-highlight");
    highlightedLineRef.current = target;
    highlightTimeoutRef.current = window.setTimeout(() => {
      target.classList.remove("go-to-line-highlight");
      target.style.removeProperty("--go-to-line-highlight-duration");
      if (highlightedLineRef.current === target) {
        highlightedLineRef.current = null;
      }
    }, GO_TO_LINE_HIGHLIGHT_MS);
    setGoToLineOpen(false);
  }

  const rightWidth = mode === "data" ? (columnPanelOpen ? "220px" : "32px") : "0px";

  return (
    <div className="app">
      <TopBar />
      {hasSheets ? (
        <div
          className="main"
          style={{
            gridTemplateColumns: `${sheetPanelOpen ? "200px" : "32px"} 1fr ${rightWidth}`,
          }}
        >
          <SheetPanel />
          <div className="center">
            <FileTabs />
            {mode === "data" && <FilterTabs />}
            <div className="content" ref={contentRef}>
              {mode === "data" ? (
                <DataTable />
              ) : (
                <ChartBuilder fontSize={fontSize} />
              )}
            </div>
          </div>
          {mode === "data" && <ColumnPanel />}
        </div>
      ) : (
        <EmptyState />
      )}
      {finder === "files" && (
        <FuzzyFinder
          placeholder="Open file..."
          items={csvFiles ?? []}
          getLabel={(path) => path}
          onSelect={(path) => {
            setFinder(null);
            openCsvFileAtPath(path, openSheet);
          }}
          onClose={() => setFinder(null)}
        />
      )}
      {finder === "sheets" && (
        <FuzzyFinder
          placeholder="Go to sheet..."
          items={sheetOrder.map((id) => sheets[id])}
          getLabel={(sheet) => sheet.filename}
          onSelect={(sheet) => {
            setFinder(null);
            setActiveSheetId(sheet.id);
          }}
          onClose={() => setFinder(null)}
        />
      )}
      {goToLineOpen && mode === "data" && activeSheetId && (
        <GoToLine
          maxLine={sheets[activeSheetId].rows.length + 1}
          onGoToLine={handleGoToLine}
          onClose={() => setGoToLineOpen(false)}
        />
      )}
      {searchOpen && mode === "data" && activeSheetId && <SearchPanel />}
    </div>
  );
}

export default App;
