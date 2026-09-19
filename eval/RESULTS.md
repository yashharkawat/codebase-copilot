# Retrieval evaluation

Corpus: `honojs/hono` @ `098e119` (`src/`, tests excluded). 50 hand-verified questions
(30 semantic — phrased without the target's identifiers — and 20 lexical).
A hit = right file **and** overlapping line range. Embeddings: bge-small-en-v1.5 (q8). Latency: median per query on an Apple-silicon laptop, models warm.

| Configuration | Chunks | Recall@1 | Recall@5 | Recall@10 | MRR@10 | R@5 semantic | R@5 lexical | Latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Naive 50-line windows + dense (baseline) | 726 | 44.0% | 80.0% | 88.0% | 0.601 | 76.7% | 85.0% | 5 ms |
| Naive windows + hybrid | 726 | 54.0% | 84.0% | 98.0% | 0.673 | 76.7% | 95.0% | 5 ms |
| AST chunks + dense | 1127 | 50.0% | 80.0% | 86.0% | 0.638 | 66.7% | 100.0% | 5 ms |
| AST chunks + BM25 | 1127 | 60.0% | 86.0% | 92.0% | 0.694 | 76.7% | 100.0% | 0 ms |
| AST chunks + hybrid (RRF) | 1127 | 62.0% | 88.0% | 98.0% | 0.729 | 80.0% | 100.0% | 5 ms |
| AST chunks + hybrid + cross-encoder rerank | 1127 | 46.0% | 80.0% | 94.0% | 0.604 | 66.7% | 100.0% | 658 ms |

Reproduce: `git clone https://github.com/honojs/hono data/repos/hono && git -C data/repos/hono checkout 098e11912ab244c5c33931de007f04dc8e3c2929 && npm run eval`
