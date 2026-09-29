import { describe, expect, it } from "vitest";
import { formatCopiedValue } from "./copyText";

describe("formatCopiedValue", () => {
  it("preserves raw copied values by default", () => {
    expect(formatCopiedValue('Ada "Lovelace"', false)).toBe('Ada "Lovelace"');
  });

  it("wraps copied values and escapes embedded quotes", () => {
    expect(formatCopiedValue('Ada "Lovelace"', true)).toBe('"Ada ""Lovelace"""');
  });
});
