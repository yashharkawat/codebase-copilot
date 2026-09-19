import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chunkAst, chunkNaive } from "./chunker";
import { EMBEDDING_DIM, EMBEDDING_MODEL, embedPassages } from "./embedder";
import { writeIndex } from "./store";
import { embeddingText, type Chunk, type Manifest } from "./types";
import { walkRepo, type WalkOptions } from "./walker";

const run = promisify(execFile);

export interface IndexOptions extends WalkOptions {
  id: string;
  name?: string;
  source?: string;
  chunker?: "ast" | "naive";
  outDir: string;
  onProgress?: (done: number, total: number) => void;
}

export async function indexRepo(repoPath: string, opts: IndexOptions): Promise<Manifest & { skippedSecrets: string[] }> {
  const chunker = opts.chunker ?? "ast";
  const { files, skippedSecrets } = await walkRepo(repoPath, opts);
  const chunks: Chunk[] = [];
  const languages: Record<string, number> = {};
  for (const file of files) {
    const fileChunks = chunker === "ast" ? await chunkAst(file) : chunkNaive(file);
    chunks.push(...fileChunks);
    languages[file.language] = (languages[file.language] ?? 0) + 1;
  }
  if (chunks.length === 0) throw new Error("Nothing to index: no supported source files found.");

  const vectors: Float32Array[] = [];
  const BATCH = 32;
  for (let i = 0; i < chunks.length; i += BATCH) {
    // The naive baseline embeds raw text only; the AST chunker adds a file/symbol header.
    const texts = chunks.slice(i, i + BATCH).map((c) => embeddingText(c, chunker === "ast"));
    vectors.push(...(await embedPassages(texts)));
    opts.onProgress?.(Math.min(i + BATCH, chunks.length), chunks.length);
  }

  let commit: string | null = null;
  try {
    // execFile with an argument array: no shell, so the path cannot inject a command.
    commit = (await run("git", ["-C", repoPath, "rev-parse", "HEAD"])).stdout.trim();
  } catch {
    /* not a git checkout */
  }

  const manifest: Manifest = {
    id: opts.id,
    name: opts.name ?? opts.id,
    source: opts.source ?? "local",
    commit,
    chunker,
    model: EMBEDDING_MODEL,
    dim: EMBEDDING_DIM,
    chunkCount: chunks.length,
    fileCount: files.length,
    languages,
    createdAt: new Date().toISOString(),
  };
  await writeIndex(opts.outDir, manifest, chunks, vectors);
  return { ...manifest, skippedSecrets };
}
