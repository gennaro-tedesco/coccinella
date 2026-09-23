import { describe, expect, it } from "vitest";
import {
  buildJsonKeyTree,
  encodedAncestorPaths,
  findJsonMatches,
  flattenJsonTree,
  JSON_ROOT_PATH,
  JSON_ARRAY_ITEM_PATH_SEGMENT,
  encodedRowSchemaPath,
  resolveJsonNavigationPath,
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

  it("matches every row beneath an array against the key's schema path", () => {
    const value = {
      friends: [{ id: 1 }, { name: "Ada" }, { id: 2 }],
    };
    const rows = flattenJsonTree(value, new Map());
    const target = JSON.stringify(["friends", JSON_ARRAY_ITEM_PATH_SEGMENT, "id"]);

    expect(
      rows
        .filter((_row, index) => encodedRowSchemaPath(rows, index) === target)
        .map((row) => row.encodedPath),
    ).toEqual([
      JSON.stringify(["friends", 0, "id"]),
      JSON.stringify(["friends", 2, "id"]),
    ]);
    expect(encodedRowSchemaPath(flattenJsonTree(null, new Map()), 0)).toBe(
      JSON_ROOT_PATH,
    );
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

describe("flattenJsonTree", () => {
  const value = { user: { name: "Ada", tags: ["a"] }, count: 2 };

  it("encodes row paths exactly like JSON.stringify of the path", () => {
    const rows = flattenJsonTree(value, new Map());

    expect(rows.map((row) => row.encodedPath)).toEqual([
      JSON.stringify(["user"]),
      JSON.stringify(["user", "name"]),
      JSON.stringify(["user", "tags"]),
      JSON.stringify(["user", "tags", 0]),
      JSON.stringify(["count"]),
    ]);
    expect(rows.map((row) => row.parent)).toEqual([-1, 0, 0, 2, -1]);
  });

  it("applies expand and collapse overrides", () => {
    const rows = flattenJsonTree(
      value,
      new Map([
        [JSON.stringify(["user"]), false],
        [JSON.stringify(["user", "tags"]), true],
      ]),
    );

    expect(rows.map((row) => row.label)).toEqual(["user", "count"]);
    expect(
      flattenJsonTree(value, new Map([[JSON.stringify(["user", "tags"]), false]]))
        .map((row) => row.encodedPath),
    ).not.toContain(JSON.stringify(["user", "tags", 0]));
  });

  it("renders a primitive root as a single value row", () => {
    expect(flattenJsonTree(null, new Map())).toMatchObject([
      { label: "value", encodedPath: JSON_ROOT_PATH, parent: -1 },
    ]);
  });

  it("lists encoded ancestors of a path", () => {
    expect(encodedAncestorPaths(["items", 3, "id"], false)).toEqual([
      JSON.stringify(["items"]),
      JSON.stringify(["items", 3]),
    ]);
    expect(encodedAncestorPaths(["items"], true)).toEqual([
      JSON.stringify(["items"]),
    ]);
  });
});
