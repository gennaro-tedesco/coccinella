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
});
