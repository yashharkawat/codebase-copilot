import EvalTable from "./components/EvalTable";
import Playground from "./components/Playground";
import results from "@/eval/results.json";

const REPO_URL = "https://github.com/yashharkawat/codebase-copilot";
const SITE = "https://codebase-copilot-omega.vercel.app";

const TOOLS = [
  ["copilot_search_code", "Hybrid semantic + keyword search. Returns symbol-level chunks with file:line citations."],
  ["copilot_get_symbol", "Full definition of a function, class, method or type by name."],
  ["copilot_find_usages", "Every whole-word reference to an identifier, paginated."],
  ["copilot_read_chunk", "A chunk plus its neighbours from the same file."],
  ["copilot_list_repos", "What is indexed: commit, languages, chunk counts."],
];

const PIPELINE = [
  ["Parse", "tree-sitter (WASM) splits each file into functions, methods, classes and types — not arbitrary 50-line windows. Class fields holding arrow functions count as methods; runs of tiny type aliases are merged."],
  ["Embed", "bge-small-en-v1.5 runs locally through ONNX Runtime — in the CLI and inside the Vercel function. No embedding API, no key, 10 ms per warm query."],
  ["Retrieve", "Cosine search over a flat Float32 file plus BM25 with a code-aware tokenizer (getCookieValue → get, cookie, value), fused with reciprocal-rank fusion."],
  ["Serve", "One tool registry, two transports: stdio for local repos, Streamable HTTP for this hosted demo. The host model does the reasoning; the server only retrieves."],
];

export default function Home() {
  const baseline = results.rows[0];
  const best = results.rows.reduce((a, b) => (b.recall5 > a.recall5 ? b : a));
  const rerank = results.rows[results.rows.length - 1];
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">
      <header>
        <p className="font-mono text-sm text-accent">MCP server · RAG · TypeScript</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white sm:text-5xl">Codebase Copilot</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-gray-300">
          Gives Claude Code, Cursor and Claude Desktop real code search over any repository: syntax-aware chunking, local embeddings, hybrid
          retrieval — and a measured answer to “is it actually better than naive RAG?”
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <a href={REPO_URL} className="rounded-lg bg-white px-4 py-2 font-medium text-ink hover:bg-gray-200">View source on GitHub</a>
          <a href="#install" className="rounded-lg border border-edge px-4 py-2 font-medium text-gray-200 hover:border-accent">Connect it to your editor</a>
        </div>
        <dl className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ["Recall@5", `${Math.round(baseline.recall5 * 100)}% → ${Math.round(best.recall5 * 100)}%`],
            ["Recall@1", `${Math.round(baseline.recall1 * 100)}% → ${Math.round(best.recall1 * 100)}%`],
            ["MRR@10", `${baseline.mrr10.toFixed(2)} → ${best.mrr10.toFixed(2)}`],
            ["Query latency", `${best.medianLatencyMs} ms`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-edge bg-panel/60 px-4 py-4">
              <dt className="text-xs uppercase tracking-wide text-gray-400">{k}</dt>
              <dd className="mt-1 font-mono text-lg text-white">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-gray-500">Naive windows + dense baseline → AST chunks + hybrid. {results.questions} hand-verified questions over honojs/hono.</p>
      </header>

      <div className="mt-12"><Playground /></div>

      <section aria-labelledby="eval" className="mt-16">
        <h2 id="eval" className="text-2xl font-semibold text-white">Measured, not assumed</h2>
        <p className="mt-3 max-w-3xl leading-7 text-gray-300">
          {results.questions} questions a new contributor might ask, each mapped by hand to the exact function that answers it. 30 are phrased
          without any identifier from the target. A result only counts if it is in the right file <em>and</em> overlaps the right lines.
        </p>
        <div className="mt-6"><EvalTable /></div>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-400">
          The surprise: a general-domain cross-encoder reranker (ms-marco-MiniLM) <strong className="text-gray-200">lowered</strong> Recall@5
          from {Math.round(best.recall5 * 100)}% to {Math.round(rerank.recall5 * 100)}% and cost {rerank.medianLatencyMs} ms per query. It was trained on web passages, not code, so it
          ships disabled. Toggle it above to see it reorder results.
        </p>
      </section>

      <section aria-labelledby="how" className="mt-16">
        <h2 id="how" className="text-2xl font-semibold text-white">How it works</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2">
          {PIPELINE.map(([title, body], i) => (
            <li key={title} className="rounded-xl border border-edge bg-panel/60 p-5">
              <p className="font-mono text-xs text-accent">0{i + 1}</p>
              <h3 className="mt-1 font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-300">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="install" className="mt-16">
        <h2 id="install" className="text-2xl font-semibold text-white">Connect it to your editor</h2>
        <p className="mt-3 text-gray-300">Hosted demo (searches honojs/hono), Streamable HTTP:</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-edge bg-panel px-4 py-3 font-mono text-sm text-gray-200"><code>{`claude mcp add --transport http codebase-copilot ${SITE}/api/mcp`}</code></pre>
        <p className="mt-5 text-gray-300">Your own repository, fully local over stdio:</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-edge bg-panel px-4 py-3 font-mono text-sm text-gray-200"><code>{`git clone ${REPO_URL} && cd codebase-copilot && npm install
npm run cli -- index /path/to/your/repo --id myrepo
claude mcp add codebase-copilot -- npx tsx $PWD/cli/main.ts serve`}</code></pre>
        <ul className="mt-6 divide-y divide-edge rounded-xl border border-edge">
          {TOOLS.map(([name, desc]) => (
            <li key={name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
              <code className="shrink-0 font-mono text-sm text-accent sm:w-56">{name}</code>
              <span className="text-sm text-gray-300">{desc}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="security" className="mt-16">
        <h2 id="security" className="text-2xl font-semibold text-white">Security posture</h2>
        <ul className="mt-4 grid gap-x-8 gap-y-2 text-sm leading-6 text-gray-300 sm:grid-cols-2">
          <li>Every tool is read-only and answers from the index — no request value ever becomes a file path.</li>
          <li>Zod validation on every route and tool; identifier search uses indexOf, never a user-built RegExp.</li>
          <li>The indexer skips .env, keys and any file matching credential patterns.</li>
          <li>Retrieved code is treated as untrusted: fenced with a per-request random tag, and the answering model has no tools.</li>
          <li>Nonce-based CSP, code rendered as text nodes only, per-IP rate limits, no stack traces to clients.</li>
          <li>Only <code className="font-mono">:free</code> model ids can be called — a paid slug throws before any request is made.</li>
        </ul>
      </section>

      <footer className="mt-16 border-t border-edge pt-6 text-sm text-gray-500">
        Built by Yash Harkawat · <a href={REPO_URL} className="underline hover:text-gray-300">source, design spec and eval set</a>
      </footer>
    </main>
  );
}
