import type { SnaplogEntry, SnaplogQuery } from "./types";

export function createMemorySnaplogStore(maxEntries = 500) {
  let entries: SnaplogEntry[] = [];

  return {
    record(entry: SnaplogEntry): void {
      entries = [...entries, entry].slice(-maxEntries);
    },
    read(): SnaplogEntry[] {
      return [...entries];
    },
    clear(): void {
      entries = [];
    }
  };
}

export function queryEntries(entries: SnaplogEntry[], query: SnaplogQuery): SnaplogEntry[] {
  return entries.filter((entry) => {
    if (query.variable && entry.variable !== query.variable) return false;
    if (query.source && !entry.source.includes(query.source)) return false;
    if (query.after !== undefined && entry.timestamp < query.after) return false;
    if (query.event && entry.event !== query.event) return false;
    if (query.flowId && entry.flowId !== query.flowId) return false;
    if (query.tags?.some((tag) => !entry.tags?.includes(tag))) return false;
    return true;
  });
}
