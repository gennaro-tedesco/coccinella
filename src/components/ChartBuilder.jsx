import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  ScatterChart,
  ChartColumn,
  ChartBarBig,
  ChartBarIncreasing,
  ChartLine,
  ChartNoAxesColumnIncreasing,
  BoxSelect,
  X,
} from "lucide-react";
import Plotly from "plotly.js/lib/core";
import Bar from "plotly.js/lib/bar";
import Box from "plotly.js/lib/box";
import Histogram from "plotly.js/lib/histogram";
import Scatter from "plotly.js/lib/scatter";
import createPlotlyComponent from "react-plotly.js/factory";
import { useAppStore } from "../store/useAppStore";
import { THEMES } from "../utils/themes";
import { FULL_SIZE_PERCENT, ICON_SIZE_DEFAULT, PLOT_MODE_BAR_BUTTONS } from "../constants";
import { buildTraces } from "../utils/chart";

Plotly.register([Bar, Box, Histogram, Scatter]);
const Plot = createPlotlyComponent(Plotly);
const EMPTY_CHART_DATA = { xValues: [], yValues: [], groupValues: null };

const NUMERIC_TYPES = new Set(["number"]);
const CATEGORICAL_TYPES = new Set(["string", "category", "boolean", "uuid", "date"]);
const SEQUENCE_TYPES = new Set(["number", "date"]);

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
  {
    id: "linechart",
    label: "Time Series",
    description: "Track numeric series over time",
    icon: ChartLine,
    needsY: true,
    multipleY: true,
    xTypes: SEQUENCE_TYPES,
    yTypes: NUMERIC_TYPES,
  },
  {
    id: "stackedbar",
    label: "Stacked bar",
    description: "Compare totals in sequence",
    icon: ChartNoAxesColumnIncreasing,
    needsY: true,
    multipleY: true,
    xTypes: SEQUENCE_TYPES,
    yTypes: NUMERIC_TYPES,
  },
];

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

const BAR_MODE_OPTIONS = [
  { value: "stack", label: "Stacked" },
  { value: "group", label: "Side by side" },
];

function plotTypeFor(chartType) {
  return PLOT_TYPES.find((type) => type.id === chartType);
}

