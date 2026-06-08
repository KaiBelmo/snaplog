import { buildSerializer, errorToDebug } from "./serializer.js";
import type {
  InjectLogOptions,
  SnaplogAttemptRecord,
  SnaplogClientOptions,
  SnaplogEntry,
  SnaplogLevel,
  SnaplogQuery,
  SnaplogRuntime,
  SnaplogStatus,
  SnaplogTransport
} from "./types.js";
import { queryEntries } from "./memory-store.js";

const DEFAULT_SOURCE = "unknown";
const DEFAULT_RUNTIME: SnaplogRuntime = "unknown";
const DEFAULT_MAX_ATTEMPTS = 200;

export function createSnaplogClient(options: SnaplogClientOptions = {}) {
  const sessionId = options.sessionId ?? `sess_${Date.now()}`;
  const runtime = options.runtime ?? DEFAULT_RUNTIME;
  const source = options.source ?? DEFAULT_SOURCE;
  const transport = options.transport;
  const debugEnabled = options.debugEnabled ?? (() => true);
  const logger = options.console ?? console;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const batchIntervalMs = options.batchIntervalMs ?? 0;

  // Configurable serializer — picks up user-supplied limits and redact keys.
  const { serialize } = buildSerializer(options.serialize ?? {});

  // --- LRU-capped attempt store ---
  // Keeps insertion order; when the map exceeds maxAttempts, the oldest
  // entry (first key in insertion order) is evicted.
  const attempts = new Map<string, SnaplogAttemptRecord>();

  function addAttempt(id: string, record: SnaplogAttemptRecord): void {
    if (attempts.size >= maxAttempts) {
      // Evict the oldest entry (Maps preserve insertion order).
      const oldest = attempts.keys().next().value;
      if (oldest !== undefined) attempts.delete(oldest);
    }
    attempts.set(id, record);
  }

  // --- Batch flush queue ---
  let batchQueue: SnaplogEntry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleFlush(): void {
    if (flushTimer !== undefined || !batchIntervalMs) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      const toFlush = batchQueue;
      batchQueue = [];
      if (!toFlush.length || !transport) return;
      if (transport.recordBatch) {
        Promise.resolve(transport.recordBatch(toFlush)).catch(() => undefined);
      } else {
        for (const entry of toFlush) {
          Promise.resolve(transport.record(entry)).catch(() => undefined);
        }
      }
    }, batchIntervalMs);
  }

  function record(
    entry: Omit<SnaplogEntry, "sessionId" | "timestamp" | "runtime" | "source"> &
      Partial<Pick<SnaplogEntry, "runtime" | "source" | "timestamp">>
  ): void {
    const next: SnaplogEntry = {
      sessionId,
      timestamp: entry.timestamp ?? Date.now(),
      runtime: entry.runtime ?? runtime,
      source: entry.source ?? source,
      ...entry
    };

    if (!transport) return;

    if (batchIntervalMs > 0) {
      // Queue and flush on interval.
      batchQueue.push(next);
      scheduleFlush();
    } else {
      // Immediate — fire and forget.
      Promise.resolve(transport.record(next)).catch(() => undefined);
    }
  }

  function injectLog(vars: Record<string, unknown>, entryOptions: InjectLogOptions = {}): void {
    for (const [variable, value] of Object.entries(vars)) {
      record({
        event: "snapshot",
        variable,
        value: serialize(value),
        ...entryOptions
      });
    }
  }

  function writeDebug(level: SnaplogLevel, args: unknown[]): void {
    if (!debugEnabled()) return;
    logger[level](...args);
    record({
      event: "debug",
      level,
      message: args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(serialize(arg))))
        .join(" "),
      args: serialize(args) as unknown[]
    });
  }

  async function beginDebugAttempt(details?: unknown): Promise<string> {
    const attemptId = createId();
    const now = new Date().toISOString();
    const recordValue: SnaplogAttemptRecord = {
      attemptId,
      startedAt: now,
      updatedAt: now,
      status: "running",
      events: [{ at: now, stage: "attempt-start", details: serialize(details) }]
    };
    addAttempt(attemptId, recordValue);
    recordFlow(recordValue, "attempt-start", details);
    return attemptId;
  }

  async function recordDebugEvent(
    stage: string,
    details?: unknown,
    attemptId?: string
  ): Promise<void> {
    if (!attemptId) return;
    const current = attempts.get(attemptId);
    if (!current) return;
    const now = new Date().toISOString();
    current.updatedAt = now;
    // Keep last 80 events per attempt to prevent unbounded growth.
    current.events = [...current.events, { at: now, stage, details: serialize(details) }].slice(-80);
    attempts.set(attemptId, current);
    recordFlow(current, stage, details);
  }

  async function finishDebugAttempt(
    status: Exclude<SnaplogStatus, "running">,
    error?: unknown,
    attemptId?: string
  ): Promise<void> {
    if (!attemptId) return;
    const current = attempts.get(attemptId);
    if (!current) return;
    current.status = status;
    current.updatedAt = new Date().toISOString();
    if (error) current.error = errorToDebug(error);
    attempts.set(attemptId, current);
    recordFlow(current, status === "success" ? "attempt-complete" : "attempt-error", error);
  }

  async function getDebugAttempt(
    attemptId?: string
  ): Promise<SnaplogAttemptRecord | undefined> {
    if (!attemptId) return undefined;
    const current = attempts.get(attemptId);
    return current ? cloneAttempt(current) : undefined;
  }

  async function readLogs(): Promise<SnaplogEntry[]> {
    return (await transport?.read?.()) ?? [];
  }

  async function clearLogs(): Promise<void> {
    attempts.clear();
    batchQueue = [];
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    await transport?.clear?.();
  }

  async function queryLogs(query: SnaplogQuery): Promise<SnaplogEntry[]> {
    return queryEntries(await readLogs(), query);
  }

  /** Flush any pending batched entries immediately (useful before process exit). */
  async function flush(): Promise<void> {
    if (!flushTimer || !batchQueue.length || !transport) return;
    clearTimeout(flushTimer);
    flushTimer = undefined;
    const toFlush = batchQueue;
    batchQueue = [];
    if (transport.recordBatch) {
      await transport.recordBatch(toFlush);
    } else {
      for (const entry of toFlush) {
        await transport.record(entry);
      }
    }
  }

  function recordFlow(
    attempt: SnaplogAttemptRecord,
    stage: string,
    details?: unknown
  ): void {
    record({
      event: "flow",
      flowId: attempt.attemptId,
      stage,
      status: attempt.status,
      value: serialize(details)
    });
  }

  return {
    injectLog,
    debugLog: (...args: unknown[]) => writeDebug("log", args),
    debugWarn: (...args: unknown[]) => writeDebug("warn", args),
    debugError: (...args: unknown[]) => writeDebug("error", args),
    beginDebugAttempt,
    recordDebugEvent,
    finishDebugAttempt,
    getDebugAttempt,
    readLogs,
    clearLogs,
    queryLogs,
    flush
  };
}

export type SnaplogClient = ReturnType<typeof createSnaplogClient>;

function createId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function cloneAttempt(attempt: SnaplogAttemptRecord): SnaplogAttemptRecord {
  return JSON.parse(JSON.stringify(attempt)) as SnaplogAttemptRecord;
}
