export type ChunkKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "module" | "window";

export interface Chunk {
  /** Stable id: `<file>#<startLine>-<endLine>` */
  id: string;
  file: string;
  language: string;
  symbol: string | null;
  /** Enclosing class / impl / namespace, if any */
  parent: string | null;
  kind: ChunkKind;
  startLine: number; // 1-indexed, inclusive
  endLine: number;
  text: string;
}

export interface Manifest {
  id: string;
  name: string;
  source: string;
  commit: string | null;
  chunker: "ast" | "naive";
  model: string;
  dim: number;
  chunkCount: number;
  fileCount: number;
  languages: Record<string, number>;
  createdAt: string;
}

export type SearchMode = "dense" | "bm25" | "hybrid";

export interface SearchOptions {
  mode: SearchMode;
  k: number;
  rerank: boolean;
  /** Optional path prefix filter, e.g. "src/router" */
  pathPrefix?: string;
}

export interface SearchHit {
  chunk: Chunk;
  score: number;
  ranks: { dense?: number; bm25?: number; rerank?: number };
}

/** What to embed: a small context header makes symbol-level chunks self-describing. */
export function embeddingText(c: Chunk, withHeader: boolean): string {
  if (!withHeader) return c.text;
  const sym = c.symbol ? `${c.parent ? c.parent + "." : ""}${c.symbol} (${c.kind})` : c.kind;
  return `// file: ${c.file}\n// ${sym}\n${c.text}`;
}
