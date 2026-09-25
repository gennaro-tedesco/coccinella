import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { DEFAULT_COLUMN_PRECISION } from "../constants";
import { useAppStore } from "../store/useAppStore";
import { DEFAULT_DATE_FORMAT } from "../utils/columnTypes";
import { formatDateValue } from "../utils/dateFormats";

function StatRow({ label, value }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export function useColumnStats(sheet, column) {
  const type = sheet.columnTypes[column];
  const showError = useAppStore((state) => state.showError);
  const hasStats = Boolean(type) && type !== "string" && type !== "uuid";
  const [stats, setStats] = useState(undefined);

  useEffect(() => {
    if (!hasStats) return undefined;
    let cancelled = false;
    setStats(undefined);
    invoke("get_column_stats", {
      datasetId: sheet.datasetId,
      column,
      columnType: type,
    })
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((error) => {
        if (!cancelled) showError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [sheet.datasetId, sheet.contentVersion, type, column, hasStats, showError]);

  return hasStats ? stats : undefined;
}

export function ColumnStatsSummary({ sheet, column, stats }) {
  const precision = sheet.columnPrecision[column] ?? DEFAULT_COLUMN_PRECISION;
  const dateFormat = sheet.columnDateFormats?.[column] ?? DEFAULT_DATE_FORMAT;

  if (stats === undefined) return null;
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
        <StatRow label="Min" value={formatDateValue(stats.min, dateFormat)} />
        <StatRow label="Max" value={formatDateValue(stats.max, dateFormat)} />
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

function ColumnStats({ sheet, column }) {
  const stats = useColumnStats(sheet, column);
  return <ColumnStatsSummary sheet={sheet} column={column} stats={stats} />;
}

export default ColumnStats;
