# Snaplog Skill

**AI-assisted runtime snapshot debugging for TypeScript projects.**

Snaplog Skill helps AI coding agents debug runtime state in Node.js apps, browser bundles, and browser extensions. It gives the agent a repeatable workflow for deciding what to inspect, where to instrument, how to capture logs locally, and how to interpret the results.

The bundled `snaplog` library is only the tool used by the skill. The main purpose of this repository is the **skill**: a structured debugging process that lets an AI agent add temporary, safe, local instrumentation and use the captured state to find bugs.

---

## What This Skill Does

Use this skill when you want an AI agent to debug problems such as:

- A value exists earlier in the flow but disappears later.
- A branch condition behaves differently than expected.
- A browser extension message, tab event, or storage update is malformed.
- A Node.js request, job, or service pipeline mutates state incorrectly.
- A multi-step operation fails but normal logs do not show where.
- You need temporary runtime snapshots without setting up a cloud logging tool.

The skill guides the agent to:

1. Understand the bug as a state-flow problem.
2. Find the smallest useful instrumentation boundary.
3. Snapshot only high-signal variables.
4. Redact sensitive values automatically.
5. Capture logs locally.
6. Analyze the snapshots.
7. Suggest a fix.
8. Remove the temporary instrumentation.

---

## Repository Structure

```text
.
├── SKILL.md
├── assets/
│   ├── snaplog-package/
│   └── snippets/
└── README.md
```

### `SKILL.md`

The main instruction file for AI coding agents. It explains when and how to use Snaplog Skill, how to choose variables, where to inject snapshots, and how to interpret results.

### `assets/snaplog-package`

A portable TypeScript package used by the skill to record local runtime snapshots. This is the instrumentation tool, not the main purpose of the repo.

### `assets/snippets`

Optional helper snippets, such as a standalone local collector server script.

---

## How To Use The Skill

Ask your AI coding agent to use this repository as a skill, for example:

```text
Use the snaplog skill to debug why this value becomes undefined after form submission.
```

Or:

```text
Use Snaplog Skill to inspect the extension message flow and find where the payload changes.
```

The agent should read `SKILL.md`, inspect your project, add minimal temporary instrumentation, run the reproduction flow, inspect the generated logs, explain the root cause, and clean up the debug code.

---

## Recommended Debug Workflow

The skill follows this workflow:

1. **Restate the bug**

   Define the actor, trigger, expected state, observed state, and suspected boundary.

2. **Find the code path**

   Search for the smallest part of the code where the value enters, changes, or leaves the system.

3. **Choose variables to snapshot**

   Prefer boundary inputs, branch decisions, state transitions, persistence edges, and error summaries.

4. **Inject temporary snapshots**

   Add `snaplog.injectLog()` only at the most useful locations.

5. **Reproduce the issue**

   Run the smallest command, test, or manual flow that triggers the bug.

6. **Read the logs**

   Inspect `.debug/debug.log` in Node.js or extension storage in browser extension contexts.

7. **Interpret and fix**

   Use the snapshots to locate the root cause and propose the smallest safe fix.

8. **Clean up**

   Remove temporary instrumentation unless the user explicitly asks to keep diagnostics.

---

## Choosing What To Snapshot

The skill should snapshot values that explain state movement, not entire objects.

Rank variables by signal value:

1. **Boundary inputs**
   - Request payloads
   - Message payloads
   - Route params
   - Store selectors
   - Function inputs

2. **Branch decisions**
   - Booleans
   - Status enums
   - Feature flags
   - Permission checks
   - Validation results

3. **State transitions**
   - Previous value
   - Next value
   - Selected ID
   - Count
   - Source label

4. **Persistence edges**
   - Value before write
   - Write result
   - Value after read
   - Storage key

5. **Error summaries**
   - Error name
   - Message
   - Status code
   - Provider/source

Avoid snapshotting:

- Raw secrets
- Tokens
- Passwords
- Authorization headers
- Full profile objects
- Full DOM nodes
- Huge arrays
- Unbounded nested objects

Prefer:

- IDs
- Counts
- Keys
- Booleans
- Status strings
- Hashes
- Redacted previews

---

## Installing The Bundled Package

The skill uses the bundled `snaplog` package from `assets/snaplog-package`.

If the target project already has `snaplog`, use the existing package. Otherwise, copy the bundled package into the project.

### Copy into a workspace project

```bash
cp -R assets/snaplog-package <project>/packages/snaplog
```

Then add it as a dependency:

```json
{
  "dependencies": {
    "snaplog": "workspace:*"
  }
}
```

### Copy into a non-workspace project

```bash
cp -R assets/snaplog-package <project>/packages/snaplog
```

Then use a local dependency:

```json
{
  "dependencies": {
    "snaplog": "file:./packages/snaplog"
  }
}
```

### Optional TypeScript paths

Only add path aliases if the project resolves local source packages directly:

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

---

## Node.js Runtime Snapshots

For Node.js apps, use the Node transport. It writes local NDJSON logs to `.debug/debug.log`.

```ts
import { createSnaplogClient } from "snaplog";
import { createNodeSnaplogTransport } from "snaplog/node";

const snaplog = createSnaplogClient({
  runtime: "node",
  source: "checkout/applyDiscount",
  transport: createNodeSnaplogTransport()
});

snaplog.injectLog(
  {
    userTier: user.tier,
    cartTotal: cart.total,
    discount
  },
  { tags: ["checkout"] }
);

await snaplog.flush();
```

