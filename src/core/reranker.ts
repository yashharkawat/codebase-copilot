import path from "node:path";

/** Cross-encoder: scores (query, passage) jointly, so it sees interactions a bi-encoder cannot. */
export const RERANK_MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";

type Scorer = (query: string, passages: string[]) => Promise<number[]>;
let scorerPromise: Promise<Scorer> | null = null;

async function getScorer(): Promise<Scorer> {
  if (!scorerPromise) {
    scorerPromise = (async () => {
      const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import("@huggingface/transformers");
      env.localModelPath = path.join(process.cwd(), "models");
      env.cacheDir = process.env.VERCEL ? "/tmp/hf-cache" : path.join(process.cwd(), ".cache", "hf");
      const tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL);
      const model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: "q8" });
      return async (query: string, passages: string[]) => {
        const scores: number[] = [];
        for (let i = 0; i < passages.length; i += 8) {
          const batch = passages.slice(i, i + 8);
          const inputs = tokenizer(new Array(batch.length).fill(query), { text_pair: batch, padding: true, truncation: true, max_length: 512 });
          const { logits } = await model(inputs);
          scores.push(...(Array.from(logits.data as Float32Array) as number[]));
        }
        return scores;
      };
    })().catch((err) => {
      scorerPromise = null;
      throw err;
    });
  }
  return scorerPromise;
}

export async function rerankScores(query: string, passages: string[]): Promise<number[]> {
  return (await getScorer())(query, passages);
}
