import { JSON_DEFAULT_EXPANDED_DEPTH } from "../constants";

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export const JSON_ARRAY_ITEM_PATH_SEGMENT = null;
export const JSON_ROOT_PATH = JSON.stringify([]);

export function encodeChildPath(parentPath, key) {
  const segment = JSON.stringify(key);
  return parentPath === JSON_ROOT_PATH
    ? `[${segment}]`
    : `${parentPath.slice(0, -1)},${segment}]`;
}

export function encodedAncestorPaths(path, includeSelf) {
  const encoded = [];
  let current = JSON_ROOT_PATH;
  const end = includeSelf ? path.length : path.length - 1;
  for (let index = 0; index < end; index += 1) {
    current = encodeChildPath(current, path[index]);
    encoded.push(current);
  }
  return encoded;
}

export function flattenJsonTree(data, overrides) {
  const rows = [];

  function visitChildren(value, type, encodedPath, depth, parent) {
    if (type === "array") {
      for (let index = 0; index < value.length; index += 1) {
        visit(String(index), value[index], encodeChildPath(encodedPath, index), depth, parent, true);
      }
    } else {
      for (const key of Object.keys(value)) {
        visit(key, value[key], encodeChildPath(encodedPath, key), depth, parent, false);
      }
    }
  }

  function visit(label, value, encodedPath, depth, parent, inArray) {
    const type = jsonType(value);
    const expandable = type === "array" || type === "object";
    const size = type === "array" ? value.length : expandable ? Object.keys(value).length : 0;
    const expanded =
      expandable &&
      (overrides.get(encodedPath) ?? depth < JSON_DEFAULT_EXPANDED_DEPTH);
    const index = rows.length;
    rows.push({ label, value, type, encodedPath, depth, parent, inArray, expandable, expanded, size });
    if (expanded && size > 0) visitChildren(value, type, encodedPath, depth + 1, index);
  }

  const rootType = jsonType(data);
  const rootHasEntries =
    (rootType === "array" && data.length > 0) ||
    (rootType === "object" && Object.keys(data).length > 0);
  if (rootHasEntries) visitChildren(data, rootType, JSON_ROOT_PATH, 0, -1);
  else visit("value", data, JSON_ROOT_PATH, 0, -1, false);
  return rows;
}

export function encodedRowSchemaPath(rows, index) {
  const segments = [];
  for (let current = index; current >= 0; current = rows[current].parent) {
    const row = rows[current];
    if (row.encodedPath === JSON_ROOT_PATH) break;
    segments.push(row.inArray ? JSON_ARRAY_ITEM_PATH_SEGMENT : row.label);
  }
  return JSON.stringify(segments.reverse());
}

export function resolveJsonSchemaPath(value, schemaPath, resolvedPath = []) {
  if (schemaPath.length === 0) return resolvedPath;
  const [segment, ...remaining] = schemaPath;
  if (segment === JSON_ARRAY_ITEM_PATH_SEGMENT) {
    if (!Array.isArray(value)) return null;
    for (let index = 0; index < value.length; index += 1) {
      const resolved = resolveJsonSchemaPath(
        value[index],
        remaining,
        [...resolvedPath, index],
      );
      if (resolved) return resolved;
    }
    return null;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    !Object.hasOwn(value, segment)
  ) {
    return null;
  }
  return resolveJsonSchemaPath(
    value[segment],
    remaining,
    [...resolvedPath, segment],
  );
}

export function resolveJsonNavigationPath(value, schemaPath) {
  const targetsArray =
    schemaPath.at(-1) === JSON_ARRAY_ITEM_PATH_SEGMENT;
  return resolveJsonSchemaPath(
    value,
    targetsArray ? schemaPath.slice(0, -1) : schemaPath,
  );
}

export function findJsonMatches(value, query, isRegex, isCaseSensitive) {
  if (!query) return [];
  const pattern = isRegex
    ? new RegExp(query, isCaseSensitive ? "" : "i")
    : null;
  const expected = isCaseSensitive ? query : query.toLocaleLowerCase();
  const matchesText = (candidate) => {
    const text = String(candidate);
    return pattern
      ? pattern.test(text)
      : (isCaseSensitive ? text : text.toLocaleLowerCase()).includes(expected);
  };
  const matches = [];
  const path = [];

  function visit(current, keyMatches) {
    const type = jsonType(current);
    const valueMatches =
      type !== "object" && type !== "array" && matchesText(current);
    if (keyMatches || valueMatches) matches.push({ path: [...path] });
    if (type === "object") {
      for (const key of Object.keys(current)) {
        path.push(key);
        visit(current[key], matchesText(key));
        path.pop();
      }
    } else if (type === "array") {
      for (let index = 0; index < current.length; index += 1) {
        path.push(index);
        visit(current[index], false);
        path.pop();
      }
    }
  }

  visit(value, false);
  return matches;
}

function mergeSchemas(target, source) {
  for (const type of source.types) {
    if (!target.types.includes(type)) target.types.push(type);
  }
  for (const [key, child] of Object.entries(source.children ?? {})) {
    target.children ??= {};
    target.children[key] = target.children[key]
      ? mergeSchemas(target.children[key], child)
      : child;
  }
  if (source.item) {
    target.item = target.item ? mergeSchemas(target.item, source.item) : source.item;
  }
  return target;
}

export function buildJsonKeyTree(value) {
  const type = jsonType(value);
  const schema = { types: [type] };
  if (type === "object") {
    schema.children = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, buildJsonKeyTree(child)]),
    );
  }
  if (type === "array") {
    for (const item of value) {
      const itemSchema = buildJsonKeyTree(item);
      schema.item = schema.item
        ? mergeSchemas(schema.item, itemSchema)
        : itemSchema;
    }
  }
  return schema;
}
