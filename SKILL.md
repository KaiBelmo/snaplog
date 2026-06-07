---
name: snaplog
description: Portable TypeScript runtime snapshot debugging with a bundled snaplog package. Use when the user asks to use snaplog, run a local snapshot/debug collector, inject debug instrumentation, decide which variables to snapshot, debug Node/browser/extension state flow, save logs locally, or inspect runtime state without changing product behavior.
---

# Snaplog

Use this skill to debug TypeScript runtime state with the bundled `snaplog` package in `assets/snaplog-package`. The package provides `injectLog`, debug console wrappers, flow/attempt records, a Node local HTTP/file collector, and a browser/extension storage transport.

## First Decide

- If the project already has `snaplog`, use the existing package.
- If not, copy `assets/snaplog-package` into the target project, usually as `packages/snaplog`.
- If the target project uses scoped internal packages, rename the copied package in `package.json` and update imports consistently.
- Keep instrumentation temporary unless the user asks for durable diagnostics.

## Install In A TypeScript Project

1. Copy the bundled package:

```powershell
Copy-Item -Recurse C:\Users\Admin\.codex\skills\snaplog\assets\snaplog-package <project>\packages\snaplog
```

2. Add it to the workspace or app dependency:

```json
{
  "dependencies": {
    "snaplog": "workspace:*"
  }
}
```

For non-workspace projects, copy the package under a local folder and use a package-manager-supported local dependency such as `file:./packages/snaplog`.

3. Add TypeScript path aliases only if the project resolves source packages directly:

```json
{
  "compilerOptions": {
    "paths": {
      "snaplog": ["packages/snaplog/src/index.ts"],
      "snaplog/node": ["packages/snaplog/src/node.ts"],
      "snaplog/extension": ["packages/snaplog/src/extension.ts"]
    }
  }
}
```

4. Run the package checks when practical:

```bash
pnpm --filter snaplog test
pnpm --filter snaplog typecheck
```

Use equivalent `npm` or `yarn` commands if the project does not use pnpm.

## Run The Local Node Collector

For Node apps, `createNodeSnaplogTransport()` auto-starts a collector on first record and writes NDJSON to `.debug/debug.log`.

To run a standalone collector, copy `assets/snippets/start-snaplog-server.ts` into the target project, then run it with the project’s TypeScript runner, for example:

```bash
tsx scripts/start-snaplog-server.ts
```

If the project lacks `tsx`, either use its existing runner or compile the script with `tsc` and run Node on the emitted JavaScript.

## Inject Snapshots

Use snapshots at state boundaries, not everywhere:

```ts
import { createSnaplogClient } from "snaplog";
import { createNodeSnaplogTransport } from "snaplog/node";

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

For browser or extension contexts, use `createExtensionSnaplogTransport` only when a real storage adapter exists. Do not import `snaplog/node` into browser bundles.

```ts
import { createExtensionSnaplogTransport } from "snaplog/extension";

const transport = createExtensionSnaplogTransport({
  storage: chrome.storage.local,
  maxEntries: 300,      // rotate oldest entries when cap is reached
  warnOnQuota: true,    // warn at 80 % of maxEntries (configurable via quotaWarnRatio)
  quotaWarnRatio: 0.75  // warn earlier if needed
});
```

The Node transport automatically finds a free port if `7777` is in use (tries up to 10 consecutive ports). Override with `port` option if needed.

## Choose Variables To Debug

When the user asks “which variable should I debug?”, produce a ranked list:

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
