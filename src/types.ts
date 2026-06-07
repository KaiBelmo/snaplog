export type SnaplogRuntime =
  | "node"
  | "extension-background"
  | "extension-content"
  | "extension-popup"
  | "extension-options"
  | "browser"
  | "unknown";

export type SnaplogEventType = "snapshot" | "debug" | "flow";

export type SnaplogLevel = "log" | "warn" | "error";

export type SnaplogStatus = "running" | "success" | "error";

export type SnaplogEntry = {
  sessionId: string;
  timestamp: number;
  runtime: SnaplogRuntime;
  source: string;
  event: SnaplogEventType;
  variable?: string;
  value?: unknown;
  level?: SnaplogLevel;
  message?: string;
  args?: unknown[];
  flowId?: string;
  stage?: string;
  status?: SnaplogStatus;
  tags?: string[];
  tabId?: number;
  urlHash?: string;
};

export type SnaplogAttemptEvent = {
  at: string;
  stage: string;
  details?: unknown;
};

export type SnaplogAttemptRecord = {
  attemptId: string;
  startedAt: string;
  updatedAt: string;
  status: SnaplogStatus;
  events: SnaplogAttemptEvent[];
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
};

export type SnaplogTransport = {
  record(entry: SnaplogEntry): void | Promise<void>;
  recordBatch?(entries: SnaplogEntry[]): void | Promise<void>;
  read?(): SnaplogEntry[] | Promise<SnaplogEntry[]>;
  clear?(): void | Promise<void>;
};

export type SnaplogQuery = {
  variable?: string;
  source?: string;
  after?: number;
  tags?: string[];
  event?: SnaplogEventType;
  flowId?: string;
};

/** Options for controlling how values are serialized before logging. */
export type SnaplogSerializeOptions = {
  /**
   * Maximum depth to recurse into nested objects.
   * @default 4
   */
  maxDepth?: number;
  /**
   * Maximum number of array items to serialize.
   * @default 20
   */
  maxArrayItems?: number;
  /**
   * Maximum length of serialized strings before truncation.
   * @default 500
   */
  maxStringLength?: number;
  /**
   * Additional key names (case-insensitive) to redact.
   * Merged with the built-in list: token, authorization, passphrase, password, secret, ciphertext, iv, salt, encryptedData.
   */
  redactKeys?: string[];
};

export type SnaplogClientOptions = {
  runtime?: SnaplogRuntime;
  source?: string;
  sessionId?: string;
  debugEnabled?: () => boolean;
  transport?: SnaplogTransport;
  console?: Pick<Console, "log" | "warn" | "error">;
  /** Controls serialization depth, size limits, and custom key redaction. */
  serialize?: SnaplogSerializeOptions;
  /**
   * Max number of in-memory attempt records before oldest are evicted.
   * @default 200
   */
  maxAttempts?: number;
  /**
   * Batch flush interval in milliseconds. When set, rapid injectLog calls
   * are queued and flushed together in one transport write.
   * @default 0 (disabled — flush immediately)
   */
  batchIntervalMs?: number;
};

export type InjectLogOptions = {
  source?: string;
  runtime?: SnaplogRuntime;
  tags?: string[];
  flowId?: string;
  tabId?: number;
  urlHash?: string;
};
