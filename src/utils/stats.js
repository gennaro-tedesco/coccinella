function frequencyMap(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

function computeMode(values) {
  const counts = frequencyMap(values);
  let best = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() === "true";
}

function mostAndLeastFrequent(values) {
  const counts = frequencyMap(values);
  let most = null;
  let mostCount = -1;
  let least = null;
  let leastCount = Infinity;
  for (const [value, count] of counts) {
    if (count > mostCount) {
      most = value;
      mostCount = count;
    }
    if (count < leastCount) {
      least = value;
      leastCount = count;
    }
  }
  return { most: [most, mostCount], least: [least, leastCount] };
}

export function computeColumnStats(type, rawValues) {
  const values = rawValues.filter((v) => v !== null && v !== undefined && v !== "");
  if (values.length === 0) return null;

  if (type === "number") {
    const nums = values.map(Number).filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    const avg = sum / nums.length;
    const max = Math.max(...nums);
    const min = Math.min(...nums);
    const variance =
      nums.reduce((acc, n) => acc + (n - avg) ** 2, 0) / nums.length;
    return {
      type: "number",
      sum,
      avg,
      max,
      min,
      stdDev: Math.sqrt(variance),
      mode: computeMode(nums),
    };
  }

  if (type === "date") {
    const times = values
      .map((v) => new Date(v).getTime())
      .filter((t) => !Number.isNaN(t));
    if (times.length === 0) return null;
    return {
      type: "date",
      min: new Date(Math.min(...times)),
      max: new Date(Math.max(...times)),
    };
  }

  if (type === "category") {
    const { most, least } = mostAndLeastFrequent(values);
    return { type: "category", most, least };
  }

  if (type === "boolean") {
    const bools = values.map(toBoolean);
    const trueCount = bools.filter(Boolean).length;
    return {
      type: "boolean",
      trueCount,
      falseCount: bools.length - trueCount,
    };
  }

  return null;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
