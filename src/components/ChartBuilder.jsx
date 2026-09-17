import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  ScatterChart,
  ChartColumn,
  ChartBarBig,
  ChartBarIncreasing,
  BoxSelect,
  X,
} from "lucide-react";
import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { useAppStore } from "../store/useAppStore";
import { THEMES } from "../utils/themes";

const Plot = createPlotlyComponent(Plotly);

const NUMERIC_TYPES = new Set(["number"]);
const CATEGORICAL_TYPES = new Set(["string", "category", "boolean", "uuid", "date"]);

const PLOT_TYPES = [
  {
    id: "scatter",
    label: "Scatter plot",
    description: "Compare two numeric columns",
    icon: ScatterChart,
    needsY: true,
    xTypes: NUMERIC_TYPES,
    yTypes: NUMERIC_TYPES,
  },
  {
    id: "histogram",
    label: "Histogram",
    description: "Distribution of one column as bars",
    icon: ChartColumn,
    needsY: false,
    xTypes: NUMERIC_TYPES,
  },
  {
    id: "countplot",
    label: "Count plot",
    description: "Counts per category",
    icon: ChartBarBig,
    needsY: false,
    xTypes: CATEGORICAL_TYPES,
  },
  {
    id: "boxplot",
    label: "Box plot",
    description: "Quartiles and outliers of one column",
    icon: BoxSelect,
    needsY: false,
    valueOnYAxis: true,
    xTypes: NUMERIC_TYPES,
  },
  {
    id: "barchart",
    label: "Bar chart",
    description: "Aggregate a number across categories",
    icon: ChartBarIncreasing,
    needsY: true,
    xTypes: CATEGORICAL_TYPES,
    yTypes: NUMERIC_TYPES,
  },
];

const AGG_FUNCS = {
  mean: (nums) => nums.reduce((a, b) => a + b, 0) / nums.length,
  sum: (nums) => nums.reduce((a, b) => a + b, 0),
  min: (nums) => Math.min(...nums),
  max: (nums) => Math.max(...nums),
  median: (nums) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },
  count: (nums) => nums.length,
};

const AGG_FUNC_OPTIONS = [
  { value: "mean", label: "Mean" },
  { value: "sum", label: "Sum" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "median", label: "Median" },
  { value: "count", label: "Count" },
];

const SCATTER_STYLE_OPTIONS = [
  { value: "markers", label: "Markers" },
  { value: "lines", label: "Line" },
  { value: "lines+markers", label: "Line + markers" },
];

function plotTypeFor(chartType) {
  return PLOT_TYPES.find((type) => type.id === chartType);
}

