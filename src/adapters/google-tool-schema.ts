type Schema = Record<string, unknown>;

// Google documents this function-schema subset: type, nullable, required, format, description,
// properties, items, enum, anyOf, $ref, and $defs. We inline local refs and normalize anyOf, so
// only the eight scalar/container keywords below are ever emitted. Building from an allowlist
// prevents new MCP/JSON-Schema annotations from turning into provider-wide 400 responses.
const ALLOWED_TYPES = new Set(["string", "integer", "number", "boolean", "array", "object"]);
const MAX_SCHEMA_DEPTH = 24; // Google's documented nesting limit is 32; leave headroom for CCA.
const MAX_DEREF_DEPTH = 16;
const MAX_SCHEMA_NODES = 1_024;

interface SanitizeState {
  activeRefs: Set<string>;
  remainingNodes: number;
}

function isRecord(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveRef(ref: string, defs: Map<string, unknown>): unknown {
  // Only local pointers into the schema's own $defs/definitions are safe to inline.
  const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref);
  if (!match) return undefined;
  try {
    return defs.get(decodeURIComponent(match[1].replace(/~1/g, "/").replace(/~0/g, "~")));
  } catch {
    return undefined;
  }
}

function collectDefs(root: unknown, defs: Map<string, unknown>): void {
  if (!isRecord(root)) return;
  for (const bag of ["$defs", "definitions"] as const) {
    const group = root[bag];
    if (!isRecord(group)) continue;
    for (const [name, value] of Object.entries(group)) {
      if (!defs.has(name)) defs.set(name, value);
    }
  }
}

function normalizeType(value: unknown, out: Schema, preserveNullType: boolean): void {
  const candidates = Array.isArray(value) ? value : [value];
  let sawNull = false;

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const type = candidate.toLowerCase();
    if (type === "null") {
      sawNull = true;
    } else if (out.type === undefined && ALLOWED_TYPES.has(type)) {
      out.type = type;
    }
  }

  if (!sawNull) return;
  if (out.type !== undefined) out.nullable = true;
  else if (preserveNullType) out.type = "null";
  else out.nullable = true;
}

function sanitizeEnum(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = [...new Set(value.filter((item): item is string => typeof item === "string"))];
  return values.length > 0 ? values : undefined;
}

function normalizeAnyOf(
  value: unknown,
  defs: Map<string, unknown>,
  state: SanitizeState,
  depth: number,
  refDepth: number,
): Schema {
  if (!Array.isArray(value) || value.length === 0) return {};
  const schemas = value.map(item => sanitizeSchema(item, defs, state, depth + 1, refDepth, true));

  const nonNullSchemas = schemas.filter(schema => schema.type !== "null");
  const nullSchemas = schemas.filter(schema => schema.type === "null");
  if (
    nonNullSchemas.length === 1
    && nullSchemas.length > 0
    && nullSchemas.every(schema => Object.keys(schema).every(key => key === "type"))
  ) {
    return { ...nonNullSchemas[0], nullable: true };
  }

  const type = schemas[0]?.type;
  const sameType = schemas.length > 0 && schemas.every(schema => schema.type === type);
  const enumOnly = schemas.every(schema => {
    const allowedKeys = type === undefined ? new Set(["enum"]) : new Set(["type", "enum"]);
    return Array.isArray(schema.enum) && Object.keys(schema).every(key => allowedKeys.has(key));
  });
  if (sameType && enumOnly && type !== "null") {
    const values = sanitizeEnum(schemas.flatMap(schema => schema.enum as unknown[]));
    if (values) return { ...(typeof type === "string" ? { type } : {}), enum: values };
  }

  // CCA's Claude bridge turns typed anyOf branches into an invalid input_schema. Widen only this
  // node when a union cannot be collapsed losslessly; parent annotations and structure survive.
  return {};
}

function sanitizeProperties(
  value: unknown,
  defs: Map<string, unknown>,
  state: SanitizeState,
  depth: number,
  refDepth: number,
): Record<string, Schema> | undefined {
  if (!isRecord(value)) return undefined;
  const properties: Record<string, Schema> = Object.create(null) as Record<string, Schema>;
  for (const [name, schema] of Object.entries(value)) {
    // Property names form a name bag and must never be interpreted as schema keywords.
    properties[name] = sanitizeSchema(schema, defs, state, depth + 1, refDepth, false);
  }
  return properties;
}

function sanitizeSchema(
  node: unknown,
  defs: Map<string, unknown>,
  state: SanitizeState,
  depth: number,
  refDepth: number,
  preserveNullType: boolean,
): Schema {
  if (depth >= MAX_SCHEMA_DEPTH || !isRecord(node) || state.remainingNodes-- <= 0) return {};

  if (
    typeof node.$ref === "string"
    && refDepth < MAX_DEREF_DEPTH
    && !state.activeRefs.has(node.$ref)
  ) {
    const target = resolveRef(node.$ref, defs);
    if (isRecord(target)) {
      const merged: Schema = { ...target };
      for (const [key, value] of Object.entries(node)) {
        if (key !== "$ref") merged[key] = value;
      }
      state.activeRefs.add(node.$ref);
      try {
        return sanitizeSchema(merged, defs, state, depth, refDepth + 1, preserveNullType);
      } finally {
        state.activeRefs.delete(node.$ref);
      }
    }
  }

  const out: Schema = {};
  normalizeType(node.type, out, preserveNullType);

  if (typeof node.nullable === "boolean") out.nullable = node.nullable;
  if (typeof node.description === "string") out.description = node.description;
  if (typeof node.format === "string") out.format = node.format;

  const enumValues = sanitizeEnum(node.enum ?? (typeof node.const === "string" ? [node.const] : undefined));
  if (enumValues) out.enum = enumValues;

  const properties = sanitizeProperties(node.properties, defs, state, depth, refDepth);
  if (properties) out.properties = properties;

  if (isRecord(node.items)) {
    out.items = sanitizeSchema(node.items, defs, state, depth + 1, refDepth, false);
  }

  if (Array.isArray(node.required)) {
    out.required = [...new Set(node.required.filter((item): item is string => typeof item === "string"))];
  }

  if (node.anyOf !== undefined) Object.assign(out, normalizeAnyOf(node.anyOf, defs, state, depth, refDepth));
  return out;
}

export function sanitizeGeminiToolParameters(parameters: unknown): Record<string, unknown> {
  try {
    const defs = new Map<string, unknown>();
    collectDefs(parameters, defs);
    const state: SanitizeState = { activeRefs: new Set(), remainingNodes: MAX_SCHEMA_NODES };
    const root = sanitizeSchema(parameters, defs, state, 0, 0, false);

    // Function arguments are always an object. Claude additionally rejects root composition and a
    // missing root type even when those forms are valid general-purpose JSON Schema.
    root.type = "object";
    if (!isRecord(root.properties)) root.properties = {};
    return root;
  } catch {
    // Last-resort containment: no third-party schema may break every tool in the request.
    return { type: "object", properties: {} };
  }
}
