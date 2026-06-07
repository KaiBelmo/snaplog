import type { SnaplogSerializeOptions } from "./types";

// Built-in sensitive key patterns. "value" intentionally excluded
// to avoid redacting innocent data like { value: 42 }.
const BUILT_IN_SENSITIVE_KEYS =
  /^(token|authorization|passphrase|password|secret|ciphertext|iv|salt|encrypteddata|apikey|api_key|privatekey|private_key)$/i;

const SENSITIVE_STRING_PATTERN =
  /\b(bearer\s+[a-z0-9._~+/=-]+|token[:=]\S+|passphrase[:=]\S+|password[:=]\S+|secret[:=]\S+|sk-[a-z0-9_-]{8,})\b/i;

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ARRAY_ITEMS = 20;
const DEFAULT_MAX_STRING_LENGTH = 500;

export function buildSerializer(opts: SnaplogSerializeOptions = {}) {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxArrayItems = opts.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS;
  const maxStringLength = opts.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;

  // Build a combined set of extra sensitive key names (lowercase) for O(1) lookup.
  const extraKeys = new Set((opts.redactKeys ?? []).map((k) => k.toLowerCase()));

  function isSensitiveKey(key: string): boolean {
    return BUILT_IN_SENSITIVE_KEYS.test(key) || extraKeys.has(key.toLowerCase());
  }

  function redactString(value: string): string {
    if (SENSITIVE_STRING_PATTERN.test(value)) return "[redacted]";
    return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}...` : value;
  }

  function serialize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function") return "[Function]";
    if (typeof value === "symbol") return value.toString();

    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message),
        stack: value.stack ? redactString(value.stack) : undefined
      };
    }

    if (depth >= maxDepth) return "[max-depth]";

    if (Array.isArray(value)) {
      return value.slice(0, maxArrayItems).map((item) => serialize(item, depth + 1, seen));
    }

    if (typeof value === "object") {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        output[key] = isSensitiveKey(key) ? "[redacted]" : serialize(entry, depth + 1, seen);
      }
      return output;
    }

    return String(value);
  }

  return { serialize };
}

/**
 * Default serializer with stock options — kept for backward compatibility
 * and for callers that don't need custom limits.
 */
const _default = buildSerializer();
export const safeSerialize = _default.serialize;

export function errorToDebug(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
