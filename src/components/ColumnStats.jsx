import { useMemo } from "react";
import { computeColumnStats } from "../utils/stats";

function StatRow({ label, value }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function ColumnStats({ sheet, column }) {
  const type = sheet.columnTypes[column];
  const precision = sheet.columnPrecision[column] ?? 2;
  const stats = useMemo(
    () => computeColumnStats(type, sheet.rows.map((row) => row[column])),
    [type, sheet.rows, column],
  );

  if (type === "string") return null;

  if (!stats) return <div className="column-stats-empty">No data</div>;

  if (stats.type === "number") {
    return (
      <div className="column-stats">
        <StatRow label="Sum" value={stats.sum.toFixed(precision)} />
        <StatRow label="Average" value={stats.avg.toFixed(precision)} />
        <StatRow label="Min" value={stats.min.toFixed(precision)} />
        <StatRow label="Max" value={stats.max.toFixed(precision)} />
        <StatRow label="Std dev" value={stats.stdDev.toFixed(precision)} />
        <StatRow label="Mode" value={Number(stats.mode).toFixed(precision)} />
      </div>
    );
  }

  if (stats.type === "date") {
    return (
      <div className="column-stats">
        <StatRow label="Min" value={stats.min.toISOString()} />
        <StatRow label="Max" value={stats.max.toISOString()} />
      </div>
    );
  }

  if (stats.type === "category") {
    return (
      <div className="column-stats">
        <StatRow label="Most" value={`${stats.most[0]} (${stats.most[1]})`} />
        <StatRow label="Min" value={`${stats.least[0]} (${stats.least[1]})`} />
      </div>
    );
  }

  if (stats.type === "boolean") {
    return (
      <div className="column-stats">
        <StatRow label="True" value={stats.trueCount} />
        <StatRow label="False" value={stats.falseCount} />
      </div>
    );
  }

  return null;
}

export default ColumnStats;
