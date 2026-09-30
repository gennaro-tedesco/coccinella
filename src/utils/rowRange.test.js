import { describe, expect, it } from "vitest";
import { parseRowSelectionRange } from "./rowRange";

describe("row selection ranges", () => {
  it("parses an inclusive one-based range", () => {
    expect(parseRowSelectionRange("4-12", 20)).toEqual({ start: 3, end: 11 });
  });

  it.each(["", "4", "12-4", "0-4", "4-21"])(
    "rejects invalid range %s",
    (value) => {
      expect(parseRowSelectionRange(value, 20)).toBeNull();
    },
  );
});
