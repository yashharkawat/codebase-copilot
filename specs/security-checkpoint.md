# Security checkpoint (run before implementation)

Threat model: a public, unauthenticated, read-only service over public open-source code,
plus a local CLI that reads a developer's private repository.

| Category | Risk | Control |
|---|---|---|
| **Auth** | Public endpoints, no accounts | Deliberate: data is public OSS and every tool is read-only. No secrets are reachable from any handler. Documented, not an omission |
| **Authz / IDOR** | Caller names a repo or chunk id | Repo id must match `^[a-z0-9][a-z0-9._-]{0,63}$` AND exist in the loaded index manifest. Chunk ids are looked up in an in-memory map. No user input ever becomes a file path at query time |
| **Path traversal** | `read_file`-style tools | There is none. Tools return text stored in the index. The only file access is loading `index/<id>/` for ids taken from the manifest, never from the request |
| **Input** | Oversized / malformed input, ReDoS | Zod on every route and tool: query ≤ 500 chars, k ≤ 20, enum modes. `find_usages` matches identifiers with `indexOf` + boundary checks, never a user-built RegExp |
| **Output / XSS** | Indexed code contains `<script>` | React text nodes only; CSP `default-src 'self'`; `X-Content-Type-Options: nosniff` |
| **Prompt injection** | Indexed code or comments say "ignore previous instructions" | Retrieved chunks are wrapped in delimited, labelled blocks and declared untrusted data in the system prompt. The answering LLM has **no tools**, so a successful injection can only alter text. Regression test in `tests/injection.test.ts` |
| **Secrets in an index** | Developer indexes a repo containing `.env` | Walker honours `.gitignore`, hard-skips `.env*`, keys, pems, lockfiles, binaries, files > 256 KB, and drops chunks matching high-confidence secret patterns |
| **Rate limiting / cost** | LLM budget burn, scraping | Per-IP sliding window on `/api/search`, `/api/ask`, `/api/mcp`; global daily cap on LLM answers; only `:free` model ids are accepted by the client, anything else throws |
| **Secrets handling** | API key leakage | `OPENROUTER_API_KEY` only from env, server-side only, never logged, never returned. `.env*` git-ignored |
| **Error handling** | Stack traces to clients | Central `toPublicError()`; details go to server logs only |
| **Logging** | Abuse visibility | Structured log line per rate-limit hit and per LLM call (no query text at info level) |
| **DNS rebinding (local HTTP)** | Local `serve --http` | Binds `127.0.0.1`, validates `Origin`/`Host` |
| **Supply chain** | Model + grammar downloads | Model id pinned; grammars come from a pinned npm package; `npm audit` in CI |

Known limitation: serverless rate limits are per warm instance (no shared store on the free
tier). The hard backstop is OpenRouter's own free-tier quota, which cannot be billed.
