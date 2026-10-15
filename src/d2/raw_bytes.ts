/**
 * Bytes kept from a save file (see `ID2SUnknownData`) as a Uint8Array. Also accepts a number
 * array or a typed array that went through JSON (an object with numeric keys).
 */
export function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value && typeof value === "object") return Uint8Array.from(Object.values(value as Record<string, number>));
  return undefined;
}
