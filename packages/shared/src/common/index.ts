import { z } from "zod";

/** JSON Schema subset used for plugin-supplied config shapes. Kept deliberately permissive. */
export type JSONSchema = Record<string, unknown>;

export const jsonSchemaSchema = z.record(z.string(), z.unknown());

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
