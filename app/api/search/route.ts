import { NextResponse } from "next/server";
import { search } from "@/src/core/retriever";
import { loadIndex } from "@/src/core/store";
import { enforceRateLimit, parseJson, PublicError, toErrorResponse } from "@/src/server/http";
import { SearchRequest } from "@/src/server/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    enforceRateLimit(req, "search", 40, 60_000);
    const body = await parseJson(req, SearchRequest);
    const index = await loadIndex(body.repo);
    if (!index) throw new PublicError(404, "Unknown repository.");
    const started = performance.now();
    const hits = await search(index, body.query, { mode: body.mode, rerank: body.rerank, k: body.k });
    // Explicit DTO: only fields the UI needs leave the server.
    return NextResponse.json({
      tookMs: Math.round(performance.now() - started),
      results: hits.map((h, i) => ({
        rank: i + 1,
        score: Number(h.score.toFixed(4)),
        ranks: h.ranks,
        id: h.chunk.id,
        file: h.chunk.file,
        startLine: h.chunk.startLine,
        endLine: h.chunk.endLine,
        symbol: h.chunk.symbol,
        parent: h.chunk.parent,
        kind: h.chunk.kind,
        language: h.chunk.language,
        text: h.chunk.text,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
