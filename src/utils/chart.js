const ZERO = 0;
const ONE = 1;
const TWO = 2;

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

export function buildTraces(config, chartData, palette, gapColor) {
  const { xValues, yValues, groupValues } = chartData;
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
