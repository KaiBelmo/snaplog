import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clearNodeSnaplogEntries, queryNodeSnaplogEntries, readNodeSnaplogEntries } from "./node.js";
import type { SnaplogEntry } from "./types.js";

describe("node snaplog helpers", () => {
  it("reads, queries, and clears NDJSON logs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snaplog-"));
    const logPath = path.join(dir, "debug.log");
    const entry: SnaplogEntry = {
      sessionId: "sess",
      timestamp: 10,
      runtime: "node",
      source: "checkout.ts:4",
      event: "snapshot",
      variable: "discount",
      value: 0,
      tags: ["checkout"]
    };
    fs.writeFileSync(logPath, `${JSON.stringify(entry)}\nnot-json\n`);

    expect(readNodeSnaplogEntries(logPath)).toEqual([entry]);
    expect(queryNodeSnaplogEntries({ variable: "discount", tags: ["checkout"] }, logPath)).toEqual([entry]);
    clearNodeSnaplogEntries(logPath);
    expect(readNodeSnaplogEntries(logPath)).toEqual([]);
  });
});
