import { useEffect } from "react";
import "./App.css";
import { useAppStore } from "./store/useAppStore";
import TopBar from "./components/TopBar";
import SheetPanel from "./components/SheetPanel";
import FileTabs from "./components/FileTabs";
import DataTable from "./components/DataTable";
import ColumnPanel from "./components/ColumnPanel";
import ChartBuilder from "./components/ChartBuilder";

function App() {
  const mode = useAppStore((state) => state.mode);
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <SheetPanel />
        <div className="center">
          <FileTabs />
          <div className="content">
            {mode === "data" ? <DataTable /> : <ChartBuilder />}
          </div>
        </div>
        {mode === "data" && <ColumnPanel />}
      </div>
    </div>
  );
}

export default App;
