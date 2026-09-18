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
  const grouped = Boolean(config.groupColumn) && groupValues;
  const groups = groupIndices(xValues.length, grouped ? groupValues : null);
  const groupKeys = Object.keys(groups);
  const startIndex = config.colorIndex ?? ZERO;
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
