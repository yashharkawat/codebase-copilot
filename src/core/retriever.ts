import { embedQuery } from "./embedder";
import { rerankScores } from "./reranker";
import type { LoadedIndex } from "./store";
import { embeddingText, type SearchHit, type SearchOptions } from "./types";

const CANDIDATES = 50;
const RERANK_POOL = 30;
const RRF_K = 60;

function denseSearch(index: LoadedIndex, q: Float32Array, limit: number, allow?: (i: number) => boolean): Array<[number, number]> {
  const { vectors, manifest, chunks } = index;
  const dim = manifest.dim;
  const scored: Array<[number, number]> = [];
  for (let i = 0; i < chunks.length; i++) {
    if (allow && !allow(i)) continue;
    let dot = 0;
    const off = i * dim;
    for (let j = 0; j < dim; j++) dot += vectors[off + j] * q[j];
    scored.push([i, dot]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export async function search(index: LoadedIndex, query: string, opts: SearchOptions): Promise<SearchHit[]> {
  const prefix = opts.pathPrefix?.replace(/^\/+/, "");
  const allow = prefix ? (i: number) => index.chunks[i].file.startsWith(prefix) : undefined;

  const dense = opts.mode === "bm25" ? [] : denseSearch(index, await embedQuery(query), CANDIDATES, allow);
  const sparse = opts.mode === "dense" ? [] : index.bm25.search(query, CANDIDATES, allow);

  // Reciprocal Rank Fusion: ranks, not scores, so cosine and BM25 never need calibrating.
  const fused = new Map<number, SearchHit>();
  const add = (list: Array<[number, number]>, key: "dense" | "bm25") =>
    list.forEach(([doc], rank) => {
      const hit = fused.get(doc) ?? { chunk: index.chunks[doc], score: 0, ranks: {} };
      hit.score += 1 / (RRF_K + rank + 1);
      hit.ranks[key] = rank + 1;
      fused.set(doc, hit);
    });
  add(dense, "dense");
  add(sparse, "bm25");
  let hits = [...fused.values()].sort((a, b) => b.score - a.score);

  if (opts.rerank && hits.length > 1) {
    const pool = hits.slice(0, RERANK_POOL);
    const scores = await rerankScores(query, pool.map((h) => embeddingText(h.chunk, true)));
    pool.forEach((h, i) => (h.score = scores[i]));
    pool.sort((a, b) => b.score - a.score);
    pool.forEach((h, i) => (h.ranks.rerank = i + 1));
    hits = pool;
  }
  return hits.slice(0, opts.k);
}

/** Whole-word identifier lookup over indexed text. indexOf + boundary checks: no user-built RegExp, no ReDoS. */
export function findUsages(index: LoadedIndex, identifier: string, limit: number, offset = 0) {
  const isWord = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
  const all: Array<{ chunkId: string; file: string; line: number; text: string; symbol: string | null }> = [];
  const seen = new Set<string>();
  for (const chunk of index.chunks) {
    if (!chunk.text.includes(identifier)) continue;
    chunk.text.split("\n").forEach((line, i) => {
      let from = 0;
      for (;;) {
        const at = line.indexOf(identifier, from);
        if (at < 0) break;
        from = at + identifier.length;
        if (isWord(line[at - 1]) || isWord(line[from])) continue;
        const key = `${chunk.file}:${chunk.startLine + i}`;
        if (seen.has(key)) break; // overlapping windows repeat lines
        seen.add(key);
        all.push({ chunkId: chunk.id, file: chunk.file, line: chunk.startLine + i, text: line.trim().slice(0, 200), symbol: chunk.symbol });
        break;
      }
    });
  }
  return { total: all.length, items: all.slice(offset, offset + limit) };
}

export function findSymbols(index: LoadedIndex, name: string, limit: number) {
  const needle = name.toLowerCase();
  const exact = index.chunks.filter((c) => c.symbol?.toLowerCase() === needle);
  const partial = index.chunks.filter((c) => c.symbol && c.symbol.toLowerCase() !== needle && c.symbol.toLowerCase().includes(needle));
  return [...exact, ...partial].slice(0, limit);
}
