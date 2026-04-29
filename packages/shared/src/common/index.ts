import { z } from "zod";

/** JSON Schema subset used for plugin-supplied config shapes. Kept deliberately permissive. */
export type JSONSchema = Record<string, unknown>;

/** Converts a Zod schema to a JSON Schema object, without the $schema meta URI. */
export function zodToItemSchema(schema: z.ZodType): JSONSchema {
  const result = { ...(z.toJSONSchema(schema) as JSONSchema) };
  delete result.$schema;
  return result;
}

export const jsonSchemaSchema = z.record(z.string(), z.unknown());

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
