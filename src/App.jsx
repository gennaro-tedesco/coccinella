import { useEffect } from "react";
import "./App.css";
import { useAppStore } from "./store/useAppStore";
import TopBar from "./components/TopBar";
import SheetPanel from "./components/SheetPanel";
import FileTabs from "./components/FileTabs";
import DataTable from "./components/DataTable";
import ColumnPanel from "./components/ColumnPanel";
import ChartBuilder from "./components/ChartBuilder";
import EmptyState from "./components/EmptyState";

function App() {
  const mode = useAppStore((state) => state.mode);
  const theme = useAppStore((state) => state.theme);
  const sheetPanelOpen = useAppStore((state) => state.sheetPanelOpen);
  const columnPanelOpen = useAppStore((state) => state.columnPanelOpen);
  const hasSheets = useAppStore((state) => state.sheetOrder.length > 0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
              {mode === "data" ? <DataTable /> : <ChartBuilder />}
            </div>
          </div>
          {mode === "data" && <ColumnPanel />}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

export default App;
