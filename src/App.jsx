// Renders the application workspace and handles global keyboard shortcuts.
// FEATURE: CSV data workspace
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";
import { useAppStore } from "./store/useAppStore";
import TopBar from "./components/TopBar";
import SheetPanel from "./components/SheetPanel";
import FileTabs from "./components/FileTabs";
import DataTable from "./components/DataTable";
import ColumnPanel from "./components/ColumnPanel";
import ChartBuilder from "./components/ChartBuilder";
import EmptyState from "./components/EmptyState";
import FuzzyFinder from "./components/FuzzyFinder";
import { openCsvFile, openCsvFileAtPath } from "./utils/openFile";

function App() {
  const mode = useAppStore((state) => state.mode);
  const theme = useAppStore((state) => state.theme);
  const sheetPanelOpen = useAppStore((state) => state.sheetPanelOpen);
  const columnPanelOpen = useAppStore((state) => state.columnPanelOpen);
  const hasSheets = useAppStore((state) => state.sheetOrder.length > 0);
  const sheets = useAppStore((state) => state.sheets);
  const sheetOrder = useAppStore((state) => state.sheetOrder);
  const openSheet = useAppStore((state) => state.openSheet);
  const setActiveSheetId = useAppStore((state) => state.setActiveSheetId);

  const [finder, setFinder] = useState(null);
  const [csvFiles, setCsvFiles] = useState(null);
  const [fontSize, setFontSize] = useState(14);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
    return () => document.documentElement.style.removeProperty("font-size");
  }, [fontSize]);

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
      if (
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
  }, [csvFiles, openSheet]);

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
            <div className="content">
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
    </div>
  );
}

export default App;
