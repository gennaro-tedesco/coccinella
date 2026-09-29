const ZERO = 0;
const ONE = 1;
const TWO = 2;
const COLOR_SCALE_MIDPOINT = 0.5;

export const AGG_FUNCS = {
  mean: (nums) => nums.reduce((a, b) => a + b, ZERO) / nums.length,
  sum: (nums) => nums.reduce((a, b) => a + b, ZERO),
  min: (nums) => nums.reduce((minimum, value) => Math.min(minimum, value)),
  max: (nums) => nums.reduce((maximum, value) => Math.max(maximum, value)),
  median: (nums) => {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / TWO);
    return sorted.length % TWO
      ? sorted[mid]
      : (sorted[mid - ONE] + sorted[mid]) / TWO;
  },
  count: (nums) => nums.length,
};

function groupIndices(length, groupValues) {
  if (!groupValues) return { "": Array.from({ length }, (_, index) => index) };
  const groups = {};
  groupValues.forEach((value, index) => {
    (groups[value] ??= []).push(index);
  });
  return groups;
}

function numericValue(value) {
  if (String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildHeatmapGrid(config, xValues, yValues, zValues, palette, startIndex, gapColor) {
  if (!zValues) return [];
  const correlation = config.heatmapMode === "correlation";
  const xLabel = config.transpose ? config.yColumn : config.xColumn;
  const yLabel = config.transpose ? config.xColumn : config.yColumn;
  return [{
    x: xValues,
    y: yValues,
    z: zValues,
    type: "heatmap",
    zmin: correlation ? -ONE : undefined,
    zmax: correlation ? ONE : undefined,
    colorscale: correlation
      ? [
          [ZERO, palette[(startIndex + ONE) % palette.length]],
          [COLOR_SCALE_MIDPOINT, gapColor],
          [ONE, palette[startIndex % palette.length]],
        ]
      : [[ZERO, gapColor], [ONE, palette[startIndex % palette.length]]],
    hoverongaps: false,
    hovertemplate: correlation
      ? "%{x} × %{y}<br>Correlation: %{z:.3f}<extra></extra>"
      : `${xLabel}: %{x}<br>${yLabel}: %{y}<br>${config.valueColumn}: %{z}<extra></extra>`,
  }];
}

function buildPivotHeatmap(config, xValues, yValues, color, gapColor) {
  if (yValues.length !== config.yColumns.length) return [];
  const xLabel = config.transpose ? config.xColumn : config.pivotColumnDimension;
  const yLabel = config.transpose ? config.pivotColumnDimension : config.xColumn;
  return [{
    x: config.yColumns,
    y: xValues,
    z: xValues.map((_, rowIndex) =>
      yValues.map((columnValues) => numericValue(columnValues[rowIndex]))
    ),
    type: "heatmap",
    colorscale: [[ZERO, gapColor], [ONE, color]],
    hoverongaps: false,
    hovertemplate: `${xLabel}: %{x}<br>${yLabel}: %{y}<br>${config.pivotMeasureLabel}: %{z}<extra></extra>`,
  }];
}

export function buildTraces(config, chartData, palette, gapColor) {
  const { xValues, yValues, zValues, groupValues } = chartData;
  const primaryYValues = yValues[ZERO];
  const grouped = Boolean(config.groupColumn) && groupValues;
  const groups = groupIndices(xValues.length, grouped ? groupValues : null);
  const groupKeys = Object.keys(groups);
  const startIndex = config.colorIndex ?? ZERO;
  const colorFor = (index) => palette[(startIndex + index) % palette.length];

  switch (config.chartType) {
    case "scatter": {
      if (!primaryYValues) return [];
      const mode = config.style ?? "markers";
      const sorted = mode !== "markers";
      return groupKeys.map((key, groupIndex) => {
        const indices = sorted
          ? [...groups[key]].sort((a, b) => Number(xValues[a]) - Number(xValues[b]))
          : groups[key];
        return {
          x: indices.map((index) => xValues[index]),
          y: indices.map((index) => primaryYValues[index]),
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
          line: { color: gapColor, width: ONE },
        },
        name: grouped ? key : undefined,
      }));
    case "countplot":
      return groupKeys.map((key, groupIndex) => {
        const counts = {};
        groups[key].forEach((index) => {
          const category = xValues[index];
          counts[category] = (counts[category] ?? ZERO) + ONE;
        });
        const categories = Object.keys(counts);
        const values = Object.values(counts);
        return {
          x: config.transpose ? values : categories,
          y: config.transpose ? categories : values,
          type: "bar",
          orientation: config.transpose ? "h" : undefined,
          marker: { color: colorFor(groupIndex) },
          name: grouped ? key : undefined,
        };
      });
    case "boxplot":
      return groupKeys.map((key, groupIndex) => ({
        x: config.transpose ? groups[key].map((index) => xValues[index]) : undefined,
        y: config.transpose ? undefined : groups[key].map((index) => xValues[index]),
        type: "box",
        orientation: config.transpose ? "h" : undefined,
        name: grouped ? key : config.xColumn,
        boxpoints: config.showPoints ? "all" : undefined,
        jitter: config.showPoints ? 0.3 : undefined,
        pointpos: config.showPoints ? ZERO : undefined,
        marker: {
          color: config.showPoints ? colorFor(groupIndex + ONE) : colorFor(groupIndex),
        },
        line: { color: colorFor(groupIndex) },
      }));
    case "barchart": {
      if (!primaryYValues) return [];
      const agg = AGG_FUNCS[config.aggFunc] ?? AGG_FUNCS.mean;
      return groupKeys.map((key, groupIndex) => {
        const buckets = {};
        groups[key].forEach((index) => {
          const num = Number(primaryYValues[index]);
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
    case "heatmap": {
      const traces = config.heatmapMode === "pivot"
        ? buildPivotHeatmap(config, xValues, yValues, colorFor(ZERO), gapColor)
        : buildHeatmapGrid(config, xValues, yValues, zValues, palette, startIndex, gapColor);
      if (!config.transpose) return traces;
      return traces.map((trace) => ({
        ...trace,
        x: trace.y,
        y: trace.x,
        transpose: true,
      }));
    }
    case "linechart": {
      if (grouped) {
        return yValues.flatMap((values, valueIndex) =>
          groupKeys.map((key, groupIndex) => {
            const indices = [...groups[key]].sort((a, b) => {
              const numericDifference = Number(xValues[a]) - Number(xValues[b]);
              if (!Number.isNaN(numericDifference)) return numericDifference;
              return String(xValues[a]).localeCompare(String(xValues[b]));
            });
            const colorIndex = valueIndex * groupKeys.length + groupIndex;
            return {
              x: indices.map((rowIndex) => xValues[rowIndex]),
              y: indices.map((rowIndex) => values[rowIndex]),
              type: "scatter",
              mode: "lines+markers",
              marker: { color: colorFor(colorIndex) },
              line: { color: colorFor(colorIndex) },
              name:
                yValues.length === ONE ? key : `${config.yColumns[valueIndex]} - ${key}`,
            };
          }),
        );
      }
    }
    case "stackedbar": {
      const indices = Array.from({ length: xValues.length }, (_, index) => index).sort(
        (a, b) => {
          const numericDifference = Number(xValues[a]) - Number(xValues[b]);
          if (!Number.isNaN(numericDifference)) return numericDifference;
          return String(xValues[a]).localeCompare(String(xValues[b]));
        },
      );
      return yValues.map((values, index) => ({
        x: indices.map((rowIndex) => xValues[rowIndex]),
        y: indices.map((rowIndex) => values[rowIndex]),
        type: config.chartType === "linechart" ? "scatter" : "bar",
        mode: config.chartType === "linechart" ? "lines+markers" : undefined,
        marker: { color: colorFor(index) },
        line: { color: colorFor(index) },
        name: config.yColumns[index],
      }));
    }
    default:
      return [];
  }
}
