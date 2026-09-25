// Renders the application workspace and handles global keyboard shortcuts.
// FEATURE: Data workspace
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.scss";
import { useAppStore } from "./store/useAppStore";
import TopBar from "./components/TopBar";
import SheetPanel from "./components/SheetPanel";
import FileTabs from "./components/FileTabs";
import FilterTabs from "./components/FilterTabs";
import SearchPanel from "./components/SearchPanel";
import DataTable from "./components/DataTable";
import ColumnPanel from "./components/ColumnPanel";
import JsonTree from "./components/JsonTree";
import JsonKeysPanel from "./components/JsonKeysPanel";
import EmptyState from "./components/EmptyState";
import FuzzyFinder from "./components/FuzzyFinder";
import GoToLine from "./components/GoToLine";
import MergePanel from "./components/MergePanel";
import { openFile, openFileAtPath } from "./utils/openFile";
import { ErrorSnackbar } from "./components/Snackbar";
import LazyErrorBoundary from "./components/LazyErrorBoundary";
import FileLoadOverlay from "./components/FileLoadOverlay";
import { useJsonSearchWorker } from "./hooks/useJsonSearchWorker";
import {
  DEFAULT_FONT_SIZE,
  FALLBACK_ROW_HEIGHT_PX,
  FONT_SIZE_STEP,
  FILE_FINDER_CACHE_WINDOW_MS,
  GO_TO_LINE_CONTEXT_ROWS,
  GO_TO_LINE_HIGHLIGHT_MS,
  GO_TO_LINE_ROW_HEIGHT_PX,
  HALF_PAGE_SCROLL_RATIO,
  HORIZONTAL_SCROLL_PX,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  PANEL_WIDTH_PX,
  SEARCH_DEBOUNCE_MS,
  COLLAPSED_PANEL_WIDTH_PX,
  COLUMN_PANEL_WIDTH_PX,
  HIDDEN_PANEL_WIDTH_PX,
} from "./constants";

const ChartBuilder = lazy(() => import("./components/ChartBuilder"));
const getPathLabel = (candidate) => candidate.path;
const getPathGroup = (candidate) => {
  const slashIndex = candidate.path.lastIndexOf("/");
  return slashIndex === -1 ? "" : candidate.path.slice(0, slashIndex);
};
const getSheetLabel = (id) => useAppStore.getState().sheets[id]?.filename ?? "";

