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
        yValues: null,
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
});
