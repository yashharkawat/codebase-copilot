import fs from "node:fs/promises";
import path from "node:path";
import { Bm25Index } from "./bm25";
import type { Chunk, Manifest } from "./types";

export const REPO_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface LoadedIndex {
  manifest: Manifest;
  chunks: Chunk[];
  /** Row-major, L2-normalised: chunk i lives at [i*dim, (i+1)*dim) */
  vectors: Float32Array;
  bm25: Bm25Index;
  byId: Map<string, number>;
}

export function indexRoot(): string {
  return process.env.COPILOT_INDEX_DIR ?? path.join(process.cwd(), "index");
}

export async function writeIndex(root: string, manifest: Manifest, chunks: Chunk[], vectors: Float32Array[]): Promise<string> {
  if (!REPO_ID.test(manifest.id)) throw new Error(`Invalid repo id "${manifest.id}"`);
  const dir = path.join(root, manifest.id);
  await fs.mkdir(dir, { recursive: true });
  const flat = new Float32Array(chunks.length * manifest.dim);
  vectors.forEach((v, i) => flat.set(v, i * manifest.dim));
  await fs.writeFile(path.join(dir, "vectors.bin"), Buffer.from(flat.buffer));
  await fs.writeFile(path.join(dir, "chunks.json"), JSON.stringify(chunks));
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return dir;
}

export async function listManifests(root = indexRoot()): Promise<Manifest[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: Manifest[] = [];
  for (const name of entries.sort()) {
    if (!REPO_ID.test(name)) continue;
    try {
      out.push(JSON.parse(await fs.readFile(path.join(root, name, "manifest.json"), "utf8")) as Manifest);
    } catch {
      /* not an index directory */
    }
  }
  return out;
}

const cache = new Map<string, Promise<LoadedIndex>>();

/**
 * `repoId` may come from a request, so it is never joined into a path directly: it must be a
 * well-formed id AND one of the ids discovered on disk.
 */
export async function loadIndex(repoId: string, root = indexRoot()): Promise<LoadedIndex | null> {
  if (!REPO_ID.test(repoId)) return null;
  const known = await listManifests(root);
  const manifest = known.find((m) => m.id === repoId);
  if (!manifest) return null;
  const key = `${root}::${manifest.id}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const dir = path.join(root, manifest.id);
      const chunks = JSON.parse(await fs.readFile(path.join(dir, "chunks.json"), "utf8")) as Chunk[];
      const buf = await fs.readFile(path.join(dir, "vectors.bin"));
      const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      if (vectors.length !== chunks.length * manifest.dim) throw new Error(`Corrupt index "${manifest.id}"`);
      const bm25 = new Bm25Index(chunks.map((c) => ({ text: c.text, boosted: `${c.symbol ?? ""} ${c.parent ?? ""} ${c.file}` })));
      return { manifest, chunks, vectors, bm25, byId: new Map(chunks.map((c, i) => [c.id, i])) };
    })();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending;
}
