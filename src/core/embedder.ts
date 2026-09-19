import path from "node:path";

/**
 * Local embedding model (no external API, no key). Runs through ONNX Runtime via
 * transformers.js, both in the indexing CLI and inside the Vercel function.
 */
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIM = 384;
// bge models are trained with this instruction on the QUERY side only.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

type Extractor = (
  texts: string[],
  opts: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      const bundled = path.join(process.cwd(), "models");
      env.localModelPath = bundled;
      env.allowLocalModels = true;
      // Serverless file systems are read-only except /tmp.
      env.cacheDir = process.env.VERCEL ? "/tmp/hf-cache" : path.join(process.cwd(), ".cache", "hf");
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
      return pipe as unknown as Extractor;
    })().catch((err) => {
      extractorPromise = null;
      throw err;
    });
  }
  return extractorPromise;
}

export async function embedPassages(texts: string[], batchSize = 16): Promise<Float32Array[]> {
  const extractor = await getExtractor();
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await extractor(batch, { pooling: "cls", normalize: true });
    for (let j = 0; j < batch.length; j++) {
      out.push(res.data.slice(j * EMBEDDING_DIM, (j + 1) * EMBEDDING_DIM));
    }
  }
  return out;
}

export async function embedQuery(query: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const res = await extractor([QUERY_PREFIX + query], { pooling: "cls", normalize: true });
  return res.data.slice(0, EMBEDDING_DIM);
}
