function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export const JSON_ARRAY_ITEM_PATH_SEGMENT = null;

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

export function resolveJsonSchemaPaths(value, schemaPath, resolvedPath = []) {
  if (schemaPath.length === 0) return [resolvedPath];
  const [segment, ...remaining] = schemaPath;
  if (segment === JSON_ARRAY_ITEM_PATH_SEGMENT) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) =>
      resolveJsonSchemaPaths(item, remaining, [...resolvedPath, index]),
    );
  }
  if (
    value === null ||
    typeof value !== "object" ||
    !Object.hasOwn(value, segment)
  ) {
    return [];
  }
  return resolveJsonSchemaPaths(
    value[segment],
    remaining,
    [...resolvedPath, segment],
  );
}

export function resolveJsonNavigationTargets(value, schemaPath) {
  const range = schemaPath.at(-1) === JSON_ARRAY_ITEM_PATH_SEGMENT;
  return {
    paths: resolveJsonSchemaPaths(
      value,
      range ? schemaPath.slice(0, -1) : schemaPath,
    ),
    range,
  };
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

  function visit(current, path, keyMatches = false) {
    const type = jsonType(current);
    const valueMatches =
      type !== "object" && type !== "array" && matchesText(current);
    if (keyMatches || valueMatches) matches.push({ path });
    if (type === "object") {
      for (const [key, child] of Object.entries(current)) {
        visit(child, [...path, key], matchesText(key));
      }
    } else if (type === "array") {
      current.forEach((child, index) => visit(child, [...path, index]));
    }
  }

  visit(value, []);
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
