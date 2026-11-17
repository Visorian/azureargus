export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject

export interface JsonObject {
  readonly [key: string]: JsonValue
}

/**
 * Narrows a parsed payload to an object so its fields can be read by key.
 * Callers still check each field's type before using it.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
