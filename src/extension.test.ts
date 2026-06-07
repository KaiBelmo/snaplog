import { describe, expect, it, vi } from "vitest";
import { createExtensionSnaplogTransport, queryExtensionSnaplogEntries } from "./extension";
import type { SnaplogEntry } from "./types";

function createStorage(initial: Record<string, unknown> = {}) {
  let values = { ...initial };
  return {
    async get(key?: string | string[] | Record<string, unknown> | null) {
      if (typeof key === "string") return { [key]: values[key] };
      return { ...values };
    },
    async set(items: Record<string, unknown>) {
      values = { ...values, ...items };
    },
    async remove(key: string | string[]) {
      for (const item of Array.isArray(key) ? key : [key]) {
        delete values[item];
      }
    }
  };
}

const createEntry = (overrides: Partial<SnaplogEntry>): SnaplogEntry => ({
  sessionId: "sess",
  timestamp: 1,
  runtime: "extension-background",
  source: "background",
  event: "snapshot",
  ...overrides
});

describe("extension snaplog transport", () => {
  it("stores bounded entries in extension storage", async () => {
    const storage = createStorage();
    const transport = createExtensionSnaplogTransport({ storage, key: "logs", maxEntries: 2 });

    await transport.record(createEntry({ variable: "first", timestamp: 1 }));
    await transport.record(createEntry({ variable: "second", timestamp: 2 }));
    await transport.record(createEntry({ variable: "third", timestamp: 3 }));

    await expect(transport.read?.()).resolves.toMatchObject([
      { variable: "second" },
      { variable: "third" }
    ]);
  });

  it("keeps local storage when optional forwarding fails", async () => {
    const storage = createStorage();
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    const transport = createExtensionSnaplogTransport({
      storage,
      key: "logs",
      forwardUrl: "http://127.0.0.1:7777/log",
      shouldForward: () => true,
      fetch: fetchMock
    });

    await transport.record(createEntry({ variable: "saved" }));

    await expect(queryExtensionSnaplogEntries(storage, { variable: "saved" }, "logs")).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("serializes concurrent writes so entries are not lost", async () => {
    const storage = createStorage();
    const transport = createExtensionSnaplogTransport({ storage, key: "logs" });

    await Promise.all([
      transport.record(createEntry({ variable: "first", timestamp: 1 })),
      transport.record(createEntry({ variable: "second", timestamp: 2 })),
      transport.record(createEntry({ variable: "third", timestamp: 3 }))
    ]);

    await expect(transport.read?.()).resolves.toMatchObject([
      { variable: "first" },
      { variable: "second" },
      { variable: "third" }
    ]);
  });
});
