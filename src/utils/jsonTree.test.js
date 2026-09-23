import { describe, expect, it } from "vitest";
import {
  buildJsonKeyTree,
  findJsonMatches,
  JSON_ARRAY_ITEM_PATH_SEGMENT,
  resolveJsonNavigationPath,
  resolveJsonNavigationTargets,
  resolveJsonSchemaPath,
} from "./jsonTree";

describe("buildJsonKeyTree", () => {
  it("preserves nested object keys", () => {
    expect(buildJsonKeyTree({ user: { name: "Ada" } })).toEqual({
      types: ["object"],
      children: {
        user: {
          types: ["object"],
          children: { name: { types: ["string"] } },
        },
      },
    });
  });

  it("unions keys and value types across array items", () => {
    const schema = buildJsonKeyTree([
      { id: 1, name: "Ada" },
      { id: "two", active: true },
    ]);

    expect(schema.item).toEqual({
      types: ["object"],
      children: {
        id: { types: ["number", "string"] },
        name: { types: ["string"] },
        active: { types: ["boolean"] },
      },
    });
  });

  it("supports primitive and empty-array roots", () => {
    expect(buildJsonKeyTree(null)).toEqual({ types: ["null"] });
    expect(buildJsonKeyTree([])).toEqual({ types: ["array"] });
  });

  it("resolves unioned array keys to the first matching item", () => {
    const value = [{ id: 1 }, { id: 2, active: true }];

    expect(
      resolveJsonSchemaPath(value, [JSON_ARRAY_ITEM_PATH_SEGMENT, "active"]),
    ).toEqual([1, "active"]);
  });

  it("resolves an array schema node to the whole array", () => {
    const value = { friends: [{ name: "Ada" }] };

    expect(
      resolveJsonNavigationPath(value, [
        "friends",
        JSON_ARRAY_ITEM_PATH_SEGMENT,
      ]),
    ).toEqual(["friends"]);
  });

  it("resolves a key beneath an array to every matching item", () => {
    const value = {
      friends: [{ id: 1 }, { name: "Ada" }, { id: 2 }],
    };

    expect(
      resolveJsonNavigationTargets(value, [
        "friends",
        JSON_ARRAY_ITEM_PATH_SEGMENT,
        "id",
      ]),
    ).toEqual({
      paths: [
        ["friends", 0, "id"],
        ["friends", 2, "id"],
      ],
      range: false,
    });
  });

  it("finds JSON keys and primitive values in document order", () => {
    const value = {
      title: "Hello world",
      nested: { helloKey: 1 },
      items: ["HELLO", "other"],
    };

    expect(findJsonMatches(value, "hello", false, false)).toEqual([
      { path: ["title"] },
      { path: ["nested", "helloKey"] },
      { path: ["items", 0] },
    ]);
  });

  it("supports case-sensitive regular expressions", () => {
    expect(
      findJsonMatches({ lower: "hello", upper: "HELLO" }, "^HEL", true, true),
    ).toEqual([{ path: ["upper"] }]);
  });
});
