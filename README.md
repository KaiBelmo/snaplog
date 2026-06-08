# Snaplog Skill

Snaplog Skill helps AI coding agents debug runtime state in TypeScript apps with small, temporary snapshots.

Use it when a value disappears, a branch behaves incorrectly, a request or message payload mutates unexpectedly, or normal logs do not show where state goes wrong.

## What The Skill Does

The skill tells the agent to:

1. Restate the bug as a state-flow problem.
2. Find the smallest useful instrumentation point.
3. Snapshot high-signal variables only.
4. Reproduce the issue with the narrowest flow.
5. Read local logs.
6. Explain the root cause and smallest fix.
7. Remove temporary instrumentation.

## How To Use It

Ask the agent to use the skill directly:

```text
Use the snaplog skill to debug why this value becomes undefined after form submission.
```

The instructions live in `SKILL.md`. The supporting package used by the skill is `@kaibelmo/snaplog`.

## Runtime Notes

- Node logs are written to `.debug/debug.log`.
- Browser and extension flows should use the extension transport.
- `scripts/start-server.ts` is only for running a standalone collector when needed.

## Development

```bash
npm test
npm run typecheck
npm run build
```
