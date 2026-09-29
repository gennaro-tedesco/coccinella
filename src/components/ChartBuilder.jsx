import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart,
  ChartColumn,
  ChartBarBig,
  ChartBarIncreasing,
  ChartLine,
  ChartNoAxesColumnIncreasing,
  Grid3X3,
  BoxSelect,
  X,
} from "lucide-react";
import Plotly from "plotly.js/lib/core";
import Bar from "plotly.js/lib/bar";
import Box from "plotly.js/lib/box";
import Histogram from "plotly.js/lib/histogram";
import Scatter from "plotly.js/lib/scatter";
import Heatmap from "plotly.js/lib/heatmap";
import createPlotlyComponent from "react-plotly.js/factory";
import { useAppStore } from "../store/useAppStore";
import { THEMES } from "../utils/themes";
import { FULL_SIZE_PERCENT, ICON_SIZE_DEFAULT, PLOT_MODE_BAR_BUTTONS } from "../constants";
import { buildTraces } from "../utils/chart";

Plotly.register([Bar, Box, Histogram, Scatter, Heatmap]);
const Plot = createPlotlyComponent(Plotly);
const EMPTY_CHART_DATA = { xValues: [], yValues: [], groupValues: null };

const NUMERIC_TYPES = new Set(["number"]);
const CATEGORICAL_TYPES = new Set(["string", "category", "boolean", "uuid", "date"]);
const SEQUENCE_TYPES = new Set(["number", "date"]);
const MIN_CORRELATION_COLUMNS = 2;

const PLOT_TYPES = [
  {
    id: "scatter",
    label: "Scatter plot",
    icon: ScatterChart,
    needsY: true,
    xTypes: NUMERIC_TYPES,
    yTypes: NUMERIC_TYPES,
  },
  {
    id: "histogram",
    label: "Histogram",
    icon: ChartColumn,
    needsY: false,
    xTypes: NUMERIC_TYPES,
  },
  {
    id: "countplot",
    label: "Count plot",
    icon: ChartBarBig,
    needsY: false,
    xTypes: CATEGORICAL_TYPES,
  },
  {
    id: "boxplot",
    label: "Box plot",
    icon: BoxSelect,
    needsY: false,
    valueOnYAxis: true,
    xTypes: NUMERIC_TYPES,
  },
  {
    id: "barchart",
    label: "Bar chart",
    icon: ChartBarIncreasing,
    needsY: true,
    xTypes: CATEGORICAL_TYPES,
    yTypes: NUMERIC_TYPES,
  },
  {
    id: "heatmap",
    label: "Heatmap",
    icon: Grid3X3,
    needsY: true,
    xTypes: CATEGORICAL_TYPES,
    yTypes: CATEGORICAL_TYPES,
  },
  {
    id: "linechart",
    label: "Time Series",
    icon: ChartLine,
    needsY: true,
    multipleY: true,
    xTypes: SEQUENCE_TYPES,
    yTypes: NUMERIC_TYPES,
  },
  {
    id: "stackedbar",
    label: "Stacked bar",
    icon: ChartNoAxesColumnIncreasing,
    needsY: true,
    multipleY: true,
    xTypes: SEQUENCE_TYPES,
    yTypes: NUMERIC_TYPES,
  },
];
const PIVOT_PLOT_TYPES = PLOT_TYPES.filter((type) => type.id === "heatmap");

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
const HEATMAP_MODE_OPTIONS = [
  { value: "aggregate", label: "Aggregated" },
  { value: "correlation", label: "Correlation" },
];

const PLOT_TYPE_STEP_KEYS = { ArrowUp: -1, k: -1, ArrowDown: 1, j: 1 };

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

