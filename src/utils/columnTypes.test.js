import { describe, expect, it } from "vitest";
import {
  COLUMN_TYPES,
  DEFAULT_COLUMN_TYPE_COLOUR_INDEXES,
} from "./columnTypes";

describe("column type colours", () => {
  it("assigns a theme colour to every supported column type", () => {
    expect(Object.keys(DEFAULT_COLUMN_TYPE_COLOUR_INDEXES)).toEqual(COLUMN_TYPES);
    expect(new Set(Object.values(DEFAULT_COLUMN_TYPE_COLOUR_INDEXES)).size).toBe(
      COLUMN_TYPES.length,
    );
  });
});
