import { describe, expect, it } from "vitest";
import { formatDateValue } from "./dateFormats";

describe("formatDateValue", () => {
  it("formats dates using the selected calendar format", () => {
    expect(formatDateValue("2026-09-24", "dmy")).toBe("24/09/2026");
    expect(formatDateValue("24/09/2026", "ymd")).toBe("2026-09-24");
  });

  it("formats Unix and readable timestamps", () => {
    expect(formatDateValue("2025-08-29T06:55:53.785Z", "unix")).toBe("1756450553");
    expect(formatDateValue("1756450553785", "timestamp")).toBe("2025-08-29 06:55:53.785");
  });

  it("keeps invalid and automatic values unchanged", () => {
    expect(formatDateValue("not a date", "ymd")).toBe("not a date");
    expect(formatDateValue("2026-09-24", "auto")).toBe("2026-09-24");
  });
});
