import { queryEntries } from "./memory-store";
import type { SnaplogEntry, SnaplogQuery, SnaplogTransport } from "./types";

export const DEFAULT_EXTENSION_SNAPLOG_KEY = "snaplogDebug";

/**
 * chrome.storage quota is typically 5 MB for local and 100 KB for sync.
 * We guard against hitting it by capping stored entries and providing a
 * warning when we're close to the limit.
 */
const DEFAULT_MAX_ENTRIES = 500;
/** Warn in the console when stored entry count exceeds this ratio of maxEntries. */
const QUOTA_WARN_RATIO = 0.8;

type ChromeStorageAreaLike = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

type ExtensionTransportOptions = {
  storage: ChromeStorageAreaLike;
  key?: string;
  /**
   * Maximum number of entries to keep in storage.
   * Older entries are evicted when the cap is reached.
   * @default 500
   */
  maxEntries?: number;
  /**
   * When true, a console.warn is emitted when stored entries exceed
   * 80 % of maxEntries (configurable via quotaWarnRatio).
   * @default true
   */
  warnOnQuota?: boolean;
  /** Ratio of maxEntries at which a quota warning is emitted. @default 0.8 */
  quotaWarnRatio?: number;
  forwardUrl?: string;
  shouldForward?: () => boolean;
  fetch?: typeof fetch;
};

export function createExtensionSnaplogTransport(
  options: ExtensionTransportOptions
): SnaplogTransport {
  const key = options.key ?? DEFAULT_EXTENSION_SNAPLOG_KEY;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const warnOnQuota = options.warnOnQuota ?? true;
  const quotaWarnRatio = options.quotaWarnRatio ?? QUOTA_WARN_RATIO;
  const warnThreshold = Math.floor(maxEntries * quotaWarnRatio);
  const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);

  // Serialize all writes through a promise chain to prevent dropped records.
  let writeQueue = Promise.resolve();

  return {
    async record(entry: SnaplogEntry): Promise<void> {
      writeQueue = writeQueue
        .then(async () => {
          const entries = await readExtensionSnaplogEntries(options.storage, key);

          // Log rotation: trim to (maxEntries - 1) before adding the new entry.
          const trimmed = entries.length >= maxEntries ? entries.slice(-(maxEntries - 1)) : entries;
          const next = [...trimmed, entry];

          await options.storage.set({ [key]: next });

          // Quota proximity warning.
          if (warnOnQuota && next.length >= warnThreshold) {
            console.warn(
              `[snaplog] Extension storage for key "${key}" has ${next.length}/${maxEntries} entries. ` +
                "Consider calling clearLogs() or reducing maxEntries."
            );
          }
        })
        .catch(() => undefined);

      await writeQueue;

      if (!options.forwardUrl || !options.shouldForward?.() || !fetchImpl) return;
      fetchImpl(options.forwardUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      }).catch(() => undefined);
    },

    read(): Promise<SnaplogEntry[]> {
      return readExtensionSnaplogEntries(options.storage, key);
    },

    clear(): Promise<void> {
      return options.storage.remove(key);
    }
  };
}

export async function readExtensionSnaplogEntries(
  storage: ChromeStorageAreaLike,
  key = DEFAULT_EXTENSION_SNAPLOG_KEY
): Promise<SnaplogEntry[]> {
  const result = await storage.get(key);
  const value = result[key];
  return Array.isArray(value) ? value.filter(isSnaplogEntry) : [];
}

export async function clearExtensionSnaplogEntries(
  storage: ChromeStorageAreaLike,
  key = DEFAULT_EXTENSION_SNAPLOG_KEY
): Promise<void> {
  await storage.remove(key);
}

export async function queryExtensionSnaplogEntries(
  storage: ChromeStorageAreaLike,
  query: SnaplogQuery,
  key = DEFAULT_EXTENSION_SNAPLOG_KEY
): Promise<SnaplogEntry[]> {
  return queryEntries(await readExtensionSnaplogEntries(storage, key), query);
}

function isSnaplogEntry(value: unknown): value is SnaplogEntry {
  return Boolean(
    value &&
      typeof value === "object" &&
      "sessionId" in value &&
      "timestamp" in value &&
      "runtime" in value &&
      "source" in value &&
      "event" in value
  );
}
