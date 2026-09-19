import { NextResponse } from "next/server";
import { embedQuery } from "@/src/core/embedder";
import { toErrorResponse } from "@/src/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Also warms the embedding model, so the first real search is fast. */
export async function GET() {
  try {
    const started = Date.now();
    await embedQuery("warm up");
    return NextResponse.json({ ok: true, embedMs: Date.now() - started });
  } catch (err) {
    return toErrorResponse(err);
  }
}
