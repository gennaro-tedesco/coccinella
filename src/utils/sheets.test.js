import { describe, expect, it } from "vitest";
import { sheetIdsWithDescendants } from "./sheets";

describe("sheetIdsWithDescendants", () => {
  it("lists each sheet followed by its nested filtered sheets", () => {
    const sheets = {
      a: { children: ["a1", "a2"] },
      a1: { children: ["a1x"] },
      a1x: { children: [] },
      a2: { children: [] },
      b: { children: [] },
    };
    expect(sheetIdsWithDescendants(sheets, ["a", "b"])).toEqual(["a", "a1", "a1x", "a2", "b"]);
  });
});
