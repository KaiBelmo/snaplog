import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { queryEntries } from "./memory-store";
import type { SnaplogEntry, SnaplogQuery, SnaplogTransport } from "./types";

export const DEFAULT_SNAPLOG_PORT = 7777;
/** Maximum number of ports to try when the default is in use. */
const MAX_PORT_RETRIES = 10;

type NodeTransportOptions = {
  logPath?: string;
  port?: number;
  host?: string;
};

let server: Server | undefined;
let activeLogPath: string | undefined;
let writeStream: fs.WriteStream | undefined;
/** Batch of lines waiting to be flushed to the write stream. */
let pendingLines: string[] = [];
let flushScheduled = false;

// ---------------------------------------------------------------------------
// Public transport factory
// ---------------------------------------------------------------------------

export function createNodeSnaplogTransport(options: NodeTransportOptions = {}): SnaplogTransport {
  const logPath = options.logPath ?? path.join(process.cwd(), ".debug", "debug.log");
  const port = options.port ?? DEFAULT_SNAPLOG_PORT;
  const host = options.host ?? "127.0.0.1";

  return {
    record(entry: SnaplogEntry): void {
      ensureServer({ logPath, port, host });
      const line = `${JSON.stringify(entry)}\n`;
      const url = `http://${host}:${activePort ?? port}/log`;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: line
      }).catch(() => {
        // Fall back to direct async write if the HTTP server is not yet up.
        enqueueLine(logPath, line);
      });
    },

    /** Batch variant: sends all entries in a single POST body. */
    recordBatch(entries: SnaplogEntry[]): void {
      if (!entries.length) return;
      ensureServer({ logPath, port, host });
      const body = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      const url = `http://${activePort !== undefined ? `${host}:${activePort}` : `${host}:${port}`}/log`;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body
      }).catch(() => {
        enqueueLine(logPath, body);
      });
    },

    read(): SnaplogEntry[] {
      return readNodeSnaplogEntries(logPath);
    },

    clear(): void {
      clearNodeSnaplogEntries(logPath);
    }
  };
}

// ---------------------------------------------------------------------------
// HTTP server (with port fallback on EADDRINUSE)
// ---------------------------------------------------------------------------

let activePort: number | undefined;

export function ensureServer(options: Required<NodeTransportOptions>): void {
  if (server) return;
  activeLogPath = options.logPath;
  fs.mkdirSync(path.dirname(options.logPath), { recursive: true });

  tryListen(options.port, options.host, options.logPath, 0);
}

function tryListen(port: number, host: string, logPath: string, attempt: number): void {
  const candidate = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/log") {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const line = body.endsWith("\n") ? body : `${body}\n`;
      enqueueLine(logPath, line);
      res.writeHead(200);
      res.end("ok");
    });
  });

  candidate.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && attempt < MAX_PORT_RETRIES) {
      // Try the next port quietly.
      tryListen(port + 1, host, logPath, attempt + 1);
    } else {
      // Give up — fall back to direct file writes only.
      console.warn(
        `[snaplog] Could not bind to any port in range ${DEFAULT_SNAPLOG_PORT}–${port}. ` +
          "Logs will be written directly to disk."
      );
    }
  });

  candidate.listen(port, host, () => {
    server = candidate;
    activePort = port;
    // Drain any lines that arrived before the server was ready.
    drainPending(logPath);
  });
}

export function stopServer(): void {
  server?.close();
  server = undefined;
  activePort = undefined;
  writeStream?.end();
  writeStream = undefined;
}

// ---------------------------------------------------------------------------
// Async streaming write helpers
// ---------------------------------------------------------------------------

function getWriteStream(logPath: string): fs.WriteStream {
  if (writeStream && activeLogPath === logPath) return writeStream;
  // If the path changed (e.g. a second transport was created) close the old one.
  writeStream?.end();
  activeLogPath = logPath;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  writeStream = fs.createWriteStream(logPath, { flags: "a", encoding: "utf8" });
  writeStream.on("error", () => {
    // Silently ignore stream errors so logging never throws.
    writeStream = undefined;
  });
  return writeStream;
}

/**
 * Queue a line for async writing and schedule a microtask flush.
 * Multiple calls within the same tick are coalesced into one stream write.
 */
function enqueueLine(logPath: string, line: string): void {
  pendingLines.push(line);
  if (flushScheduled) return;
  flushScheduled = true;
  // queueMicrotask runs before the next I/O event — batch everything from this tick.
  queueMicrotask(() => {
    flushScheduled = false;
    const batch = pendingLines.join("");
    pendingLines = [];
    try {
      getWriteStream(logPath).write(batch);
    } catch {
      // If the stream is broken fall back to a synchronous append as last resort.
      try {
        fs.appendFileSync(logPath, batch);
      } catch {
        // Nothing more we can do — swallow silently.
      }
    }
  });
}

function drainPending(logPath: string): void {
  if (!pendingLines.length) return;
  const batch = pendingLines.join("");
  pendingLines = [];
  getWriteStream(logPath).write(batch);
}

// ---------------------------------------------------------------------------
// Public read/query/clear helpers
// ---------------------------------------------------------------------------

export function readNodeSnaplogEntries(
  logPath = path.join(process.cwd(), ".debug", "debug.log")
): SnaplogEntry[] {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as SnaplogEntry];
      } catch {
        return [];
      }
    });
}

export function clearNodeSnaplogEntries(
  logPath = path.join(process.cwd(), ".debug", "debug.log")
): void {
  writeStream?.end();
  writeStream = undefined;
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
}

export function queryNodeSnaplogEntries(
  query: SnaplogQuery,
  logPath = path.join(process.cwd(), ".debug", "debug.log")
): SnaplogEntry[] {
  return queryEntries(readNodeSnaplogEntries(logPath), query);
}
