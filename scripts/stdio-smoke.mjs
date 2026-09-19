// Speaks raw JSON-RPC to the stdio server: proves stdout carries protocol frames only.
import { spawn } from "node:child_process";
const child = spawn("npx", ["tsx", "cli/main.ts", "serve"], { stdio: ["pipe", "pipe", "pipe"] });
let out = "";
child.stdout.on("data", (d) => (out += d));
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } });
setTimeout(() => { send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "copilot_get_symbol", arguments: { repo: "hono", name: "SmartRouter", limit: 1 } } }); }, 1500);
setTimeout(() => {
  child.kill();
  const frames = out.trim().split("\n").map((l) => JSON.parse(l)); // throws if anything non-JSON reached stdout
  console.log("frames:", frames.length, "| server:", frames[0].result.serverInfo.name);
  console.log(frames[1].result.content[0].text.split("\n").slice(0, 3).join("\n"));
}, 6000);
