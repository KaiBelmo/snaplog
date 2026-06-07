# snaplog

**Portable TypeScript runtime snapshot debugger.**

Inject sanitized, structured snapshots into any Node.js app, browser bundle, or browser extension — without changing product behavior, without a cloud account, and without a database. Logs land in a local NDJSON file or browser storage and can be read, queried, and cleared programmatically.

[![npm version](https://img.shields.io/npm/v/snaplog)](https://www.npmjs.com/package/snaplog)
[![license](https://img.shields.io/npm/l/snaplog)](./LICENSE)

---

## Table of Contents

- [Why snaplog](#why-snaplog)
- [Install](#install)
- [Quick Start — Node.js](#quick-start--nodejs)
- [Browser Extension](#browser-extension)
- [Standalone Collector Server](#standalone-collector-server)
- [Configuration Reference](#configuration-reference)
- [Serialization & Redaction](#serialization--redaction)
- [Batching](#batching)
- [Flow Tracking](#flow-tracking)
- [Querying Logs](#querying-logs)
- [Debug Workflow](#debug-workflow)
- [Variable Selection Guide](#variable-selection-guide)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Why snaplog

Most debugging tools are either too heavy (full APM platforms with cloud accounts and agents) or too basic (scattered `console.log` calls that you forget to remove). snaplog sits in the middle:

- **Zero external dependencies** — pure Node.js built-ins and browser APIs
- **Runs entirely locally** — no data leaves your machine
- **Safe by design** — sensitive keys and bearer tokens are redacted automatically
- **Structured** — every snapshot is a typed `SnaplogEntry` you can query and filter
- **Temporary-first** — designed for debugging sessions, not permanent instrumentation

---

## Install

```bash
npm install snaplog
# or
pnpm add snaplog
# or
yarn add snaplog
```

---

## Quick Start — Node.js

```ts
import { createSnaplogClient } from "snaplog";
import { createNodeSnaplogTransport } from "snaplog/node";

const snaplog = createSnaplogClient({
  runtime: "node",
  source: "checkout/applyDiscount",   // labels every entry from this client
  transport: createNodeSnaplogTransport()
  // → auto-starts an HTTP collector on port 7777
  // → writes NDJSON to .debug/debug.log
});

// Snapshot any variables at a state boundary
snaplog.injectLog({
  userTier: user.tier,
  cartTotal: cart.total,
  discount
}, { tags: ["checkout"] });

// Before process exit, flush any buffered entries
await snaplog.flush();
```

Open `.debug/debug.log` to read the raw NDJSON, or query programmatically:

```ts
const entries = await snaplog.queryLogs({ tags: ["checkout"] });
console.log(entries);
```

**Remove instrumentation** once the bug is fixed. snaplog is designed to be temporary.

---

## Browser Extension

Use `snaplog/extension` in background scripts, content scripts, popups, or options pages. Do **not** import `snaplog/node` into browser bundles.

```ts
import { createSnaplogClient } from "snaplog";
import { createExtensionSnaplogTransport } from "snaplog/extension";

const snaplog = createSnaplogClient({
  runtime: "extension-background",
  source: "background/messageHandler",
  transport: createExtensionSnaplogTransport({
    storage: chrome.storage.local,
    maxEntries: 300,        // rotate: oldest entries evicted when cap is reached
    warnOnQuota: true,      // console.warn at 80 % of maxEntries
    quotaWarnRatio: 0.75    // tune the warning threshold
  })
});

snaplog.injectLog({ tabId, messageType, payload }, { tags: ["message"] });
```

Read logs from any extension context:

```ts
import { readExtensionSnaplogEntries } from "snaplog/extension";

const entries = await readExtensionSnaplogEntries(chrome.storage.local);
```

---

## Standalone Collector Server

If you want a persistent collector running separately from your app, use the bundled script:

```bash
# Requires tsx (or ts-node)
npx tsx scripts/start-server.ts
```

The server listens on `http://127.0.0.1:7777/log` and writes to `.debug/debug.log`. Your app's `createNodeSnaplogTransport()` will automatically POST to it.

> **Port conflicts**: The Node transport tries up to 10 consecutive ports starting from `7777` if the default is in use. Override with the `port` option:
>
> ```ts
> createNodeSnaplogTransport({ port: 9000 })
> ```

---

## Configuration Reference

All options passed to `createSnaplogClient()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `runtime` | `SnaplogRuntime` | `"unknown"` | Labels every entry: `"node"`, `"browser"`, `"extension-background"`, etc. |
| `source` | `string` | `"unknown"` | File or function label for every entry, e.g. `"checkout/applyDiscount"` |
| `sessionId` | `string` | `"sess_<timestamp>"` | Groups entries from the same process/tab run |
| `transport` | `SnaplogTransport` | `undefined` | Where entries are written. Use `createNodeSnaplogTransport()` or `createExtensionSnaplogTransport()` |
| `debugEnabled` | `() => boolean` | `() => true` | Gates `debugLog/Warn/Error` calls. Wire to a feature flag to disable in production |
| `console` | `Console` subset | `globalThis.console` | Inject a custom logger (useful in tests) |
| `maxAttempts` | `number` | `200` | Max in-memory `SnaplogAttemptRecord` entries before oldest are evicted |
| `batchIntervalMs` | `number` | `0` (off) | Coalesce rapid `injectLog` calls and flush in a single write every N ms |
| `serialize` | `SnaplogSerializeOptions` | see below | Controls serialization depth, limits, and extra redact keys |

### `SnaplogSerializeOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `maxDepth` | `number` | `4` | Max recursion depth into nested objects |
| `maxArrayItems` | `number` | `20` | Max array items serialized |
| `maxStringLength` | `number` | `500` | Strings longer than this are truncated with `...` |
| `redactKeys` | `string[]` | `[]` | Additional key names to redact (merged with built-in list) |

**Built-in redacted keys** (case-insensitive): `token`, `authorization`, `passphrase`, `password`, `secret`, `ciphertext`, `iv`, `salt`, `encryptedData`, `apikey`, `api_key`, `privatekey`, `private_key`.

---

## Serialization & Redaction

snaplog serializes every value before writing it, so you never accidentally log:
- Circular references → `"[Circular]"`
- Functions → `"[Function]"`
- Values too deep → `"[max-depth]"`
- Sensitive keys → `"[redacted]"`
- Bearer tokens in strings → `"[redacted]"`

Customize the serializer:

```ts
import { buildSerializer } from "snaplog";

const { serialize } = buildSerializer({
  maxDepth: 6,
  maxArrayItems: 50,
  maxStringLength: 1000,
  redactKeys: ["creditCard", "ssn", "dob"]
});

const safe = serialize(someDeepObject);
```

Or pass `serialize` options directly to the client:

```ts
const snaplog = createSnaplogClient({
  serialize: {
    redactKeys: ["apiSecret", "refreshToken"]
  }
});
```

---

## Batching

When your code calls `injectLog` in a tight loop, you can reduce I/O by enabling batching:

```ts
const snaplog = createSnaplogClient({
  transport: createNodeSnaplogTransport(),
  batchIntervalMs: 50  // flush every 50 ms
});

// These 1000 calls are coalesced into a single write
for (const item of largeList) {
  snaplog.injectLog({ itemId: item.id, status: item.status });
}

// Always call flush() before process exit when batchIntervalMs > 0
process.on("beforeExit", () => snaplog.flush());
await snaplog.flush();
```

If your transport implements `recordBatch(entries)`, the batch is delivered in one call. Otherwise individual `record()` calls are made for each entry.

---

## Flow Tracking

Track multi-step operations end-to-end:

```ts
const attemptId = await snaplog.beginDebugAttempt({ orderId: order.id });

try {
  await validateInventory(order);
  await snaplog.recordDebugEvent("inventory-ok", { reserved: true }, attemptId);

  await chargePayment(order);
  await snaplog.recordDebugEvent("payment-ok", { chargeId }, attemptId);

  await snaplog.finishDebugAttempt("success", undefined, attemptId);
} catch (err) {
  await snaplog.finishDebugAttempt("error", err, attemptId);
}

// Read all flow entries for this attempt
const flowLogs = await snaplog.queryLogs({ event: "flow", flowId: attemptId });
```

---

## Querying Logs

```ts
// All entries
const all = await snaplog.readLogs();

// Filter by variable name
const discountLogs = await snaplog.queryLogs({ variable: "discount" });

// Filter by source, event type, tags, or flowId
const checkoutErrors = await snaplog.queryLogs({
  source: "checkout",
  event: "snapshot",
  tags: ["checkout"]
});

// Entries after a timestamp
const recent = await snaplog.queryLogs({ after: Date.now() - 60_000 });

// Clear all
await snaplog.clearLogs();
```

For Node.js, you can also query the log file directly without a client:

```ts
import { queryNodeSnaplogEntries } from "snaplog/node";

const entries = queryNodeSnaplogEntries(
  { variable: "cartTotal", tags: ["checkout"] },
  ".debug/debug.log"
);
```

---

## Debug Workflow

1. **Restate the bug** as: actor, trigger, expected state, observed state, suspected code boundary
2. **Find the code path** with a search tool and identify the smallest instrumentation point
3. **Add 1–2 snapshots** that prove or disprove your hypothesis
4. **Reproduce** with the narrowest command or manual flow
5. **Read the logs** — `.debug/debug.log` or your configured storage
6. **Interpret** and either fix the bug or add the next minimal snapshot
7. **Remove** temporary instrumentation and rerun relevant tests/typecheck

---

## Variable Selection Guide

When choosing what to snapshot, rank by signal value:

1. **Boundary inputs** — request payloads, message data, route params, store selectors
2. **Branch decisions** — booleans, status enums, feature flags, permission checks
3. **State transitions** — previous value, next value, selected ID, count, source label
4. **Persistence edges** — value before write, write result, value after read
5. **Error summaries** — error name, message, status code, provider/source

**Avoid**: raw secrets, tokens, passphrases, auth headers, full profile objects, full DOM nodes, unbounded collections. Prefer counts, IDs, hashes, booleans, and redacted previews.

---

## API Reference

### `snaplog` (main entry point)

```ts
import {
  createSnaplogClient,       // factory for the debug client
  createMemorySnaplogStore,  // in-memory transport (useful in tests)
  buildSerializer,           // configurable safe serializer factory
  safeSerialize,             // default serializer (backward compat)
  errorToDebug,              // converts Error → plain object
  queryEntries               // filter a SnaplogEntry[] array
} from "snaplog";
```

### `snaplog/node`

```ts
import {
  createNodeSnaplogTransport,    // Node HTTP + file transport
  ensureServer,                  // starts the local HTTP collector
  stopServer,                    // shuts it down
  readNodeSnaplogEntries,        // reads NDJSON log file
  clearNodeSnaplogEntries,       // deletes the log file
  queryNodeSnaplogEntries,       // filters log file entries
  DEFAULT_SNAPLOG_PORT           // 7777
} from "snaplog/node";
```

### `snaplog/extension`

```ts
import {
  createExtensionSnaplogTransport,   // chrome.storage transport
  readExtensionSnaplogEntries,       // reads from storage
  clearExtensionSnaplogEntries,      // removes key from storage
  queryExtensionSnaplogEntries,      // filters storage entries
  DEFAULT_EXTENSION_SNAPLOG_KEY      // "snaplogDebug"
} from "snaplog/extension";
```

### `SnaplogClient` methods

| Method | Description |
|---|---|
| `injectLog(vars, opts?)` | Snapshot a record of key→value pairs |
| `debugLog(...args)` | Console.log + record a debug entry |
| `debugWarn(...args)` | Console.warn + record a debug entry |
| `debugError(...args)` | Console.error + record a debug entry |
| `beginDebugAttempt(details?)` | Start a tracked flow, returns `attemptId` |
| `recordDebugEvent(stage, details?, attemptId?)` | Append an event to a flow |
| `finishDebugAttempt(status, error?, attemptId?)` | Complete a flow |
| `getDebugAttempt(attemptId?)` | Read a flow record |
| `readLogs()` | Read all transport entries |
| `queryLogs(query)` | Filter entries by variable/source/tags/event/flowId/after |
| `clearLogs()` | Clear transport + in-memory attempts |
| `flush()` | Flush pending batched entries immediately |

---

## Contributing

```bash
# Install deps
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

All tests live in `src/*.test.ts` and run with [Vitest](https://vitest.dev). Please add or update tests for any behavior changes before opening a PR.

---

## License

[MIT](./LICENSE) © KaiBelmo
