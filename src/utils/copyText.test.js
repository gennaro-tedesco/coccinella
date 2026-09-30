import { describe, expect, it } from "vitest";
import { formatCopiedValue } from "./copyText";

describe("formatCopiedValue", () => {
  it("preserves raw copied values by default", () => {
    expect(formatCopiedValue('Ada "Lovelace"', null)).toBe('Ada "Lovelace"');
  });

  it("wraps copied values and escapes embedded double quotes", () => {
    expect(formatCopiedValue('Ada "Lovelace"', '"')).toBe('"Ada ""Lovelace"""');
  });

  it("wraps copied values and escapes embedded single quotes", () => {
    expect(formatCopiedValue("Ada's notes", "'")).toBe("'Ada''s notes'");
  });
});
