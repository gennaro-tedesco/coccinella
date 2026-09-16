import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { useAppStore } from "../store/useAppStore";

const Plot = createPlotlyComponent(Plotly);

const CHART_TYPES = ["scatter", "bar", "line"];

function ChartBuilder() {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const plotConfig = useAppStore((state) =>
    state.activeSheetId ? state.plotConfig[state.activeSheetId] : null,
  );
  const setPlotConfig = useAppStore((state) => state.setPlotConfig);

  if (!sheet) {
    return (
      <div className="chart-builder-placeholder">
        <p>No sheet selected</p>
      </div>
    );
  }

  const config = plotConfig ?? {
    xColumn: sheet.columns[0] ?? "",
    yColumn: sheet.columns[1] ?? sheet.columns[0] ?? "",
    chartType: "scatter",
  };

  function updateConfig(patch) {
    setPlotConfig(activeSheetId, { ...config, ...patch });
  }

  const xValues = sheet.rows.map((row) => row[config.xColumn]);
  const yValues = sheet.rows.map((row) => row[config.yColumn]);

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
            x: xValues,
            y: yValues,
            type: config.chartType === "line" ? "scatter" : config.chartType,
            mode: config.chartType === "line" ? "lines" : "markers",
          },
        ]}
        layout={{
          autosize: true,
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