function FieldDropdown({ label, value, options, onChange, open, onToggle, className = "" }) {
  const selected = options.find((option) => option.value === value);

  return (
    <div className={`chart-field ${className}`.trim()}>
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

function MultiFieldDropdown({ label, values, options, onChange, open, onToggle }) {
  return (
    <div className="chart-field">
      <span>{label}</span>
      <div className="type-selector" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="type-selector-trigger" onClick={onToggle}>
          {values.length ? values.join(", ") : "—"}
        </button>
        {open && (
          <ul className="file-menu-dropdown type-selector-dropdown multi-field-dropdown">
            {options.map((option) => (
              <li key={option.value}>
                <label>
                  <input
                    type="checkbox"
                    checked={values.includes(option.value)}
                    onChange={() =>
                      onChange(
                        values.includes(option.value)
                          ? values.filter((value) => value !== option.value)
                          : [...values, option.value],
                      )
                    }
                  />
                  {option.label}
                </label>
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
  if (plotType.multipleY) return "Value";
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
  const theme = useAppStore((state) => THEMES[state.previewTheme ?? state.theme] ?? THEMES.darkSolar);
  const showError = useAppStore((state) => state.showError);

  const config = plotConfig ?? null;
  const plotType = config ? plotTypeFor(config.chartType) : null;
  const [chartData, setChartData] = useState(EMPTY_CHART_DATA);
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
    if (plotType.needsY && !config.yColumn && !config.yColumns?.length) return undefined;
    let cancelled = false;
    setChartData(EMPTY_CHART_DATA);
    invoke("get_chart_data", {
      datasetId: sheet.datasetId,
      xColumn: config.xColumn,
      yColumns: plotType.needsY
        ? (plotType.multipleY ? config.yColumns : [config.yColumn]).filter(Boolean)
        : [],
      groupColumn: config.groupColumn || null,
    })
      .then((result) => {
        if (!cancelled) setChartData(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setChartData(EMPTY_CHART_DATA);
          showError(error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    sheet?.datasetId,
    sheet?.dataVersion,
    plotType,
    config?.xColumn,
    config?.yColumn,
    config?.yColumns,
    config?.groupColumn,
    showError,
  ]);

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
    const xColumn = xOptions[0] ?? "";
    setPlotConfig(activeSheetId, {
      chartType: type.id,
      xColumn,
      yColumn: sameTypeSet ? (yOptions[1] ?? yOptions[0] ?? "") : (yOptions[0] ?? ""),
      yColumns: type.multipleY
        ? yOptions.filter((column) => column !== xColumn).slice(0, 2)
        : [],
      groupColumn: "",
      binCount: "",
      histNorm: "count",
      cumulative: false,
      showPoints: false,
      colorIndex: 0,
      aggFunc: "mean",
      style: "markers",
      barMode: "stack",
    });
  }

  const traces = plotType ? buildTraces(config, chartData, theme.colors, theme.bg) : [];
  const grouped = Boolean(config?.groupColumn);
  const xOptions = plotType ? columnsOfTypes(sheet, plotType.xTypes) : [];
  const yOptions = plotType?.needsY
    ? columnsOfTypes(sheet, plotType.yTypes).filter(
        (column) => !plotType.multipleY || column !== config.xColumn,
      )
    : [];
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
      <span className="color-option" role="img" aria-label={`Color ${hex}`}>
        <span className="color-swatch" style={{ backgroundColor: hex }} />
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
            {plotType.needsY && !plotType.multipleY && (
              <FieldDropdown
                label="Y"
                value={config.yColumn}
                options={yFieldOptions}
                onChange={(value) => updateConfig({ yColumn: value })}
                open={openField === "y"}
                onToggle={() => setOpenField(openField === "y" ? null : "y")}
              />
            )}
            {plotType.multipleY && (
              <MultiFieldDropdown
                label="Values"
                values={config.yColumns ?? []}
                options={yFieldOptions}
                onChange={(values) => updateConfig({ yColumns: values })}
                open={openField === "values"}
                onToggle={() => setOpenField(openField === "values" ? null : "values")}
              />
            )}
            {(!plotType.multipleY || plotType.id === "linechart") && (
              <FieldDropdown
                label="Group by"
                value={config.groupColumn ?? ""}
                options={groupFieldOptions}
                onChange={(value) => updateConfig({ groupColumn: value })}
                open={openField === "group"}
                onToggle={() => setOpenField(openField === "group" ? null : "group")}
              />
            )}
            <FieldDropdown
              className="color-field"
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
            {plotType.id === "stackedbar" && (
              <FieldDropdown
                label="Bar layout"
                value={config.barMode ?? "stack"}
                options={BAR_MODE_OPTIONS}
                onChange={(value) => updateConfig({ barMode: value })}
                open={openField === "barMode"}
                onToggle={() => setOpenField(openField === "barMode" ? null : "barMode")}
              />
            )}
            {plotType.id === "boxplot" && (
              <label className="plot-checkbox">
                Show points
                <input
                  type="checkbox"
                  checked={Boolean(config.showPoints)}
                  onChange={(e) => updateConfig({ showPoints: e.target.checked })}
                />
              </label>
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
              <X size={ICON_SIZE_DEFAULT} />
            </button>
          </div>
          <div className="chart-plot">
            <Plot
              key={`${config.chartType}-${config.xColumn}-${config.yColumn}-${config.yColumns?.join(",")}-${config.groupColumn}-${config.binCount}-${config.histNorm}-${config.cumulative}-${config.showPoints}-${config.colorIndex}-${config.aggFunc}-${config.style}-${config.barMode}`}
              data={traces}
              layout={{
                autosize: true,
                paper_bgcolor: theme.bg,
                plot_bgcolor: theme.bg,
                font: { family: "Lexend, sans-serif", size: fontSize, color: theme.fg },
                barmode:
                  plotType.id === "stackedbar" ? (config.barMode ?? "stack") : "group",
                showlegend: grouped || plotType.multipleY,
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
              config={{ displaylogo: false, modeBarButtons: PLOT_MODE_BAR_BUTTONS }}
              useResizeHandler
              style={{ width: FULL_SIZE_PERCENT, height: FULL_SIZE_PERCENT }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default ChartBuilder;
