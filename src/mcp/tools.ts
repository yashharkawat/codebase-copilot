import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { findSymbols, findUsages, search } from "../core/retriever";
import { listManifests, loadIndex, REPO_ID, type LoadedIndex } from "../core/store";
import type { Chunk } from "../core/types";

export const SERVER_INFO = { name: "codebase-copilot-mcp-server", version: "1.0.0" } as const;

/** Off by default: on code, the general-domain cross-encoder LOWERED recall@5 from 88% to 80% (eval/RESULTS.md). */
export const DEFAULT_RERANK = process.env.COPILOT_RERANK === "on";

const PREVIEW_LINES = 40;
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const repoField = z.string().regex(REPO_ID, "lowercase repo id, e.g. \"hono\"").describe("Repository id from copilot_list_repos");
const formatField = z.enum(["markdown", "json"]).default("markdown").describe("markdown for reading, json for programmatic use");

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

const fail = (text: string): ToolResult => ({ isError: true, content: [{ type: "text", text }] });

async function withIndex(repo: string, fn: (index: LoadedIndex) => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  try {
    const index = await loadIndex(repo);
    if (!index) {
      const known = (await listManifests()).map((m) => m.id);
      return fail(`Unknown repo "${repo}". Available: ${known.join(", ") || "(none indexed — run \`codebase-copilot index <path>\`)"}. Call copilot_list_repos to see details.`);
    }
    return await fn(index);
  } catch (err) {
    console.error("[copilot] tool failure:", err); // stderr only: stdout belongs to the stdio transport
    return fail("Internal error while reading the index. Retry; if it persists, re-run `codebase-copilot index`.");
  }
}

const cite = (c: Chunk) => `${c.file}:${c.startLine}-${c.endLine}`;
const label = (c: Chunk) => (c.symbol ? `${c.parent ? c.parent + "." : ""}${c.symbol} (${c.kind})` : c.kind);

function codeBlock(c: Chunk, maxLines = PREVIEW_LINES): string {
  const lines = c.text.split("\n");
  const shown = lines.slice(0, maxLines).join("\n");
  const more = lines.length > maxLines ? `\n… ${lines.length - maxLines} more lines — call copilot_read_chunk with chunk_id "${c.id}"` : "";
  return "```" + c.language + "\n" + shown + "\n```" + more;
}

const chunkDto = (c: Chunk) => ({ chunk_id: c.id, file: c.file, start_line: c.startLine, end_line: c.endLine, symbol: c.symbol, parent: c.parent, kind: c.kind, language: c.language, text: c.text });

