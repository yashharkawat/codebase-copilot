"use client";

import { useEffect, useRef, useState } from "react";

interface Repo { id: string; name: string; commit: string | null; files: number; chunks: number; source: string }
interface Result {
  rank: number; score: number; ranks: { dense?: number; bm25?: number; rerank?: number };
  id: string; file: string; startLine: number; endLine: number; symbol: string | null; parent: string | null; kind: string; text: string;
}
type Mode = "hybrid" | "dense" | "bm25";

const EXAMPLES = [
  "Where is the routing strategy chosen after the first request?",
  "How are signed cookies verified?",
  "What happens when next() is called twice in a middleware?",
  "How does the RPC client build a URL from property access?",
];

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "hybrid", label: "Hybrid", hint: "dense + BM25, fused by rank" },
  { id: "dense", label: "Dense", hint: "embeddings only" },
  { id: "bm25", label: "BM25", hint: "keywords only" },
];

export default function Playground() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [answersEnabled, setAnswersEnabled] = useState(false);
  const [repo, setRepo] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [rerank, setRerank] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<"idle" | "searching" | "answering">("idle");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/repos")
      .then((r) => r.json())
      .then((d: { repos: Repo[]; answersEnabled: boolean }) => {
        setRepos(d.repos);
        setAnswersEnabled(d.answersEnabled);
        if (d.repos[0]) setRepo(d.repos[0].id);
      })
      .catch(() => setError("Could not load the repository list."));
    fetch("/api/health").catch(() => undefined); // warm the embedding model
  }, []);

  async function run(q: string, withAnswer: boolean) {
    const text = q.trim();
    if (text.length < 2 || !repo) return; // client-side guard; the server validates again
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    setError(null);
    setAnswer("");
    setStatus("searching");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, query: text, mode, rerank, k: 8 }),
        signal: ctl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed.");
      setResults(data.results);
      setTookMs(data.tookMs);

      if (withAnswer) {
        setStatus("answering");
        const ask = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo, query: text }), signal: ctl.signal });
        if (!ask.ok || !ask.body) throw new Error((await ask.json().catch(() => ({}))).error ?? "Answer failed.");
        const reader = ask.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          setAnswer((a) => a + decoder.decode(value, { stream: true }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctl) setStatus("idle");
    }
  }

  const active = repos.find((r) => r.id === repo);
  const busy = status !== "idle";

  return (
    <section aria-labelledby="try-it" className="rounded-2xl border border-edge bg-panel/60 p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="try-it" className="text-xl font-semibold text-white">Try the retriever</h2>
          <p className="mt-1 text-sm text-gray-400">
            The same engine the MCP tools call.{" "}
            {active && (
              <>
                Searching <span className="font-mono text-gray-300">{active.name}</span>
                {active.commit && <> @ <span className="font-mono text-gray-300">{active.commit.slice(0, 7)}</span></>} — {active.files} files, {active.chunks} chunks.
              </>
            )}
          </p>
        </div>
        {repos.length > 1 && (
          <label className="text-sm text-gray-400">
            Repository{" "}
            <select value={repo} onChange={(e) => setRepo(e.target.value)} className="ml-1 rounded-md border border-edge bg-ink px-2 py-1 text-gray-200">
              {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); run(query, false); }}>
        <label htmlFor="q" className="sr-only">Question about the codebase</label>
        <input
          id="q" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={500} autoComplete="off" spellCheck={false}
          placeholder="Ask where or how something is implemented…"
          className="min-w-0 flex-1 rounded-lg border border-edge bg-ink px-4 py-3 text-base text-white placeholder:text-gray-500 focus:border-accent focus:outline-none"
        />
        <div className="flex gap-2">
          <button type="submit" disabled={busy || query.trim().length < 2} className="rounded-lg bg-accent px-5 py-3 font-medium text-ink transition hover:brightness-110 disabled:opacity-40">
            {status === "searching" ? "Searching…" : "Search"}
          </button>
          <button type="button" onClick={() => run(query, true)} disabled={busy || query.trim().length < 2 || !answersEnabled}
            title={answersEnabled ? "Retrieve, then generate a cited answer" : "Generated answers are not enabled on this deployment"}
            className="rounded-lg border border-edge px-5 py-3 font-medium text-gray-200 transition hover:border-accent disabled:opacity-40">
            {status === "answering" ? "Answering…" : "Ask"}
          </button>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Retrieval mode</legend>
          {MODES.map((m) => (
            <label key={m.id} title={m.hint} className={`cursor-pointer rounded-md px-3 py-1.5 ${mode === m.id ? "bg-edge text-white" : "text-gray-400 hover:text-gray-200"}`}>
              <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="sr-only" />
              {m.label}
            </label>
          ))}
        </fieldset>
        <label className="flex cursor-pointer items-center gap-2 text-gray-400" title="Cross-encoder rerank of the top 30. Slower, and measured to hurt on code — try it.">
          <input type="checkbox" checked={rerank} onChange={(e) => setRerank(e.target.checked)} className="accent-emerald-400" />
          Cross-encoder rerank
        </label>
        {tookMs !== null && !busy && <span className="text-gray-500">{tookMs} ms</span>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" disabled={busy} onClick={() => { setQuery(ex); run(ex, false); }}
            className="rounded-full border border-edge px-3 py-1 text-xs text-gray-400 transition hover:border-accent hover:text-gray-200 disabled:opacity-40">
            {ex}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="mt-5 space-y-4">
        {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</p>}
        {answer && (
          <div className="rounded-lg border border-emerald-900 bg-emerald-950/30 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-400">Answer · citations refer to the results below</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-100">{answer}</p>
          </div>
        )}
        {results && results.length === 0 && <p className="text-sm text-gray-400">No results. Try hybrid mode or different wording.</p>}
        {results?.map((r) => (
          <article key={r.id} className="overflow-hidden rounded-lg border border-edge bg-ink">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge px-4 py-2 text-sm">
              <span className="font-mono text-gray-500">[{r.rank}]</span>
              <span className="font-mono text-accent">{r.file}:{r.startLine}-{r.endLine}</span>
              {r.symbol && <span className="text-gray-300">{r.parent ? `${r.parent}.` : ""}{r.symbol}</span>}
              <span className="rounded bg-edge px-1.5 py-0.5 text-xs text-gray-400">{r.kind}</span>
              <span className="ml-auto font-mono text-xs text-gray-500">
                {r.ranks.dense && `dense #${r.ranks.dense}`}{r.ranks.dense && r.ranks.bm25 && " · "}{r.ranks.bm25 && `bm25 #${r.ranks.bm25}`}{r.ranks.rerank && ` · rerank #${r.ranks.rerank}`}
              </span>
            </header>
            {/* Rendered as a text node: indexed code can never become markup. */}
            <pre className="max-h-80 overflow-auto px-4 py-3 font-mono text-xs leading-5 text-gray-300"><code>{r.text}</code></pre>
          </article>
        ))}
      </div>
    </section>
  );
}
