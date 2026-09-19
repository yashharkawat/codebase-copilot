#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { indexRepo } from "../src/core/indexer";
import { search } from "../src/core/retriever";
import { indexRoot, loadIndex, REPO_ID } from "../src/core/store";

const HELP = `codebase-copilot — index a repo and serve it to MCP hosts

  codebase-copilot index <path> [--id <id>] [--include src,lib] [--include-tests] [--out <dir>]
  codebase-copilot search <id> "<query>" [--mode hybrid|dense|bm25] [--no-rerank] [-k 8]
  codebase-copilot serve            Start the MCP server on stdio

Index location: $COPILOT_INDEX_DIR or ./index`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      id: { type: "string" },
      name: { type: "string" },
      source: { type: "string" },
      include: { type: "string" },
      "include-tests": { type: "boolean", default: false },
      chunker: { type: "string", default: "ast" },
      out: { type: "string" },
      mode: { type: "string", default: "hybrid" },
      "no-rerank": { type: "boolean", default: false },
      k: { type: "string", short: "k", default: "8" },
    },
  });

  if (command === "index") {
    const repoPath = path.resolve(positionals[0] ?? ".");
    const id = (values.id ?? path.basename(repoPath)).toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    if (!REPO_ID.test(id)) throw new Error(`Invalid --id "${id}"`);
    if (values.chunker !== "ast" && values.chunker !== "naive") throw new Error("--chunker must be ast or naive");
    const started = Date.now();
    const result = await indexRepo(repoPath, {
      id,
      name: values.name,
      source: values.source,
      chunker: values.chunker,
      include: values.include?.split(",").map((s) => s.trim()).filter(Boolean),
      includeTests: values["include-tests"],
      outDir: path.resolve(values.out ?? indexRoot()),
      onProgress: (done, total) => process.stderr.write(`\rembedding ${done}/${total}`),
    });
    process.stderr.write("\n");
    console.error(`Indexed ${result.fileCount} files → ${result.chunkCount} chunks in ${((Date.now() - started) / 1000).toFixed(1)}s (id: ${result.id})`);
    if (result.skippedSecrets.length) console.error(`Skipped ${result.skippedSecrets.length} file(s) that look like they contain credentials:\n  ${result.skippedSecrets.join("\n  ")}`);
    return;
  }

  if (command === "search") {
    const [id, query] = positionals;
    const index = id && (await loadIndex(id));
    if (!index || !query) throw new Error(`Usage: codebase-copilot search <id> "<query>"`);
    const mode = values.mode === "dense" || values.mode === "bm25" ? values.mode : "hybrid";
    const hits = await search(index, query, { mode, rerank: !values["no-rerank"], k: Math.min(20, Math.max(1, Number(values.k) || 8)) });
    for (const [i, h] of hits.entries()) console.log(`${i + 1}. ${h.chunk.file}:${h.chunk.startLine}-${h.chunk.endLine}  ${h.chunk.symbol ?? h.chunk.kind}  (${h.score.toFixed(3)})`);
    return;
  }

  if (command === "serve") {
    const { McpServer } = await import("@modelcontextprotocol/server");
    const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
    const { registerCopilotTools, SERVER_INFO } = await import("../src/mcp/tools");
    const server = new McpServer(SERVER_INFO);
    registerCopilotTools(server);
    await server.connect(new StdioServerTransport());
    console.error("codebase-copilot MCP server running on stdio"); // stderr: stdout is the protocol channel
    return;
  }

  console.log(HELP);
  if (command && command !== "help" && command !== "--help") process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
