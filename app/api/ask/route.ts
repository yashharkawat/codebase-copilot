import { search } from "@/src/core/retriever";
import { loadIndex } from "@/src/core/store";
import { enforceRateLimit, parseJson, PublicError, toErrorResponse } from "@/src/server/http";
import { llmConfigured, streamAnswer } from "@/src/server/llm";
import { rateLimit } from "@/src/server/ratelimit";
import { AskRequest } from "@/src/server/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAILY_LLM_BUDGET = Number(process.env.COPILOT_DAILY_LLM_BUDGET ?? 30);

export async function POST(req: Request) {
  try {
    enforceRateLimit(req, "ask", 5, 60_000);
    const body = await parseJson(req, AskRequest);
    if (!llmConfigured()) throw new PublicError(503, "Generated answers are not enabled on this deployment. Retrieval results above are unaffected.");
    if (!rateLimit("ask:global", DAILY_LLM_BUDGET, 86_400_000).ok) throw new PublicError(429, "Daily answer budget reached. Retrieval still works.");
    const index = await loadIndex(body.repo);
    if (!index) throw new PublicError(404, "Unknown repository.");
    const hits = await search(index, body.query, { mode: "hybrid", rerank: false, k: 6 });
    const stream = await streamAnswer(body.query, hits).catch(() => {
      throw new PublicError(503, "The free LLM providers are busy right now. Retrieval results are unaffected.");
    });
    return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
