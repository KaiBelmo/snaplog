import { createSnaplogClient } from "../src/index.js";
import { createNodeSnaplogTransport } from "../src/node.js";

const client = createSnaplogClient({
  runtime: "node",
  source: "snaplog-server",
  transport: createNodeSnaplogTransport()
});

client.injectLog({ serverStarted: true }, { tags: ["snaplog"] });

console.log("snaplog collector is listening on http://127.0.0.1:7777/log");
console.log("Logs are written to .debug/debug.log");
console.log("Press Ctrl+C to stop.");
setInterval(() => undefined, 60_000);