function App() {
  const mode = useAppStore((state) => state.mode);
  const theme = useAppStore((state) => state.previewTheme ?? state.theme);
  const sheetPanelOpen = useAppStore((state) => state.sheetPanelOpen);
  const columnPanelOpen = useAppStore((state) => state.columnPanelOpen);
  const toggleSheetPanel = useAppStore((state) => state.toggleSheetPanel);
  const toggleColumnPanel = useAppStore((state) => state.toggleColumnPanel);
  const hasSheets = useAppStore((state) => state.sheetOrder.length > 0);
  const sheets = useAppStore((state) => state.sheets);
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const openSheet = useAppStore((state) => state.openSheet);
  const openJson = useAppStore((state) => state.openJson);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);
  const switchToPreviousSheet = useAppStore(
    (state) => state.switchToPreviousSheet,
  );
  const searchOpen = useAppStore((state) => state.searchOpen);
  const openSearch = useAppStore((state) => state.openSearch);
  const closeSearch = useAppStore((state) => state.closeSearch);
  const openShortcutsMenu = useAppStore((state) => state.openShortcutsMenu);
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
  const setSearchMatchCount = useAppStore(
    (state) => state.setSearchMatchCount,
  );
  const setActiveSearchMatch = useAppStore(
    (state) => state.setActiveSearchMatch,
  );
  const setSearchError = useAppStore((state) => state.setSearchError);
  const jsonSearchMatches = useAppStore((state) => state.jsonSearchMatches);
  const setJsonSearchMatches = useAppStore(
    (state) => state.setJsonSearchMatches,
  );
  const errorMessage = useAppStore((state) => state.errorMessage);
  const showError = useAppStore((state) => state.showError);
  const clearError = useAppStore((state) => state.clearError);
  const createFilteredSheet = useAppStore(
    (state) => state.createFilteredSheet,
  );
  const searchJson = useJsonSearchWorker();

  const activeSheet = activeSheetId ? sheets[activeSheetId] : null;
  const isJson = activeSheet?.kind === "json";
  const csvDataMode = mode === "data" && !isJson;
  const searchMatchCount = useAppStore((state) => state.searchMatchCount);
  const canFilterFromSearch = !isJson && searchMatchCount > 0;

  const [finder, setFinder] = useState(null);
  const [csvFiles, setCsvFiles] = useState(null);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTab, setMergeTab] = useState(null);
  const contentRef = useRef(null);
  const dataTableRef = useRef(null);
  const highlightedLineRef = useRef(null);
  const highlightTimeoutRef = useRef(null);
  const pendingGRef = useRef(false);
  const fileScanRef = useRef(null);
  const csvFilesRef = useRef(null);
  const lastFileFinderInvocationRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let active = true;
    let unlisten;

    async function openPendingFiles() {
      const candidates = await invoke("take_opened_files");
      if (!active) return;
      for (const candidate of candidates) {
        await openFileAtPath(candidate, openSheet, openJson);
      }
    }

    listen("open-files", () => {
      void openPendingFiles().catch(showError);
    })
      .then((stopListening) => {
        if (!active) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        void openPendingFiles().catch(showError);
      })
      .catch(showError);

    return () => {
      active = false;
      unlisten?.();
    };
  }, [openSheet, openJson, showError]);

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
    if (!csvDataMode) setGoToLineOpen(false);
    if (!csvDataMode) setMergeOpen(false);
    pendingGRef.current = false;
  }, [activeSheetId, csvDataMode]);

  useEffect(() => {
    if (mode !== "data") closeSearch();
  }, [mode, closeSearch]);

  useEffect(() => {
    let cancelled = false;
    if (!activeSheet) {
      setSearchMatchCount(0);
      setActiveSearchMatch(null);
      setJsonSearchMatches([]);
      return undefined;
    }
    setSearchMatchCount(0);
    setActiveSearchMatch(null);
    setSearchError(null);
    let timeout;
    if (isJson) {
      if (!searchQuery) {
        setJsonSearchMatches([]);
        return undefined;
      }
      timeout = window.setTimeout(() => {
        searchJson(
          activeSheet.data,
          searchQuery,
          searchIsRegex,
          searchIsCaseSensitive,
        )
          .then((matches) => {
            if (!cancelled) {
              setJsonSearchMatches(matches);
              setSearchMatchCount(matches.length);
            }
          })
          .catch((error) => {
            if (!cancelled) {
              setJsonSearchMatches([]);
              setSearchMatchCount(0);
              setSearchError(String(error));
            }
          });
      }, SEARCH_DEBOUNCE_MS);
      return () => {
        cancelled = true;
        window.clearTimeout(timeout);
      };
    }
    setJsonSearchMatches([]);
    invoke("invalidate_search", { datasetId: activeSheet.datasetId })
      .then(() => {
        if (cancelled) return;
        timeout = window.setTimeout(() => {
          invoke("search_dataset", {
            datasetId: activeSheet.datasetId,
            pattern: searchQuery,
            isRegex: searchIsRegex,
            isCaseSensitive: searchIsCaseSensitive,
            columns: activeSheet.selectedColumns,
          })
            .then((count) => {
              if (!cancelled) setSearchMatchCount(count);
            })
            .catch((error) => {
              if (!cancelled) {
                setSearchMatchCount(0);
                setSearchError(String(error));
              }
            });
        }, searchQuery ? SEARCH_DEBOUNCE_MS : 0);
      })
      .catch((error) => {
        if (!cancelled) setSearchError(String(error));
      });
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [
    activeSheet?.datasetId,
    activeSheet?.data,
    isJson,
    activeSheet?.dataVersion,
    activeSheet?.selectedColumns,
    searchQuery,
    searchIsRegex,
    searchIsCaseSensitive,
    setSearchMatchCount,
    setActiveSearchMatch,
    setSearchError,
    setJsonSearchMatches,
    searchJson,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!activeSheet || searchMatchCount === 0) {
      setActiveSearchMatch(null);
      return undefined;
    }
    if (isJson) {
      setActiveSearchMatch(
        jsonSearchMatches[searchActiveIndex % searchMatchCount] ?? null,
      );
      return undefined;
    }
    invoke("get_search_match", {
      datasetId: activeSheet.datasetId,
      index: searchActiveIndex % searchMatchCount,
    })
      .then((match) => {
        if (!cancelled) setActiveSearchMatch(match);
      })
      .catch((error) => {
        if (!cancelled) showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeSheet?.datasetId,
    isJson,
    jsonSearchMatches,
    searchActiveIndex,
    searchMatchCount,
    setActiveSearchMatch,
    showError,
  ]);

  useEffect(() => {
    async function openFileFinder() {
      try {
        setFinder("files");
        const invokedAt = performance.now();
        const previousInvocation = lastFileFinderInvocationRef.current;
        if (fileScanRef.current) return;
        lastFileFinderInvocationRef.current = invokedAt;

        const hasCachedFiles =
          csvFilesRef.current !== null &&
          previousInvocation !== null &&
          invokedAt - previousInvocation <= FILE_FINDER_CACHE_WINDOW_MS;
        const discoveredFiles = [];
        if (!hasCachedFiles) setCsvFiles([]);
        const onFiles = new Channel();
        onFiles.onmessage = (files) => {
          discoveredFiles.push(...files);
          if (!hasCachedFiles) setCsvFiles([...discoveredFiles]);
        };
        const scan = invoke("list_data_files", { onFiles });
        fileScanRef.current = scan;
        try {
          await scan;
          csvFilesRef.current = discoveredFiles;
          setCsvFiles(discoveredFiles);
        } catch (error) {
          showError(error);
          if (!hasCachedFiles) {
            setCsvFiles(null);
            setFinder(null);
            await openFile(openSheet, openJson);
          }
        } finally {
          fileScanRef.current = null;
        }
      } catch (error) {
        showError(error);
      }
    }

    function handleKeyDown(event) {
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select, button"));
      if (mergeOpen) return;
      if (
        isEditing ||
        !csvDataMode ||
        event.key !== "g" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        pendingGRef.current = false;
      }

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
        csvDataMode &&
        sheetOrder.length >= 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key === "="
      ) {
        event.preventDefault();
        closeSearch();
        setGoToLineOpen(false);
        setFinder(null);
        setMergeTab(null);
        setMergeOpen(true);
        return;
      }

      if (
        !isEditing &&
        csvDataMode &&
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
        csvDataMode &&
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
        event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        /^Digit[1-9]$/.test(event.code)
      ) {
        const sheetId = sheetOrder[Number(event.code.at(-1)) - 1];
        if (sheetId) {
          event.preventDefault();
          setActiveSheetId(sheetId);
        }
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
          increasing
            ? Math.min(size + FONT_SIZE_STEP, MAX_FONT_SIZE)
            : Math.max(size - FONT_SIZE_STEP, MIN_FONT_SIZE),
        );
        return;
      }

      const content = contentRef.current;
      if (!isEditing && csvDataMode && content) {
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          (event.key === "g" || event.key === "G")
        ) {
          event.preventDefault();
          if (event.repeat) return;

          if (event.key === "G") {
            pendingGRef.current = false;
            dataTableRef.current?.scrollToBottom();
          } else if (pendingGRef.current) {
            pendingGRef.current = false;
            dataTableRef.current?.scrollToTop();
          } else {
            pendingGRef.current = true;
          }
          return;
        }
        pendingGRef.current = false;

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
          content.scrollBy({
            top: direction * content.clientHeight * HALF_PAGE_SCROLL_RATIO,
          });
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
              ?.getBoundingClientRect().height ?? FALLBACK_ROW_HEIGHT_PX;
          const movement = {
            h: { left: -HORIZONTAL_SCROLL_PX },
            j: { top: rowHeight },
            k: { top: -rowHeight },
            l: { left: HORIZONTAL_SCROLL_PX },
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
          setFontSize((size) =>
            Math.min(size + FONT_SIZE_STEP, MAX_FONT_SIZE),
          );
          return;
        }
        if (event.code === "Minus" || event.key === "_") {
          event.preventDefault();
          setFontSize((size) =>
            Math.max(size - FONT_SIZE_STEP, MIN_FONT_SIZE),
          );
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

      if (event.key === "F1") {
        event.preventDefault();
        openShortcutsMenu();
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
    sheetOrder,
    mergeOpen,
    mode,
    csvDataMode,
    openSheet,
    openJson,
    switchToPreviousSheet,
    toggleSheetPanel,
    toggleColumnPanel,
    openSearch,
    closeSearch,
    openShortcutsMenu,
    setActiveSheetId,
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
    showError,
  ]);

  function handleGoToLine(line) {
    const content = contentRef.current;
    const target = content?.querySelector(`[data-source-line="${line}"]`);
    if (!content) return;
    if (!target) {
      const rowHeight =
        content
          .querySelector(".data-table tbody tr[data-row-index]")
          ?.getBoundingClientRect().height ?? GO_TO_LINE_ROW_HEIGHT_PX;
      content.scrollTo({
        top: Math.max(0, line - GO_TO_LINE_CONTEXT_ROWS) * rowHeight,
      });
      setGoToLineOpen(false);
      return;
    }

    window.clearTimeout(highlightTimeoutRef.current);
    highlightedLineRef.current?.classList.remove("go-to-line-highlight");
    highlightedLineRef.current?.style.removeProperty(
      "--go-to-line-highlight-duration",
    );

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

    content.scrollTo({
      top: Math.min(scrollTop, maxScrollTop),
      behavior: "smooth",
    });
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

  const rightWidth =
    mode === "data"
      ? columnPanelOpen
        ? `${COLUMN_PANEL_WIDTH_PX}px`
        : `${COLLAPSED_PANEL_WIDTH_PX}px`
      : columnPanelOpen
        ? `${COLLAPSED_PANEL_WIDTH_PX}px`
        : `${HIDDEN_PANEL_WIDTH_PX}px`;

  return (
    <div className="app">
      <TopBar
        onOpenSearch={() => {
          setMergeOpen(false);
          setGoToLineOpen(false);
          openSearch();
        }}
        onOpenGoTo={() => {
          setMergeOpen(false);
          closeSearch();
          setGoToLineOpen(true);
        }}
        onOpenMerge={(tab) => {
          closeSearch();
          setGoToLineOpen(false);
          setFinder(null);
          setMergeTab(tab ?? null);
          setMergeOpen(true);
        }}
      />
      {hasSheets ? (
        <div
          className="main"
          style={{
            gridTemplateColumns: `${sheetPanelOpen ? `${PANEL_WIDTH_PX}px` : `${COLLAPSED_PANEL_WIDTH_PX}px`} 1fr ${rightWidth}`,
          }}
        >
          <SheetPanel />
          <div className="center">
            <FileTabs />
            {csvDataMode && <FilterTabs />}
            <div className="content" ref={contentRef}>
              {mode === "data" ? (
                isJson ? <JsonTree /> : <DataTable ref={dataTableRef} />
              ) : (
                <LazyErrorBoundary>
                  <Suspense fallback={<div className="chart-builder-placeholder">Loading chart tools...</div>}>
                    <ChartBuilder fontSize={fontSize} />
                  </Suspense>
                </LazyErrorBoundary>
              )}
            </div>
          </div>
          {mode === "data" ? (
            isJson ? <JsonKeysPanel /> : <ColumnPanel />
          ) : (
            <div className="plot-margin" />
          )}
        </div>
      ) : (
        <EmptyState />
      )}
      {finder === "files" && (
        <FuzzyFinder
          placeholder="Open file..."
          items={csvFiles ?? []}
          getLabel={getPathLabel}
          getGroup={getPathGroup}
          onSelect={(candidate) => {
            setFinder(null);
            void openFileAtPath(candidate, openSheet, openJson).catch(showError);
          }}
          onClose={() => setFinder(null)}
        />
      )}
      {finder === "sheets" && (
        <FuzzyFinder
          placeholder="Go to sheet..."
          items={sheetOrder}
          getLabel={getSheetLabel}
          onSelect={(id) => {
            setFinder(null);
            setActiveSheetId(id);
          }}
          onClose={() => setFinder(null)}
        />
      )}
      {goToLineOpen && csvDataMode && activeSheetId && (
        <GoToLine
          maxLine={sheets[activeSheetId].rowCount + 1}
          onGoToLine={handleGoToLine}
          onClose={() => setGoToLineOpen(false)}
        />
      )}
      {searchOpen && mode === "data" && activeSheetId && <SearchPanel />}
      {mergeOpen && csvDataMode && (
        <MergePanel onClose={() => setMergeOpen(false)} initialTab={mergeTab} />
      )}
      <FileLoadOverlay />
      {errorMessage && (
        <ErrorSnackbar onClose={clearError}>{errorMessage}</ErrorSnackbar>
      )}
    </div>
  );
}

export default App;
