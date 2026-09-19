/**
 * Retrieval ablation over the gold question set.
 *   npm run eval            → all configurations
 * A result counts as a hit when it is in the gold file AND its line range overlaps the gold range,
 * so returning the right file but the wrong function does not score.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { indexRepo } from "../src/core/indexer";
import { search } from "../src/core/retriever";
import { loadIndex } from "../src/core/store";
import type { SearchMode } from "../src/core/types";

interface Gold { file: string; symbol: string; startLine: number; endLine: number }
interface Question { id: string; category: "semantic" | "lexical"; question: string; gold: Gold[] }

const REPO_PATH = "data/repos/hono";
const EVAL_INDEXES = path.resolve("eval/.indexes");
const CONFIGS: Array<{ name: string; chunker: "naive" | "ast"; mode: SearchMode; rerank: boolean }> = [
  { name: "Naive 50-line windows + dense (baseline)", chunker: "naive", mode: "dense", rerank: false },
  { name: "Naive windows + hybrid", chunker: "naive", mode: "hybrid", rerank: false },
  { name: "AST chunks + dense", chunker: "ast", mode: "dense", rerank: false },
  { name: "AST chunks + BM25", chunker: "ast", mode: "bm25", rerank: false },
  { name: "AST chunks + hybrid (RRF)", chunker: "ast", mode: "hybrid", rerank: false },
  { name: "AST chunks + hybrid + cross-encoder rerank", chunker: "ast", mode: "hybrid", rerank: true },
];

const K = 10;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
const pct = (x: number) => (x * 100).toFixed(1) + "%";

async function ensureIndex(chunker: "naive" | "ast"): Promise<string> {
  const id = `hono-${chunker}`;
  try {
    await fs.access(path.join(EVAL_INDEXES, id, "manifest.json"));
  } catch {
    console.error(`building ${id} index…`);
    await indexRepo(REPO_PATH, { id, chunker, include: ["src"], outDir: EVAL_INDEXES });
  }
  return id;
}

async function main(): Promise<void> {
  const set = JSON.parse(await fs.readFile("eval/hono.questions.json", "utf8")) as { repo: string; commit: string; questions: Question[] };
  const rows = [];
  for (const cfg of CONFIGS) {
    const index = (await loadIndex(await ensureIndex(cfg.chunker), EVAL_INDEXES))!;
    await search(index, "warm up", { mode: cfg.mode, rerank: cfg.rerank, k: K }); // exclude model load from latency
    const firstHit: number[] = [];
    const fileHit5: boolean[] = [];
    const latency: number[] = [];
    const misses: string[] = [];
    for (const q of set.questions) {
      const t = performance.now();
      const hits = await search(index, q.question, { mode: cfg.mode, rerank: cfg.rerank, k: K });
      latency.push(performance.now() - t);
      const rank = hits.findIndex((h) => q.gold.some((g) => g.file === h.chunk.file && h.chunk.startLine <= g.endLine && h.chunk.endLine >= g.startLine));
      firstHit.push(rank < 0 ? Infinity : rank + 1);
      fileHit5.push(hits.slice(0, 5).some((h) => q.gold.some((g) => g.file === h.chunk.file)));
      if (rank < 0 || rank >= 5) misses.push(q.id);
    }
    const at = (k: number, subset?: Question["category"]) => {
      const idx = set.questions.map((q, i) => (subset && q.category !== subset ? -1 : i)).filter((i) => i >= 0);
      return idx.filter((i) => firstHit[i] <= k).length / idx.length;
    };
    const row = {
      config: cfg.name,
      chunks: index.chunks.length,
      recall1: at(1),
      recall5: at(5),
      recall10: at(10),
      mrr10: firstHit.reduce((s, r) => s + (r <= K ? 1 / r : 0), 0) / firstHit.length,
      fileRecall5: fileHit5.filter(Boolean).length / fileHit5.length,
      recall5Semantic: at(5, "semantic"),
      recall5Lexical: at(5, "lexical"),
      medianLatencyMs: Math.round(median(latency)),
      missedAt5: misses,
    };
    rows.push(row);
    console.error(`${cfg.name}: R@5 ${pct(row.recall5)}  MRR ${row.mrr10.toFixed(3)}  ${row.medianLatencyMs}ms`);
  }

  const md = [
    `# Retrieval evaluation`,
    ``,
    `Corpus: \`${set.repo}\` @ \`${set.commit.slice(0, 7)}\` (\`src/\`, tests excluded). ${set.questions.length} hand-verified questions`,
    `(${set.questions.filter((q) => q.category === "semantic").length} semantic — phrased without the target's identifiers — and ${set.questions.filter((q) => q.category === "lexical").length} lexical).`,
    `A hit = right file **and** overlapping line range. Embeddings: bge-small-en-v1.5 (q8). Latency: median per query on an Apple-silicon laptop, models warm.`,
    ``,
    `| Configuration | Chunks | Recall@1 | Recall@5 | Recall@10 | MRR@10 | R@5 semantic | R@5 lexical | Latency |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|`,
    ...rows.map((r) => `| ${r.config} | ${r.chunks} | ${pct(r.recall1)} | ${pct(r.recall5)} | ${pct(r.recall10)} | ${r.mrr10.toFixed(3)} | ${pct(r.recall5Semantic)} | ${pct(r.recall5Lexical)} | ${r.medianLatencyMs} ms |`),
    ``,
    `Reproduce: \`git clone https://github.com/${set.repo} data/repos/hono && git -C data/repos/hono checkout ${set.commit} && npm run eval\``,
    ``,
  ].join("\n");
  await fs.writeFile("eval/RESULTS.md", md);
  await fs.writeFile("eval/results.json", JSON.stringify({ repo: set.repo, commit: set.commit, questions: set.questions.length, generatedAt: new Date().toISOString(), rows }, null, 2) + "\n");
  console.log(md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