function defaultConfigFor(sheet, type) {
  if (sheet.pivotTable) {
    return {
      chartType: type.id,
      xColumn: sheet.pivotRowDimension,
      yColumns: sheet.columns.filter((column) => column !== sheet.pivotRowDimension),
      colorIndex: 0,
      heatmapMode: "pivot",
      transpose: false,
      pivotColumnDimension: sheet.pivotColumnDimension,
      pivotMeasureLabel: sheet.pivotMeasureLabel,
    };
  }
  const xOptions = columnsOfTypes(sheet, type.xTypes);
  const yOptions = type.needsY ? columnsOfTypes(sheet, type.yTypes) : [];
  const sameTypeSet = type.xTypes === type.yTypes;
  const xColumn = xOptions[0] ?? "";
  return {
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
    heatmapMode: "aggregate",
    transpose: false,
    valueColumn: columnsOfTypes(sheet, NUMERIC_TYPES)[0] ?? "",
    correlationColumns: columnsOfTypes(sheet, NUMERIC_TYPES),
  };
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

function ChartBuilder({ fontSize, expanded }) {
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
  const selectablePlotTypes = sheet?.pivotTable ? PIVOT_PLOT_TYPES : PLOT_TYPES;
  const plotType = config
    ? selectablePlotTypes.find((type) => type.id === config.chartType)
    : null;
  const pivotHeatmap = Boolean(sheet?.pivotTable && plotType?.id === "heatmap");
  const heatmapAggFunc = plotType?.id === "heatmap" && !pivotHeatmap
    ? config?.aggFunc
    : null;
  const [chartData, setChartData] = useState(EMPTY_CHART_DATA);
  const [openField, setOpenField] = useState(null);

  useEffect(() => {
    if (!sheet?.pivotTable || plotType) return;
    setPlotConfig(activeSheetId, defaultConfigFor(sheet, PIVOT_PLOT_TYPES[0]));
  }, [sheet, plotType, activeSheetId, setPlotConfig]);

  useEffect(() => {
    if (!openField) return undefined;
    function handleOutsideClick() {
      setOpenField(null);
    }
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, [openField]);

  useEffect(() => {
    if (!sheet || !plotType) return undefined;
    const correlationHeatmap = plotType.id === "heatmap" && config.heatmapMode === "correlation";
    setChartData(EMPTY_CHART_DATA);
    if (!pivotHeatmap && correlationHeatmap && config.correlationColumns?.length < MIN_CORRELATION_COLUMNS) {
      return undefined;
    }
    if (!pivotHeatmap && !correlationHeatmap && !config.xColumn) return undefined;
    if (!pivotHeatmap && !correlationHeatmap && plotType.needsY && !config.yColumn && !config.yColumns?.length) {
      return undefined;
    }
    if (!pivotHeatmap && plotType.id === "heatmap" && !correlationHeatmap && !config.valueColumn) return undefined;
    let cancelled = false;
    const request = correlationHeatmap
      ? invoke("get_correlation_matrix", {
          datasetId: sheet.datasetId,
          columns: config.correlationColumns,
        })
      : plotType.id === "heatmap" && !pivotHeatmap
        ? invoke("get_heatmap_grid", {
            datasetId: sheet.datasetId,
            xColumn: config.xColumn,
            yColumn: config.yColumn,
            valueColumn: config.valueColumn,
            aggregation: heatmapAggFunc ?? "mean",
          })
        : invoke("get_chart_data", {
            datasetId: sheet.datasetId,
            xColumn: config.xColumn,
            yColumns: pivotHeatmap
              ? config.yColumns
              : plotType.needsY
                ? (plotType.multipleY ? config.yColumns : [config.yColumn]).filter(Boolean)
                : [],
            groupColumn: pivotHeatmap ? null : (config.groupColumn || null),
          });
    request
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
    config?.valueColumn,
    heatmapAggFunc,
    config?.heatmapMode,
    config?.correlationColumns,
    pivotHeatmap,
    showError,
  ]);

  useEffect(() => {
    if (!sheet) return undefined;
    function handleKeyDown(event) {
      const step = PLOT_TYPE_STEP_KEYS[event.key];
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.matches("input, textarea, select"));
      if (
        !step ||
        isEditing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      const currentIndex = selectablePlotTypes.findIndex((type) => type.id === plotType?.id);
      const nextIndex = currentIndex === -1
        ? (step > 0 ? 0 : selectablePlotTypes.length - 1)
        : (currentIndex + step + selectablePlotTypes.length) % selectablePlotTypes.length;
      setOpenField(null);
      setPlotConfig(activeSheetId, defaultConfigFor(sheet, selectablePlotTypes[nextIndex]));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sheet, plotType, activeSheetId, selectablePlotTypes, setPlotConfig]);

  const traces = useMemo(
    () => (plotType ? buildTraces(config, chartData, theme.colors, theme.bg) : []),
    [plotType, config, chartData, theme.colors, theme.bg],
  );

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
    setPlotConfig(activeSheetId, defaultConfigFor(sheet, type));
  }

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
  const numericFieldOptions = columnsOfTypes(sheet, NUMERIC_TYPES).map((column) => ({
    value: column,
    label: column,
  }));
  const correlationHeatmap = plotType?.id === "heatmap" && config.heatmapMode === "correlation";
  const transposable =
    plotType?.id === "heatmap" || plotType?.id === "countplot" || plotType?.id === "boxplot";
  const axesTransposed = transposable && Boolean(config.transpose);
  const colorFieldOptions = theme.colors.map((hex, index) => ({
    value: index,
    render: () => (
      <span className="color-option" role="img" aria-label={`Color ${hex}`}>
        <span className="color-swatch" style={{ backgroundColor: hex }} />
      </span>
    ),
  }));
  const xAxisTitle = !plotType
    ? ""
    : pivotHeatmap
      ? sheet.pivotColumnDimension
      : correlationHeatmap
        ? ""
        : plotType.valueOnYAxis
          ? (config.groupColumn ?? "")
          : config.xColumn;
  const yAxisTitle = !plotType
    ? ""
    : pivotHeatmap
      ? sheet.pivotRowDimension
      : correlationHeatmap
        ? ""
        : yAxisTitleFor(plotType, config);
  const modeBarButtons = transposable
    ? [[
        ...PLOT_MODE_BAR_BUTTONS[0],
        {
          name: axesTransposed
            ? `Restore ${plotType.label.toLowerCase()} axes`
            : `Transpose ${plotType.label.toLowerCase()} axes`,
          icon: Plotly.Icons["3d_rotate"],
          click: () => updateConfig({ transpose: !axesTransposed }),
        },
      ]]
    : PLOT_MODE_BAR_BUTTONS;

  return (
    <div className="chart-builder">
      <div className={expanded ? "chart-workspace chart-workspace-expanded" : "chart-workspace"}>
        <div className="chart-main">
          {plotType && (
            <>
              <div className="chart-controls">
                {plotType.id === "heatmap" && !pivotHeatmap && (
                  <FieldDropdown
                    label="Mode"
                    value={config.heatmapMode ?? "aggregate"}
                    options={HEATMAP_MODE_OPTIONS}
                    onChange={(value) => updateConfig({ heatmapMode: value })}
                    open={openField === "heatmapMode"}
                    onToggle={() => setOpenField(openField === "heatmapMode" ? null : "heatmapMode")}
                  />
                )}
                {!pivotHeatmap && !correlationHeatmap && (
                  <FieldDropdown
                    label={plotType.needsY ? "X" : "Column"}
                    value={config.xColumn}
                    options={xFieldOptions}
                    onChange={(value) => updateConfig({ xColumn: value })}
                    open={openField === "x"}
                    onToggle={() => setOpenField(openField === "x" ? null : "x")}
                  />
                )}
                {!pivotHeatmap && !correlationHeatmap && plotType.needsY && !plotType.multipleY && (
                  <FieldDropdown
                    label="Y"
                    value={config.yColumn}
                    options={yFieldOptions}
                    onChange={(value) => updateConfig({ yColumn: value })}
                    open={openField === "y"}
                    onToggle={() => setOpenField(openField === "y" ? null : "y")}
                  />
                )}
                {correlationHeatmap && (
                  <MultiFieldDropdown
                    label="Values"
                    values={config.correlationColumns ?? []}
                    options={numericFieldOptions}
                    onChange={(values) => updateConfig({ correlationColumns: values })}
                    open={openField === "correlations"}
                    onToggle={() => setOpenField(openField === "correlations" ? null : "correlations")}
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
                {plotType.id !== "heatmap" && (!plotType.multipleY || plotType.id === "linechart") && (
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
                      onToggle={() => setOpenField(openField === "histNorm" ? null : "histNorm")}
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
                    onToggle={() => setOpenField(openField === "aggFunc" ? null : "aggFunc")}
                  />
                )}
                {plotType.id === "heatmap" && !pivotHeatmap && !correlationHeatmap && (
                  <>
                    <FieldDropdown
                      label="Value"
                      value={config.valueColumn ?? ""}
                      options={numericFieldOptions}
                      onChange={(value) => updateConfig({ valueColumn: value })}
                      open={openField === "value"}
                      onToggle={() => setOpenField(openField === "value" ? null : "value")}
                    />
                    <FieldDropdown
                      label="Aggregate"
                      value={config.aggFunc ?? "mean"}
                      options={AGG_FUNC_OPTIONS}
                      onChange={(value) => updateConfig({ aggFunc: value })}
                      open={openField === "aggFunc"}
                      onToggle={() => setOpenField(openField === "aggFunc" ? null : "aggFunc")}
                    />
                  </>
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
                {!pivotHeatmap && (
                  <button
                    type="button"
                    className="plot-close"
                    aria-label="Close plot"
                    onClick={() => updateConfig({ chartType: null })}
                  >
                    <X size={ICON_SIZE_DEFAULT} />
                  </button>
                )}
              </div>
              <div className="chart-plot">
                <Plot
                  key={`${config.chartType}-${config.xColumn}-${config.yColumn}-${config.yColumns?.join(",")}-${config.groupColumn}-${config.binCount}-${config.histNorm}-${config.cumulative}-${config.showPoints}-${config.colorIndex}-${config.aggFunc}-${config.style}-${config.barMode}-${config.heatmapMode}-${config.transpose}-${config.valueColumn}-${config.correlationColumns?.join(",")}`}
                  data={traces}
                  layout={{
                    autosize: true,
                    paper_bgcolor: theme.bg,
                    plot_bgcolor: theme.bg,
                    font: {
                      family: "Lexend, sans-serif",
                      size: fontSize,
                      color: theme.fg,
                    },
                    barmode: plotType.id === "stackedbar" ? (config.barMode ?? "stack") : "group",
                    showlegend: grouped || plotType.multipleY,
                    xaxis: {
                      title: axesTransposed ? yAxisTitle : xAxisTitle,
                      autorange: true,
                      dtick: plotType.id === "countplot" && axesTransposed ? 1 : undefined,
                      showgrid: false,
                      linecolor: theme.border,
                      zerolinecolor: theme.border,
                    },
                    yaxis: {
                      title: axesTransposed ? xAxisTitle : yAxisTitle,
                      autorange: true,
                      automargin: true,
                      dtick: plotType.id === "countplot" && !axesTransposed ? 1 : undefined,
                      showgrid: false,
                      linecolor: theme.border,
                      zerolinecolor: theme.border,
                    },
                  }}
                  config={{
                    displaylogo: false,
                    modeBarButtons,
                  }}
                  useResizeHandler
                  style={{
                    width: FULL_SIZE_PERCENT,
                    height: FULL_SIZE_PERCENT,
                  }}
                />
              </div>
            </>
          )}
        </div>
        {!expanded && (
          <div className={selectablePlotTypes.length === 1 ? "plot-picker plot-picker-single" : "plot-picker"}>
            {selectablePlotTypes.map((type) => {
              const Icon = type.icon;
              return (
                <button
                  key={type.id}
                  className={type.id === plotType?.id ? "plot-tile plot-tile-active" : "plot-tile"}
                  onClick={() => selectChartType(type)}
                >
                  <Icon className="plot-tile-icon" />
                  <h3>{type.label}</h3>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ChartBuilder;
