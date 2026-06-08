---
name: snaplog
description: Portable TypeScript runtime snapshot debugging with the published `@kaibelmo/snaplog` package. Use when the user asks to use snaplog, run a local snapshot/debug collector, inject debug instrumentation, decide which variables to snapshot, debug Node/browser/extension state flow, save logs locally, or inspect runtime state without changing product behavior.
---

# Snaplog

Use this skill to debug TypeScript runtime state with the published `@kaibelmo/snaplog` package. The package provides `injectLog`, debug console wrappers, flow/attempt records, a Node local HTTP/file collector, and a browser/extension storage transport.

## First Decide

- If the project already depends on `@kaibelmo/snaplog`, use the existing package.
- If not, install `@kaibelmo/snaplog` in the target project.
- Keep instrumentation temporary unless the user asks for durable diagnostics.

## Install In A TypeScript Project

1. Add the package:

```bash
npm install @kaibelmo/snaplog
```

Equivalent package manager commands are fine:

```bash
pnpm add @kaibelmo/snaplog
yarn add @kaibelmo/snaplog
```

2. Run the package checks when practical:

```bash
npm test
npm run typecheck
```

## Run The Local Node Collector

For Node apps, `createNodeSnaplogTransport()` auto-starts a collector on first record and writes NDJSON to `.debug/debug.log`.

Keep the instrumented Node process running while reproducing the issue. The npm package is intended to be used from application code; do not rely on repository-only scripts such as `scripts/start-server.ts` in installed packages.

## Inject Snapshots

Use snapshots at state boundaries, not everywhere:

```ts
import { createSnaplogClient } from "@kaibelmo/snaplog";
import { createNodeSnaplogTransport } from "@kaibelmo/snaplog/node";

const snaplog = createSnaplogClient({
  runtime: "node",
  source: "checkout/applyDiscount",
  transport: createNodeSnaplogTransport(),

  // Optional: cap in-memory attempt records (default 200).
  maxAttempts: 100,

  // Optional: coalesce rapid injectLog calls into a single write every 50 ms.
  batchIntervalMs: 50,

  // Optional: customize serialization limits and add extra redacted keys.
  serialize: {
    maxDepth: 5,
    maxArrayItems: 30,
    maxStringLength: 800,
    redactKeys: ["creditCard", "ssn"]
  }
});

snaplog.injectLog({
  userTier: user.tier,
  cartTotal: cart.total,
  discount
}, { tags: ["checkout"] });

// Before process exit, flush any buffered batch entries.
await snaplog.flush();
```

For browser or extension contexts, use `createExtensionSnaplogTransport` only when a real storage adapter exists. Do not import `@kaibelmo/snaplog/node` into browser bundles.

```ts
import { createExtensionSnaplogTransport } from "@kaibelmo/snaplog/extension";

const transport = createExtensionSnaplogTransport({
  storage: chrome.storage.local,
  maxEntries: 300,
  warnOnQuota: true,
  quotaWarnRatio: 0.75
});
```

The Node transport automatically finds a free port if `7777` is in use. Override with `port` if needed.

## Choose Variables To Debug

When the user asks "which variable should I debug?", produce a ranked list:

1. Boundary inputs: request payloads, message data, route params, store selectors.
2. Branch decisions: booleans, status enums, feature flags, permission checks.
3. State transitions: previous value, next value, selected ID, count, source label.
4. Persistence edges: value before write, write result, value after read.
5. Error summaries: error name, message, status code, provider/source.

Avoid raw secrets, tokens, passphrases, authorization headers, full profile values, full DOM nodes, and unbounded objects. Prefer counts, keys, IDs, hashes, booleans, and redacted previews.

## Debug Workflow

1. Restate the bug as actor, trigger, expected state, observed state, and suspected boundary.
2. Search the code path with `rg` and identify the smallest instrumentation point.
3. Add one or two snapshots that can prove or disprove the hypothesis.
4. Reproduce with the narrowest command or manual flow.
5. Read `.debug/debug.log` or the configured storage-backed logs.
6. Interpret the snapshots and either fix the bug or add the next minimal snapshot.
7. Remove temporary instrumentation and rerun relevant tests/typecheck.

## Prompt Shape

Use this internal prompt pattern for debugging tasks:

```text
Role: Senior fullstack debugger.
Task: Diagnose [state problem] using snaplog runtime snapshots.
Context: [runtime, trigger, expected state, observed state, suspected files].
Steps:
1. Find the state boundary most likely to lose or mutate the value.
2. Select the minimum variables to snapshot.
3. Add sanitized non-blocking instrumentation.
4. Reproduce and inspect local snaplog entries.
5. Explain the root cause and smallest fix.
Output: variable list, insertion points, reproduction command, log interpretation, cleanup notes.
```

## Quality Bar

- Never let debug logging change product behavior.
- Catch and ignore logging transport failures.
- Keep Node-only imports out of browser bundles.
- Redact sensitive keys and suspicious primitive strings.
- Serialize extension/browser storage writes to avoid dropped records.
- Add or adjust tests before changing reusable snaplog behavior.