function FieldDropdown({ label, value, options, onChange, open, onToggle }) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className="chart-field">
      <span>{label}</span>
      <div className="type-selector" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="type-selector-trigger" onClick={onToggle}>
          {selected?.render ? selected.render() : (selected?.label ?? "—")}
        </button>
        {open && (
          <ul className="file-menu-dropdown type-selector-dropdown">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={option.value === value ? "active" : ""}
                  onClick={() => {
                    onChange(option.value);
                    onToggle();
                  }}
                >
                  {option.render ? option.render() : option.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function columnsOfTypes(sheet, types) {
  return sheet.columns.filter((column) => types.has(sheet.columnTypes[column]));
}

function groupIndices(length, groupValues) {
  if (!groupValues) return { "": Array.from({ length }, (_, index) => index) };
  const groups = {};
  groupValues.forEach((value, index) => {
    (groups[value] ??= []).push(index);
  });
  return groups;
}

function buildTraces(config, chartData, palette, gapColor) {
  const { xValues, yValues, groupValues } = chartData;
  const grouped = Boolean(config.groupColumn) && groupValues;
  const groups = groupIndices(xValues.length, grouped ? groupValues : null);
  const groupKeys = Object.keys(groups);
  const startIndex = config.colorIndex ?? 0;
  const colorFor = (index) => palette[(startIndex + index) % palette.length];

  switch (config.chartType) {
    case "scatter": {
      if (!yValues) return [];
      const mode = config.style ?? "markers";
      const sorted = mode !== "markers";
      return groupKeys.map((key, groupIndex) => {
        const indices = sorted
          ? [...groups[key]].sort((a, b) => Number(xValues[a]) - Number(xValues[b]))
          : groups[key];
        return {
          x: indices.map((index) => xValues[index]),
          y: indices.map((index) => yValues[index]),
          type: "scatter",
          mode,
          marker: { color: colorFor(groupIndex) },
          line: { color: colorFor(groupIndex) },
          name: grouped ? key : undefined,
        };
      });
    }
    case "histogram":
      return groupKeys.map((key, groupIndex) => ({
        x: groups[key].map((index) => xValues[index]),
        type: "histogram",
        nbinsx: config.binCount ? Number(config.binCount) : undefined,
        histnorm: config.histNorm !== "count" ? config.histNorm : undefined,
        cumulative: config.cumulative ? { enabled: true } : undefined,
        marker: {
          color: colorFor(groupIndex),
          line: { color: gapColor, width: 1 },
        },
        name: grouped ? key : undefined,
      }));
    case "countplot":
      return groupKeys.map((key, groupIndex) => {
        const counts = {};
        groups[key].forEach((index) => {
          const category = xValues[index];
          counts[category] = (counts[category] ?? 0) + 1;
        });
        return {
          x: Object.keys(counts),
          y: Object.values(counts),
          type: "bar",
          marker: { color: colorFor(groupIndex) },
          name: grouped ? key : undefined,
        };
      });
    case "boxplot":
      return groupKeys.map((key, groupIndex) => ({
        y: groups[key].map((index) => xValues[index]),
        type: "box",
        name: grouped ? key : config.xColumn,
        marker: { color: colorFor(groupIndex) },
        line: { color: colorFor(groupIndex) },
      }));
    case "barchart": {
      if (!yValues) return [];
      const agg = AGG_FUNCS[config.aggFunc] ?? AGG_FUNCS.mean;
      return groupKeys.map((key, groupIndex) => {
        const buckets = {};
        groups[key].forEach((index) => {
          const num = Number(yValues[index]);
          if (Number.isNaN(num)) return;
          (buckets[xValues[index]] ??= []).push(num);
        });
        return {
          x: Object.keys(buckets),
          y: Object.values(buckets).map(agg),
          type: "bar",
          marker: { color: colorFor(groupIndex) },
          name: grouped ? key : undefined,
        };
      });
    }
    default:
      return [];
  }
}

const Y_AXIS_TITLE = {
  countplot: "Count",
};

const HIST_NORM_OPTIONS = [
  { value: "count", label: "Count" },
  { value: "percent", label: "Percent" },
  { value: "probability", label: "Probability" },
  { value: "density", label: "Density" },
  { value: "probability density", label: "Probability density" },
];

function yAxisTitleFor(plotType, config) {
  if (plotType.id === "barchart") {
    const aggLabel = AGG_FUNC_OPTIONS.find(
      (option) => option.value === (config.aggFunc ?? "mean"),
    ).label;
    return `${aggLabel} of ${config.yColumn}`;
  }
  if (plotType.needsY) return config.yColumn;
  if (plotType.valueOnYAxis) return config.xColumn;
  if (plotType.id === "histogram") {
    return HIST_NORM_OPTIONS.find(
      (option) => option.value === (config.histNorm ?? "count"),
    ).label;
  }
  return Y_AXIS_TITLE[config.chartType];
}

function ChartBuilder({ fontSize }) {
  const activeSheetId = useAppStore((state) => state.activeSheetId);
  const sheet = useAppStore((state) =>
    state.activeSheetId ? state.sheets[state.activeSheetId] : null,
  );
  const plotConfig = useAppStore((state) =>
    state.activeSheetId ? state.plotConfig[state.activeSheetId] : null,
  );
  const setPlotConfig = useAppStore((state) => state.setPlotConfig);
  const theme = useAppStore((state) => THEMES[state.theme] ?? THEMES.oceanic);

  const config = plotConfig ?? null;
  const plotType = config ? plotTypeFor(config.chartType) : null;
  const [chartData, setChartData] = useState({
    xValues: [],
    yValues: null,
    groupValues: null,
  });
  const [openField, setOpenField] = useState(null);

  useEffect(() => {
    if (!openField) return undefined;
    function handleOutsideClick() {
      setOpenField(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openField]);

  useEffect(() => {
    if (!sheet || !plotType || !config.xColumn) return undefined;
    if (plotType.needsY && !config.yColumn) return undefined;
    let cancelled = false;
    invoke("get_chart_data", {
      datasetId: sheet.datasetId,
      xColumn: config.xColumn,
      yColumn: plotType.needsY ? config.yColumn : null,
      groupColumn: config.groupColumn || null,
    }).then((result) => {
      if (!cancelled) setChartData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sheet, plotType, config?.xColumn, config?.yColumn, config?.groupColumn]);

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

  function selectChartType(type) {
    const xOptions = columnsOfTypes(sheet, type.xTypes);
    const yOptions = type.needsY ? columnsOfTypes(sheet, type.yTypes) : [];
    const sameTypeSet = type.xTypes === type.yTypes;
    setPlotConfig(activeSheetId, {
      chartType: type.id,
      xColumn: xOptions[0] ?? "",
      yColumn: sameTypeSet ? (yOptions[1] ?? yOptions[0] ?? "") : (yOptions[0] ?? ""),
      groupColumn: "",
      binCount: "",
      histNorm: "count",
      cumulative: false,
      colorIndex: 0,
      aggFunc: "mean",
      style: "markers",
    });
  }

  const traces = plotType ? buildTraces(config, chartData, theme.colors, theme.bg) : [];
  const grouped = Boolean(config?.groupColumn);
  const xOptions = plotType ? columnsOfTypes(sheet, plotType.xTypes) : [];
  const yOptions = plotType?.needsY ? columnsOfTypes(sheet, plotType.yTypes) : [];
  const groupOptions = plotType
    ? columnsOfTypes(sheet, CATEGORICAL_TYPES).filter(
        (column) => column !== config.xColumn,
      )
    : [];

  const xFieldOptions = (xOptions.length === 0 ? [""] : xOptions).map((column) => ({
    value: column,
    label: column || "No eligible columns",
  }));
  const yFieldOptions = (yOptions.length === 0 ? [""] : yOptions).map((column) => ({
    value: column,
    label: column || "No eligible columns",
  }));
  const groupFieldOptions = [
    { value: "", label: "None" },
    ...groupOptions.map((column) => ({ value: column, label: column })),
  ];
  const colorFieldOptions = theme.colors.map((hex, index) => ({
    value: index,
    render: () => (
      <span className="color-option">
        <span className="color-swatch" style={{ backgroundColor: hex }} />
        {hex}
      </span>
    ),
  }));

  return (
    <div className="chart-builder">
      <div className="plot-picker">
        {PLOT_TYPES.map((type) => {
          const Icon = type.icon;
          return (
            <button
              key={type.id}
              className={
                type.id === plotType?.id ? "plot-tile plot-tile-active" : "plot-tile"
              }
              onClick={() => selectChartType(type)}
            >
              <Icon className="plot-tile-icon" />
              <h3>{type.label}</h3>
              <p>{type.description}</p>
            </button>
          );
        })}
      </div>
      {plotType && (
        <>
          <div className="chart-controls">
            <FieldDropdown
              label={plotType.needsY ? "X" : "Column"}
              value={config.xColumn}
              options={xFieldOptions}
              onChange={(value) => updateConfig({ xColumn: value })}
              open={openField === "x"}
              onToggle={() => setOpenField(openField === "x" ? null : "x")}
            />
            {plotType.needsY && (
              <FieldDropdown
                label="Y"
                value={config.yColumn}
                options={yFieldOptions}
                onChange={(value) => updateConfig({ yColumn: value })}
                open={openField === "y"}
                onToggle={() => setOpenField(openField === "y" ? null : "y")}
              />
            )}
            <FieldDropdown
              label="Group by"
              value={config.groupColumn ?? ""}
              options={groupFieldOptions}
              onChange={(value) => updateConfig({ groupColumn: value })}
              open={openField === "group"}
              onToggle={() => setOpenField(openField === "group" ? null : "group")}
            />
            <FieldDropdown
              label="Color"
              value={config.colorIndex ?? 0}
              options={colorFieldOptions}
              onChange={(value) => updateConfig({ colorIndex: value })}
              open={openField === "color"}
              onToggle={() => setOpenField(openField === "color" ? null : "color")}
            />
            {plotType.id === "histogram" && (
              <>
                <label>
                  Bins
                  <input
                    type="number"
                    min="1"
                    placeholder="Auto"
                    value={config.binCount ?? ""}
                    onChange={(e) => updateConfig({ binCount: e.target.value })}
                  />
                </label>
                <FieldDropdown
                  label="Normalize"
                  value={config.histNorm ?? "count"}
                  options={HIST_NORM_OPTIONS}
                  onChange={(value) => updateConfig({ histNorm: value })}
                  open={openField === "histNorm"}
                  onToggle={() =>
                    setOpenField(openField === "histNorm" ? null : "histNorm")
                  }
                />
                <label className="plot-checkbox">
                  Cumulative
                  <input
                    type="checkbox"
                    checked={Boolean(config.cumulative)}
                    onChange={(e) => updateConfig({ cumulative: e.target.checked })}
                  />
                </label>
              </>
            )}
            {plotType.id === "barchart" && (
              <FieldDropdown
                label="Aggregate"
                value={config.aggFunc ?? "mean"}
                options={AGG_FUNC_OPTIONS}
                onChange={(value) => updateConfig({ aggFunc: value })}
                open={openField === "aggFunc"}
                onToggle={() =>
                  setOpenField(openField === "aggFunc" ? null : "aggFunc")
                }
              />
            )}
            {plotType.id === "scatter" && (
              <FieldDropdown
                label="Style"
                value={config.style ?? "markers"}
                options={SCATTER_STYLE_OPTIONS}
                onChange={(value) => updateConfig({ style: value })}
                open={openField === "style"}
                onToggle={() => setOpenField(openField === "style" ? null : "style")}
              />
            )}
            <button
              type="button"
              className="plot-close"
              aria-label="Close plot"
              onClick={() => updateConfig({ chartType: null })}
            >
              <X size={16} />
            </button>
          </div>
          <div className="chart-plot">
            <Plot
              key={`${config.chartType}-${config.xColumn}-${config.yColumn}-${config.groupColumn}-${config.binCount}-${config.histNorm}-${config.cumulative}-${config.colorIndex}-${config.aggFunc}-${config.style}`}
              data={traces}
              layout={{
                autosize: true,
                paper_bgcolor: theme.bg,
                plot_bgcolor: theme.bg,
                font: { family: "Lexend, sans-serif", size: fontSize, color: theme.fg },
                barmode: "group",
                showlegend: grouped,
                xaxis: {
                  title: plotType.valueOnYAxis
                    ? (config.groupColumn ?? "")
                    : config.xColumn,
                  autorange: true,
                  showgrid: false,
                  linecolor: theme.border,
                  zerolinecolor: theme.border,
                },
                yaxis: {
                  title: yAxisTitleFor(plotType, config),
                  autorange: true,
                  showgrid: false,
                  linecolor: theme.border,
                  zerolinecolor: theme.border,
                },
              }}
              useResizeHandler
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default ChartBuilder;
