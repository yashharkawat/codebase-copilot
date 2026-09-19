# Feature: Codebase Copilot

An MCP server that lets any MCP host (Claude Code, Cursor, Claude Desktop) search and
navigate a code repository through retrieval tools, plus a hosted web demo.

## Requirements (EARS)

- When a developer runs `codebase-copilot index <path>`, the system shall parse source files
  into symbol-level chunks, embed them locally, and write a portable index to disk.
- While an index exists, when an MCP host calls `copilot_search_code`, the system shall return
  the top ranked chunks with `file:startLine-endLine` citations.
- When a host calls `copilot_get_symbol` / `copilot_find_usages` / `copilot_read_chunk`, the
  system shall answer from the index only and never touch the file system.
- When a visitor asks a question in the web demo, the system shall retrieve context and
  stream a grounded answer whose claims cite retrieved chunks; when the LLM budget is
  exhausted the system shall fall back to retrieval-only results.
- When `npm run eval` runs, the system shall report recall@k and MRR for every retrieval
  configuration against the gold question set.

## Architecture

```
            index time (local CLI)                        query time (stdio or Vercel)
 repo ─► walker ─► tree-sitter chunker ─► embedder ─► index/  ─► dense (cosine) ─┐
        (.gitignore,   (symbol-level,     (bge-small,  chunks.json   BM25 (code-aware) ├─► RRF ─► cross-encoder ─► results
         secret skip)   context header)    ONNX, local) vectors.bin                   ─┘          rerank (optional)
```

- **Core (`src/core`)**: walker, chunker (AST + naive baseline), embedder, BM25, store, retriever.
  Pure TypeScript, no network at query time.
- **MCP (`src/mcp`)**: one `registerTools(server, ctx)` shared by two transports:
  stdio (`cli/`) for local use, Streamable HTTP (`app/api/mcp`) for the hosted demo.
- **Web (`app/`)**: Next.js App Router. Search UI with retrieval-mode toggle, cited code
  previews, streamed answers, eval results page.
- **Eval (`eval/`)**: 50 gold questions over honojs/hono at a pinned commit; ablation table.

### Decisions

| Decision | Choice | Why |
|---|---|---|
| Embeddings | `bge-small-en-v1.5` (q8 ONNX) via transformers.js | Free, no key, same model at index and query time, 10 ms warm in a Vercel function |
| Vector store | Flat Float32 file + brute-force cosine | ≤ 50k chunks scans in < 10 ms; zero infra; index ships with the deployment. Interface allows pgvector later |
| Sparse | In-process BM25 with camelCase/snake_case splitting | Identifiers are the strongest signal in code search |
| Fusion | Reciprocal Rank Fusion (k = 60) | Score-scale free, no tuning |
| Rerank | `ms-marco-MiniLM-L-6-v2` cross-encoder, top 30 → k | Measured in eval; enabled only if it earns its latency |
| Chunking | tree-sitter (WASM) symbol chunks with a context header | Function boundaries beat fixed windows; WASM avoids native builds |
| LLM | OpenRouter `:free` models, rotated on 402/429/5xx | Zero cost; the MCP path needs no LLM because the host is the LLM |

## [Frontend]
- Repo picker, query box, mode toggle (dense / BM25 / hybrid / hybrid+rerank), result cards
  with file path, line range, symbol, score breakdown and code preview.
- "Ask" streams an answer with `[n]` citations linked to result cards.
- Loading, empty, error and rate-limited states. Keyboard accessible, labelled controls.
- Code is rendered as text nodes only (never `dangerouslySetInnerHTML`).

## [Backend]
- `POST /api/search` `{repo, query, mode, k}` → ranked chunks.
- `POST /api/ask` `{repo, query}` → streamed text + citations.
- `GET /api/repos`, `GET /api/health`.
- `ALL /api/mcp` → Streamable HTTP MCP endpoint (stateless).
- Zod schemas on every input; typed response DTOs.

## [Security]
See `specs/security-checkpoint.md` (completed before implementation).

## Implementation Plan
- [x] Spike: ONNX embeddings inside a Vercel function
- [ ] Core: walker, chunkers, BM25, store, retriever + unit tests
- [ ] CLI: `index`, `search`, `serve`
- [ ] MCP tools + stdio + HTTP transports, Inspector check
- [ ] Eval harness + ablation
- [ ] Web UI + ask endpoint
- [ ] Security headers, rate limits, injection tests
- [ ] README, deploy, push
