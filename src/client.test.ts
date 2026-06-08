import { describe, expect, it, vi } from "vitest";
import { createMemorySnaplogStore, createSnaplogClient, safeSerialize } from "./index.js";

describe("snaplog core", () => {
  it("serializes debug values without leaking sensitive or unsafe shapes", () => {
    const circular: Record<string, unknown> = {
      token: "secret",
      nested: { password: "pw", ok: true },
      fn: () => undefined,
      error: new Error("bad"),
      rawSecret: "Bearer abcdefghijklmnop",
      list: Array.from({ length: 25 }, (_, index) => index)
    };
    circular.self = circular;

    expect(safeSerialize(circular)).toMatchObject({
      token: "[redacted]",
      nested: { password: "[redacted]", ok: true },
      fn: "[Function]",
      rawSecret: "[redacted]",
      self: "[Circular]"
    });
    expect((safeSerialize(circular) as { list: number[] }).list).toHaveLength(20);
  });

  it("absorbs async transport failures from debug-only paths", async () => {
    const client = createSnaplogClient({
      transport: {
        record: async () => {
          throw new Error("storage unavailable");
        }
      }
    });

    expect(() => client.injectLog({ ok: true })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("records one snapshot entry per injected variable", async () => {
    const store = createMemorySnaplogStore();
    const client = createSnaplogClient({
      sessionId: "sess_test",
      runtime: "node",
      source: "test.ts:1",
      transport: store
    });

    client.injectLog({ count: 2, user: { id: "u1" } }, { tags: ["scan"] });

    await expect(client.readLogs()).resolves.toMatchObject([
      { event: "snapshot", variable: "count", value: 2, sessionId: "sess_test", runtime: "node", source: "test.ts:1", tags: ["scan"] },
      { event: "snapshot", variable: "user", value: { id: "u1" } }
    ]);
  });

  it("gates console debug calls while preserving enabled console behavior", async () => {
    const store = createMemorySnaplogStore();
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const disabled = createSnaplogClient({ debugEnabled: () => false, transport: store, console: logger });
    disabled.debugLog("hidden");

    expect(logger.log).not.toHaveBeenCalled();
    await expect(disabled.readLogs()).resolves.toEqual([]);

    const enabled = createSnaplogClient({ debugEnabled: () => true, transport: store, console: logger });
    enabled.debugWarn("visible", { secret: "abc" });

    expect(logger.warn).toHaveBeenCalledWith("visible", { secret: "abc" });
    await expect(enabled.queryLogs({ event: "debug" })).resolves.toMatchObject([
      { event: "debug", level: "warn", message: "visible {\"secret\":\"[redacted]\"}" }
    ]);
  });

  it("tracks bounded flow attempts and error completion", async () => {
    const store = createMemorySnaplogStore();
    const client = createSnaplogClient({ transport: store });
    const attemptId = await client.beginDebugAttempt({ stage: "start" });

    await client.recordDebugEvent("middle", { count: 1 }, attemptId);
    await client.finishDebugAttempt("error", new Error("failed"), attemptId);

    await expect(client.getDebugAttempt(attemptId)).resolves.toMatchObject({
      attemptId,
      status: "error",
      events: [
        { stage: "attempt-start", details: { stage: "start" } },
        { stage: "middle", details: { count: 1 } }
      ],
      error: { name: "Error", message: "failed" }
    });
    await expect(client.queryLogs({ event: "flow", flowId: attemptId })).resolves.toHaveLength(3);
  });
});
