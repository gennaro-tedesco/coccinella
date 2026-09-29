// Verifies chart aggregation without loading React or Plotly.
// These cases cover the data-integrity paths used by chart rendering.
import { describe, expect, it } from "vitest";
import { AGG_FUNCS, buildTraces } from "./chart";

describe("chart aggregation", () => {
  it("calculates extrema and medians without argument spreading", () => {
    expect(AGG_FUNCS.min([3, 1, 2])).toBe(1);
    expect(AGG_FUNCS.max([3, 1, 2])).toBe(3);
    expect(AGG_FUNCS.median([4, 1, 3, 2])).toBe(2.5);
  });

  it("counts categories independently by group", () => {
    const traces = buildTraces(
      { chartType: "countplot", groupColumn: "team" },
      {
        xValues: ["A", "A", "B"],
        yValues: [],
        groupValues: ["red", "red", "blue"],
      },
      ["#111", "#222"],
      "#000",
    );

    expect(traces).toMatchObject([
      { name: "red", x: ["A"], y: [2] },
      { name: "blue", x: ["B"], y: [1] },
    ]);
  });

  it("transposes count plot values and axes", () => {
    const [trace] = buildTraces(
      { chartType: "countplot", transpose: true },
      {
        xValues: ["A", "A", "B"],
        yValues: [],
        groupValues: null,
      },
      ["#111"],
      "#000",
    );

    expect(trace).toMatchObject({
      x: [2, 1],
      y: ["A", "B"],
      orientation: "h",
    });
  });

  it("includes every boxplot point when requested", () => {
    const [trace] = buildTraces(
      { chartType: "boxplot", xColumn: "score", showPoints: true },
      { xValues: [1, 2, 3], yValues: [], groupValues: null },
      ["#111", "#222"],
      "#000",
    );

    expect(trace).toMatchObject({
      y: [1, 2, 3],
      boxpoints: "all",
      jitter: 0.3,
      pointpos: 0,
      marker: { color: "#222" },
      line: { color: "#111" },
    });
  });

  it("transposes boxplot values and axes", () => {
    const [trace] = buildTraces(
      { chartType: "boxplot", xColumn: "score", transpose: true },
      { xValues: [1, 2, 3], yValues: [], groupValues: null },
      ["#111"],
      "#000",
    );

    expect(trace).toMatchObject({
      x: [1, 2, 3],
      orientation: "h",
    });
    expect(trace.y).toBeUndefined();
  });

  it("builds ordered traces for each selected line-chart value", () => {
    const traces = buildTraces(
      { chartType: "linechart", yColumns: ["Passed", "Failed"] },
      {
        xValues: ["2026-09-18", "2026-09-17"],
        yValues: [["4", "5"], ["18", "17"]],
        groupValues: null,
      },
      ["#111", "#222"],
      "#000",
    );

    expect(traces).toMatchObject([
      { name: "Passed", x: ["2026-09-17", "2026-09-18"], y: ["5", "4"] },
      { name: "Failed", x: ["2026-09-17", "2026-09-18"], y: ["17", "18"] },
    ]);
  });

  it("builds a separately colored line for each time-series group", () => {
    const traces = buildTraces(
      { chartType: "linechart", yColumns: ["Passed"], groupColumn: "team" },
      {
        xValues: [2, 1, 2, 1],
        yValues: [[20, 10, 40, 30]],
        groupValues: ["red", "red", "blue", "blue"],
      },
      ["#111", "#222"],
      "#000",
    );

    expect(traces).toMatchObject([
      {
        name: "red",
        x: [1, 2],
        y: [10, 20],
        line: { color: "#111" },
      },
      {
        name: "blue",
        x: [1, 2],
        y: [30, 40],
        line: { color: "#222" },
      },
    ]);
  });

  it("builds one bar trace for each selected stacked value", () => {
    const traces = buildTraces(
      { chartType: "stackedbar", yColumns: ["Passed", "Failed"] },
      {
        xValues: [2, 1],
        yValues: [[4, 5], [18, 17]],
        groupValues: null,
      },
      ["#111", "#222"],
      "#000",
    );

    expect(traces).toMatchObject([
      { type: "bar", name: "Passed", x: [1, 2], y: [5, 4] },
      { type: "bar", name: "Failed", x: [1, 2], y: [17, 18] },
    ]);
  });

  it("builds an aggregated heatmap from a precomputed grid", () => {
    const [trace] = buildTraces(
      {
        chartType: "heatmap",
        heatmapMode: "aggregate",
        xColumn: "cut",
        yColumn: "color",
        valueColumn: "carat",
        aggFunc: "mean",
      },
      {
        xValues: ["Ideal", "Fair"],
        yValues: ["E", "G"],
        zValues: [[2, null], [null, 2]],
        groupValues: null,
      },
      ["#111", "#222"],
      "#000",
    );

    expect(trace).toMatchObject({
      type: "heatmap",
      x: ["Ideal", "Fair"],
      y: ["E", "G"],
      z: [[2, null], [null, 2]],
    });
  });

  it("builds a correlation heatmap from a precomputed matrix", () => {
    const [trace] = buildTraces(
      {
        chartType: "heatmap",
        heatmapMode: "correlation",
        correlationColumns: ["carat", "depth", "table"],
      },
      {
        xValues: ["carat", "depth", "table"],
        yValues: ["carat", "depth", "table"],
        zValues: [[1, 1, -1], [1, 1, -1], [-1, -1, 1]],
        groupValues: null,
      },
      ["#111", "#222"],
      "#000",
    );

    expect(trace).toMatchObject({
      type: "heatmap",
      x: ["carat", "depth", "table"],
      y: ["carat", "depth", "table"],
      z: [[1, 1, -1], [1, 1, -1], [-1, -1, 1]],
      zmin: -1,
      zmax: 1,
    });
  });

  it("builds a heatmap directly from pivot table values", () => {
    const [trace] = buildTraces(
      {
        chartType: "heatmap",
        heatmapMode: "pivot",
        xColumn: "region",
        yColumns: ["January", "February"],
        pivotColumnDimension: "month",
        pivotMeasureLabel: "sum of revenue",
      },
      {
        xValues: ["North", "South"],
        yValues: [["10", "30"], ["20", ""]],
        groupValues: null,
      },
      ["#111", "#222"],
      "#000",
    );

    expect(trace).toMatchObject({
      type: "heatmap",
      x: ["January", "February"],
      y: ["North", "South"],
      z: [[10, 20], [30, null]],
    });
  });

  it("transposes heatmap values and axes", () => {
    const [trace] = buildTraces(
      {
        chartType: "heatmap",
        heatmapMode: "pivot",
        transpose: true,
        xColumn: "region",
        yColumns: ["January", "February"],
        pivotColumnDimension: "month",
        pivotMeasureLabel: "sum of revenue",
      },
      {
        xValues: ["North", "South"],
        yValues: [["10", "30"], ["20", ""]],
        groupValues: null,
      },
      ["#111", "#222"],
      "#000",
    );

    expect(trace).toMatchObject({
      x: ["North", "South"],
      y: ["January", "February"],
      z: [[10, 20], [30, null]],
      transpose: true,
    });
  });
});
