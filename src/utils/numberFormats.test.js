import { describe, expect, it } from "vitest";
import { formatNumberValue } from "./numberFormats";

describe("formatNumberValue", () => {
  it("automatically omits decimals from integer values", () => {
    expect(formatNumberValue("12")).toBe("12");
    expect(formatNumberValue("12.5")).toBe("12.50");
  });

  it("applies a manual precision to every value", () => {
    expect(formatNumberValue("12", 2)).toBe("12.00");
    expect(formatNumberValue("12.5", 2)).toBe("12.50");
    expect(formatNumberValue("12.5", 0)).toBe("13");
  });
});
