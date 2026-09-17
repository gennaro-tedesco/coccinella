import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { useAppStore } from "../store/useAppStore";

const Plot = createPlotlyComponent(Plotly);

const CHART_TYPES = ["scatter", "bar", "line"];

function ChartBuilder({ fontSize }) {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const plotConfig = useAppStore((state) =>
    state.activeSheetId ? state.plotConfig[state.activeSheetId] : null,
  );
  const setPlotConfig = useAppStore((state) => state.setPlotConfig);

  const config = sheet
    ? (plotConfig ?? {
        xColumn: sheet.columns[0] ?? "",
        yColumn: sheet.columns[1] ?? sheet.columns[0] ?? "",
        chartType: "scatter",
      })
    : null;
  const [chartData, setChartData] = useState({ xValues: [], yValues: [] });

  useEffect(() => {
    if (!sheet || !config?.xColumn || !config.yColumn) return undefined;
    let cancelled = false;
    invoke("get_chart_data", {
      datasetId: sheet.datasetId,
      xColumn: config.xColumn,
      yColumn: config.yColumn,
    }).then((result) => {
      if (!cancelled) setChartData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sheet, config?.xColumn, config?.yColumn]);

  if (!sheet) {
    return (
      <div className="chart-builder-placeholder">
        <p>No sheet selected</p>
      </div>
    );
  }

  function updateConfig(patch) {
    setPlotConfig(activeSheetId, { ...config, ...patch });
  }

  return (
    <div className="chart-builder">
      <div className="chart-controls">
        <label>
          X
          <select
            value={config.xColumn}
            onChange={(e) => updateConfig({ xColumn: e.target.value })}
          >
            {sheet.columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
        <label>
          Y
          <select
            value={config.yColumn}
            onChange={(e) => updateConfig({ yColumn: e.target.value })}
          >
            {sheet.columns.map((column) => (
              <option key={column} value={column}>
                {column}
              </option>
            ))}
          </select>
        </label>
        <label>
          Chart type
          <select
            value={config.chartType}
            onChange={(e) => updateConfig({ chartType: e.target.value })}
          >
            {CHART_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Plot
        data={[
          {
            x: chartData.xValues,
            y: chartData.yValues,
            type: config.chartType === "line" ? "scatter" : config.chartType,
            mode: config.chartType === "line" ? "lines" : "markers",
          },
        ]}
        layout={{
          autosize: true,
          font: { family: "Lexend, sans-serif", size: fontSize },
          xaxis: { title: config.xColumn },
          yaxis: { title: config.yColumn },
        }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

export default ChartBuilder;
