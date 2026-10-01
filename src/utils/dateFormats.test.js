import { describe, expect, it } from "vitest";
import {
  formatDateValue,
  formatDateValueForPlot,
  plotlyDateAxis,
} from "./dateFormats";

describe("formatDateValue", () => {
  it("formats dates using the selected calendar format", () => {
    expect(formatDateValue("2026-09-24", "dmy")).toBe("24/09/2026");
    expect(formatDateValue("24/09/2026", "ymd")).toBe("2026-09-24");
  });

  it("formats Unix and readable timestamps", () => {
    expect(formatDateValue("2025-08-29T06:55:53.785Z", "unix")).toBe("1756450553");
    expect(formatDateValue("1756450553785", "timestamp")).toBe("2025-08-29 06:55:53.785");
  });

  it("formats timestamps with a space before the timezone offset", () => {
    expect(formatDateValue("2026-09-29 16:48:24.686 +0200", "ymd")).toBe(
      "2026-09-29",
    );
    expect(
      formatDateValue("2026-09-29 16:48:24.686 +0200", "month-day"),
    ).toBe("Sep 29");
  });

  it("keeps invalid and automatic values unchanged", () => {
    expect(formatDateValue("not a date", "ymd")).toBe("not a date");
    expect(formatDateValue("2026-09-24", "auto")).toBe("2026-09-24");
  });

  it("preserves timestamp precision or reduces plotted values to dates", () => {
    const value = "2026-09-29 16:48:24.686 +0200";
    expect(formatDateValueForPlot(value, "timestamp")).toBe(
      "2026-09-29T14:48:24.686Z",
    );
    expect(formatDateValueForPlot(value, "ymd")).toBe("2026-09-29");
    expect(formatDateValueForPlot(value, "month-day")).toBe("2026-09-29");
  });

  it("maps dataset date formats to Plotly date axes", () => {
    expect(plotlyDateAxis("timestamp")).toEqual({
      type: "date",
      tickformat: "%Y-%m-%d %H:%M:%S.%L",
      hoverformat: "%Y-%m-%d %H:%M:%S.%L",
    });
    expect(plotlyDateAxis("month-day")).toEqual({
      type: "date",
      tickformat: "%b %-d",
      hoverformat: "%b %-d",
    });
  });
});
