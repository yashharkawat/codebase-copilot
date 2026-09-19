# Codebase Copilot

**An MCP server that gives Claude Code, Cursor and Claude Desktop real code search over any repository** — syntax-aware chunking, local embeddings, hybrid retrieval, and a measured answer to "is this actually better than naive RAG?"

**Live demo:** https://codebase-copilot-omega.vercel.app · **Remote MCP endpoint:** `https://codebase-copilot-omega.vercel.app/api/mcp`

| | Naive RAG baseline | This project |
|---|---:|---:|
| Recall@5 | 80% | **88%** |
| Recall@1 | 44% | **62%** |
| MRR@10 | 0.60 | **0.73** |
| Query latency (warm) | 5 ms | 5 ms |

50 hand-verified questions over [honojs/hono](https://github.com/honojs/hono) (187 files, 26k lines). Full ablation [below](#evaluation).

## Why

Coding agents find code with `grep`. That works when you know the identifier and fails when you only know the behaviour ("where do we stop SSG writing outside the output dir?"). Most RAG-over-code demos fix that with fixed-size text windows and one embedding call — and never measure whether it works. This project does the retrieval properly, exposes it over MCP so the *host* model does the reasoning, and measures every design decision.

## Architecture

```
            index time (local CLI)                              query time (stdio or Vercel function)
 repo ─► walker ─► tree-sitter chunker ─► embedder ─► index/ ─► dense cosine ──┐
        .gitignore    symbol-level chunks    bge-small   chunks.json            ├─► RRF ─► (optional rerank) ─► cited chunks
        secret skip   + context header       ONNX, local vectors.bin  BM25 ─────┘
                                                                     code-aware
                                   ┌──────────── one tool registry ────────────┐
                                   │  stdio  ─► Claude Code / Cursor (local)   │
                                   │  Streamable HTTP ─► /api/mcp (hosted)     │
                                   └───────────────────────────────────────────┘
```

| Layer | Choice | Reason |
|---|---|---|
| Chunking | tree-sitter (WASM): functions, methods, classes, types. Oversized classes split into members; oversized functions windowed with the symbol name kept; runs of tiny type aliases merged | A chunk should be a unit of meaning. Seven languages, no native build step |
| Embeddings | `bge-small-en-v1.5`, int8 ONNX, via transformers.js | No API, no key, no cost. The same model runs in the CLI and **inside the Vercel function** (1.6 s cold, ~10 ms warm) |
| Vector store | Flat `Float32Array` file, brute-force cosine | 1,127 chunks scan in < 5 ms. The index ships with the deployment: zero infrastructure. The `LoadedIndex` interface leaves room for pgvector |
| Sparse | BM25 with a code tokenizer: `getCookieValue` → `get`, `cookie`, `value`, `getcookievalue`; symbol and path boosted | Identifiers are the strongest signal in code |
| Fusion | Reciprocal Rank Fusion (k = 60) | Rank-based, so cosine and BM25 scores never need calibrating |
| MCP | `@modelcontextprotocol/server` v2, one `registerCopilotTools()` for both transports | Local private repos over stdio; hosted demo over Streamable HTTP |
| Web | Next.js 16 App Router on Vercel | Playground, streamed cited answers, eval table |
| LLM | OpenRouter `:free` models with rotation — **optional** | The MCP path needs no LLM: the host is the LLM |

## MCP tools

| Tool | Purpose |
|---|---|
| `copilot_search_code` | Hybrid search by meaning or keyword → symbol-level chunks with `file:start-end` citations. `mode`, `rerank`, `limit`, `path_prefix`, `response_format` |
| `copilot_get_symbol` | Full definition by name (exact matches first) |
| `copilot_find_usages` | Whole-word references with enclosing symbol. Paginated: `total_count`, `has_more`, `next_offset` |
| `copilot_read_chunk` | A chunk plus N neighbours from the same file |
| `copilot_list_repos` | What is indexed. Also exposed as the resource `copilot://repos` |

All tools are annotated `readOnlyHint`, validate input with Zod, return both Markdown and `structuredContent`, and fail with a message that says what to do next (`Unknown repo "x". Available: hono.`).

## Quick start

```bash
git clone https://github.com/yashharkawat/codebase-copilot && cd codebase-copilot && npm install

# 1. Index any repository (first run downloads the 34 MB embedding model)
npm run cli -- index /path/to/repo --id myrepo            # add --include src,lib to narrow it

# 2. Try it from the terminal
npm run cli -- search myrepo "where are sessions invalidated?"

# 3. Connect it to Claude Code (stdio, fully local — your code never leaves the machine)
claude mcp add codebase-copilot -- npx tsx "$PWD/cli/main.ts" serve

# Or use the hosted demo over HTTP (searches honojs/hono)
claude mcp add --transport http codebase-copilot https://codebase-copilot-omega.vercel.app/api/mcp
```

Cursor / Claude Desktop (`mcp.json`):

```json
{ "mcpServers": { "codebase-copilot": { "command": "npx", "args": ["tsx", "/abs/path/codebase-copilot/cli/main.ts", "serve"] } } }
```

Web app: `npm run dev`. Optional generated answers: copy `.env.example` to `.env.local` and add an OpenRouter key.

## Evaluation

`npm run eval` — 50 questions a new contributor might ask, each mapped by hand to the exact function that answers it ([`eval/hono.questions.json`](eval/hono.questions.json), pinned to commit `098e119`). 30 are *semantic*: phrased without any identifier from the target. **A hit requires the right file and an overlapping line range** — the right file with the wrong function scores zero.

| Configuration | R@1 | R@5 | R@10 | MRR@10 | R@5 semantic | R@5 lexical | Latency |
|---|---:|---:|---:|---:|---:|---:|---:|
| Naive 50-line windows + dense (baseline) | 44% | 80% | 88% | 0.60 | 77% | 85% | 5 ms |
| Naive windows + hybrid | 54% | 84% | 98% | 0.67 | 77% | 95% | 5 ms |
| AST chunks + dense | 50% | 80% | 86% | 0.64 | 67% | 100% | 5 ms |
| AST chunks + BM25 | 60% | 86% | 92% | 0.69 | 77% | 100% | <1 ms |
| AST chunks + hybrid (RRF) | 62% | 88% | 98% | 0.73 | 80% | 100% | 5 ms |
| AST chunks + hybrid + cross-encoder rerank | 46% | 80% | 94% | 0.60 | 67% | 100% | 658 ms |

What the numbers say:

- **Hybrid is the biggest single win.** BM25 alone beats dense alone on code. Dense retrieval rescues the questions that share no vocabulary with the code; BM25 rescues the ones where a small general-purpose embedding model is vague. Together: 100% of lexical and 80% of semantic questions in the top 5.
- **AST chunking mostly improves precision, not recall.** Recall@5 moves 84% → 88% under hybrid, but Recall@1 moves 54% → 62%: the first result is the function itself rather than a window that happens to contain part of it. For an agent with a limited context budget, that is the metric that matters.
- **The cross-encoder reranker made things worse** — Recall@5 88% → 80%, at 658 ms per query. `ms-marco-MiniLM` was trained on web passages; on code it prefers chunks with English-like comments over the chunk with the right logic. It ships **off**. I kept it in the table and behind a flag because a negative result you measured is worth more than a best practice you assumed.
- One eval-driven bug fix: the misses exposed that class fields holding arrow functions (`#cachedBody = (key) => {…}`) were not being treated as methods. That is a chunker bug class, not tuning to the test set; no retrieval parameter was tuned on these 50 questions.

Limitations, stated plainly: one repository, one language, 50 questions, written by an LLM and verified against the source rather than collected from real users. The naive baseline uses overlapping 50-line windows, which makes the overlap criterion slightly *easier* for it. An agent-level eval in mcp-builder format lives in [`eval/mcp_evaluation.xml`](eval/mcp_evaluation.xml) (10 tool-use questions with verified answers); it needs an Anthropic API key to run and has not been run yet.

## Security

Designed security-first: the checkpoint in [`specs/security-checkpoint.md`](specs/security-checkpoint.md) was written before the code.

- **No request value ever becomes a file path.** Tools answer from the in-memory index. Repo ids must match `^[a-z0-9][a-z0-9._-]{0,63}$` *and* exist in the on-disk manifest list; chunk ids are map lookups.
- **Input validation everywhere** (Zod): bounded query length, enum modes, capped limits, 8 KB body cap. Identifier search uses `indexOf` + boundary checks — there is no user-built `RegExp`, so no ReDoS.
- **The indexer protects you from yourself**: honours `.gitignore`, never follows symlinks, hard-skips `.env*`, keys, keystores and lockfiles, and skips any file containing a private key, AWS, GitHub, Slack or LLM-provider token.
- **Prompt injection**: retrieved code is untrusted data. It is fenced in tags carrying a per-request random suffix (code cannot forge the closing tag), the system prompt says so, and the answering model is given **no tools** — a successful injection can change text, nothing else. Covered by `tests/security.test.ts`.
- **Cost safety**: `assertFreeModel()` throws on any model id that is not a `:free` slug, before a request is made.
- **Web**: per-request nonce CSP with `strict-dynamic`, `default-src 'none'` on all API routes, HSTS, `nosniff`, `frame-ancestors 'none'`. Code is rendered as React text nodes only. Errors are mapped to safe messages; stack traces stay in server logs.
- **Rate limits** per IP on search, ask and MCP. Known limitation: in-memory, so per warm instance on serverless — a speed bump, not a quota.
- **Deliberately no auth**: the hosted data is public open source and every tool is read-only. For private code, use stdio — nothing leaves the machine.

## Project layout

```
src/core/     walker · chunker · embedder · bm25 · store · retriever · reranker · indexer
src/mcp/      tool + resource registry (shared by both transports)
src/server/   zod schemas · rate limiter · error mapping · OpenRouter client
cli/          index · search · serve (stdio)
app/          Next.js UI + /api/search · /api/ask · /api/mcp · /api/repos · /api/health
eval/         gold questions · ablation runner · results · MCP agent eval
specs/        design doc · security checkpoint
tests/        28 tests: chunker, tokenizer/BM25, walker, retriever, security
index/hono/   the shipped demo index (2.7 MB)
```

`npm test` · `npm run typecheck` · `npm run lint` · `npm run eval`

## License

MIT