export function registerCopilotTools(server: McpServer): void {
  server.registerTool(
    "copilot_list_repos",
    {
      title: "List indexed repositories",
      description: "List the repositories that have been indexed and can be searched. Call this first to get a valid `repo` id for the other copilot_* tools.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async (): Promise<ToolResult> => {
      const repos = (await listManifests()).map((m) => ({ id: m.id, name: m.name, source: m.source, commit: m.commit, files: m.fileCount, chunks: m.chunkCount, languages: m.languages }));
      const text = repos.length
        ? repos.map((r) => `- **${r.id}** — ${r.name} (${r.files} files, ${r.chunks} chunks${r.commit ? `, commit ${r.commit.slice(0, 7)}` : ""})`).join("\n")
        : "No repositories indexed yet. Run `codebase-copilot index <path>`.";
      return { content: [{ type: "text", text }], structuredContent: { repos } };
    },
  );

  server.registerTool(
    "copilot_search_code",
    {
      title: "Search code by meaning or keyword",
      description:
        "Find the code that implements or relates to a natural-language question or keyword (e.g. \"where are cookies signed?\", \"trie router insert\"). " +
        "Hybrid retrieval: dense embeddings + BM25 over identifiers, fused with reciprocal-rank fusion, optionally cross-encoder reranked. " +
        "Returns symbol-level chunks with `file:start-end` citations. Use copilot_get_symbol instead when you already know the exact symbol name, and copilot_find_usages to see where an identifier is referenced.",
      inputSchema: {
        repo: repoField,
        query: z.string().trim().min(2).max(500).describe("Natural-language question or keywords"),
        mode: z.enum(["hybrid", "dense", "bm25"]).default("hybrid").describe("hybrid is best for most queries; bm25 for exact identifiers"),
        rerank: z.boolean().default(DEFAULT_RERANK).describe("Cross-encoder rerank of the top 30 candidates (slower, more precise)"),
        limit: z.number().int().min(1).max(20).default(8),
        path_prefix: z.string().max(200).optional().describe("Only search files under this path, e.g. \"src/router\""),
        response_format: formatField,
      },
      annotations: READ_ONLY,
    },
    async ({ repo, query, mode, rerank, limit, path_prefix, response_format }) =>
      withIndex(repo, async (index) => {
        const hits = await search(index, query, { mode, rerank, k: limit, pathPrefix: path_prefix });
        if (hits.length === 0) return { content: [{ type: "text", text: `No results for "${query}"${path_prefix ? ` under ${path_prefix}` : ""}. Try mode="hybrid", broader wording, or remove path_prefix.` }], structuredContent: { results: [] } };
        const results = hits.map((h, i) => ({ rank: i + 1, score: Number(h.score.toFixed(4)), ranks: h.ranks, ...chunkDto(h.chunk) }));
        const text =
          response_format === "json"
            ? JSON.stringify({ results }, null, 2)
            : hits.map((h, i) => `### ${i + 1}. ${cite(h.chunk)} — ${label(h.chunk)}\n${codeBlock(h.chunk)}`).join("\n\n");
        return { content: [{ type: "text", text }], structuredContent: { results } };
      }),
  );

  server.registerTool(
    "copilot_get_symbol",
    {
      title: "Get a symbol's definition",
      description: "Return the full definition of a function, class, method, type or constant by name (case-insensitive; exact matches first, then partial). Use when you know the symbol name; use copilot_search_code when you only know what the code does.",
      inputSchema: {
        repo: repoField,
        name: z.string().trim().min(1).max(120).describe("Symbol name, e.g. \"SmartRouter\" or \"setCookie\""),
        limit: z.number().int().min(1).max(10).default(3),
        response_format: formatField,
      },
      annotations: READ_ONLY,
    },
    async ({ repo, name, limit, response_format }) =>
      withIndex(repo, (index) => {
        const found = findSymbols(index, name, limit);
        if (found.length === 0) return { content: [{ type: "text", text: `No symbol named "${name}". Try copilot_search_code with a description of what it does, or copilot_find_usages if it is defined outside the indexed paths.` }], structuredContent: { symbols: [] } };
        const symbols = found.map(chunkDto);
        const text = response_format === "json" ? JSON.stringify({ symbols }, null, 2) : found.map((c) => `### ${label(c)} — ${cite(c)}\n${codeBlock(c, 120)}`).join("\n\n");
        return { content: [{ type: "text", text }], structuredContent: { symbols } };
      }),
  );

  server.registerTool(
    "copilot_find_usages",
    {
      title: "Find usages of an identifier",
      description: "List every line that references an identifier as a whole word (call sites, imports, type references), with the enclosing symbol. Paginated. Use before refactoring or to trace how a function is called.",
      inputSchema: {
        repo: repoField,
        identifier: z.string().trim().regex(/^[A-Za-z_$][A-Za-z0-9_$]{1,79}$/, "a single identifier, 2-80 characters").describe("Exact identifier, case-sensitive"),
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).max(10_000).default(0),
        response_format: formatField,
      },
      annotations: READ_ONLY,
    },
    async ({ repo, identifier, limit, offset, response_format }) =>
      withIndex(repo, (index) => {
        const { total, items } = findUsages(index, identifier, limit, offset);
        const page = { total_count: total, count: items.length, offset, has_more: offset + items.length < total, next_offset: offset + items.length < total ? offset + items.length : null, items };
        if (total === 0) return { content: [{ type: "text", text: `No usages of "${identifier}" (matching is case-sensitive and whole-word). Check spelling with copilot_get_symbol.` }], structuredContent: page };
        const text =
          response_format === "json"
            ? JSON.stringify(page, null, 2)
            : `${total} usages of \`${identifier}\` (showing ${offset + 1}-${offset + items.length})\n` +
              items.map((u) => `- ${u.file}:${u.line}${u.symbol ? ` (in ${u.symbol})` : ""} — \`${u.text}\``).join("\n") +
              (page.has_more ? `\n\nMore results: call again with offset=${page.next_offset}.` : "");
        return { content: [{ type: "text", text }], structuredContent: page };
      }),
  );

  server.registerTool(
    "copilot_read_chunk",
    {
      title: "Read a chunk with surrounding context",
      description: "Return the full text of a chunk by `chunk_id` (from copilot_search_code / copilot_find_usages), optionally with the neighbouring chunks from the same file to see surrounding code.",
      inputSchema: {
        repo: repoField,
        chunk_id: z.string().min(3).max(400).describe("e.g. \"src/router/trie-router/node.ts#45-98\""),
        neighbors: z.number().int().min(0).max(3).default(0).describe("How many chunks before and after to include"),
      },
      annotations: READ_ONLY,
    },
    async ({ repo, chunk_id, neighbors }) =>
      withIndex(repo, (index) => {
        const at = index.byId.get(chunk_id); // map lookup: the id is never used as a path
        if (at === undefined) return fail(`Unknown chunk_id "${chunk_id}". Chunk ids come from copilot_search_code results — do not construct them by hand.`);
        const file = index.chunks[at].file;
        const sameFile = index.chunks.map((c, i) => [c, i] as const).filter(([c]) => c.file === file);
        const pos = sameFile.findIndex(([, i]) => i === at);
        const picked = sameFile.slice(Math.max(0, pos - neighbors), pos + neighbors + 1).map(([c]) => c);
        const text = picked.map((c) => `### ${cite(c)} — ${label(c)}${c.id === chunk_id ? " ◀ requested" : ""}\n${codeBlock(c, 400)}`).join("\n\n");
        return { content: [{ type: "text", text }], structuredContent: { chunks: picked.map(chunkDto) } };
      }),
  );

  server.registerResource(
    "indexed-repos",
    "copilot://repos",
    { title: "Indexed repositories", description: "Manifest of every searchable repository: commit, languages, chunk counts, embedding model.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await listManifests(), null, 2) }] }),
  );
}