The Node transport starts a local collector automatically and writes to `.debug/debug.log`.

---

## Browser Extension Snapshots

For browser extensions, use the extension transport. Do not import `snaplog/node` into browser bundles.

```ts
import { createSnaplogClient } from "snaplog";
import { createExtensionSnaplogTransport } from "snaplog/extension";

const snaplog = createSnaplogClient({
  runtime: "extension-background",
  source: "background/messageHandler",
  transport: createExtensionSnaplogTransport({
    storage: chrome.storage.local,
    maxEntries: 300,
    warnOnQuota: true,
    quotaWarnRatio: 0.75
  })
});

snaplog.injectLog(
  {
    tabId,
    messageType,
    hasPayload: Boolean(payload)
  },
  { tags: ["message-flow"] }
);
```

Read extension logs from another extension context:

```ts
import { readExtensionSnaplogEntries } from "snaplog/extension";

const entries = await readExtensionSnaplogEntries(chrome.storage.local);
console.log(entries);
```

---

## Local Collector Server

For most Node.js usage, `createNodeSnaplogTransport()` is enough.

If you want a separate persistent collector process, copy the snippet from `assets/snippets/start-snaplog-server.ts` into the target project and run it with the project’s TypeScript runner:

```bash
tsx scripts/start-snaplog-server.ts
```

The default collector listens on:

```text
http://127.0.0.1:7777/log
```

The Node transport tries consecutive ports if `7777` is already in use. You can override the port:

```ts
createNodeSnaplogTransport({ port: 9000 });
```

---

## Querying Logs

Read all logs:

```ts
const entries = await snaplog.readLogs();
```

Filter by variable:

```ts
const logs = await snaplog.queryLogs({ variable: "discount" });
```

Filter by source, event, tags, or timestamp:

```ts
const checkoutLogs = await snaplog.queryLogs({
  source: "checkout",
  event: "snapshot",
  tags: ["checkout"],
  after: Date.now() - 60_000
});
```

Clear logs:

```ts
await snaplog.clearLogs();
```

For Node.js log files, query directly:

```ts
import { queryNodeSnaplogEntries } from "snaplog/node";

const entries = queryNodeSnaplogEntries(
  { variable: "cartTotal", tags: ["checkout"] },
  ".debug/debug.log"
);
```

---

## Flow Tracking

Use flow tracking when a bug spans multiple steps.

```ts
const attemptId = await snaplog.beginDebugAttempt({ orderId: order.id });

try {
  await validateInventory(order);
  await snaplog.recordDebugEvent("inventory-ok", { reserved: true }, attemptId);

  await chargePayment(order);
  await snaplog.recordDebugEvent("payment-ok", { charged: true }, attemptId);

  await snaplog.finishDebugAttempt("success", undefined, attemptId);
} catch (error) {
  await snaplog.finishDebugAttempt("error", error, attemptId);
}

const flowLogs = await snaplog.queryLogs({
  event: "flow",
  flowId: attemptId
});
```

---

## Serialization And Redaction

The bundled package safely serializes values before writing logs.

It handles:

- Circular references
- Functions
- Deep objects
- Large arrays
- Long strings
- Sensitive keys
- Bearer tokens in strings

Built-in redacted keys include:

```text
token, authorization, passphrase, password, secret, ciphertext, iv, salt,
encryptedData, apikey, api_key, privatekey, private_key
```

Add project-specific redaction keys:

```ts
const snaplog = createSnaplogClient({
  serialize: {
    redactKeys: ["creditCard", "ssn", "refreshToken"]
  }
});
```

---

## Skill Prompt Template

Use this internal pattern when asking an AI agent to apply the skill:

```text
Role: Senior fullstack debugger.
Task: Diagnose [state problem] using Snaplog runtime snapshots.
Context: [runtime, trigger, expected state, observed state, suspected files].
Steps:
1. Find the state boundary most likely to lose or mutate the value.
2. Select the minimum variables to snapshot.
3. Add sanitized, non-blocking instrumentation.
4. Reproduce and inspect local Snaplog entries.
5. Explain the root cause and smallest fix.
Output:
- Variable list
- Insertion points
- Reproduction command
- Log interpretation
- Root cause
- Fix
- Cleanup notes
```

---

## Quality Bar

A correct Snaplog Skill run should satisfy these rules:

- Debug logging must not change product behavior.
- Instrumentation should be temporary by default.
- Logging failures should never break the app.
- Node-only imports must stay out of browser bundles.
- Sensitive values must be redacted.
- Snapshots should be minimal and high signal.
- The agent should explain why each snapshot was chosen.
- The agent should remove instrumentation after the bug is fixed unless asked otherwise.

---

## When Not To Use This Skill

Do not use Snaplog Skill when:

- Static code inspection is enough.
- A normal unit test clearly exposes the bug.
- The target environment cannot safely run instrumented code.
- The user needs permanent observability or production APM.
- The required data is highly sensitive and cannot be safely summarized or redacted.

---

## Contributing

When improving the skill:

```bash
npm install
npm test
npm run typecheck
npm run build
```

Add or update tests for behavior changes in the bundled package.

When editing `SKILL.md`, keep instructions focused on agent behavior:

- When to use the skill
- How to select instrumentation points
- What variables to snapshot
- How to avoid unsafe logging
- How to interpret logs
- How to clean up afterward

---

## License

[MIT](./LICENSE) © Kai Belmo
