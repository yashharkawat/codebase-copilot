import { NextResponse } from "next/server";
import { listManifests } from "@/src/core/store";
import { llmConfigured } from "@/src/server/llm";

export const runtime = "nodejs";

export async function GET() {
  const repos = (await listManifests()).map((m) => ({ id: m.id, name: m.name, source: m.source, commit: m.commit, files: m.fileCount, chunks: m.chunkCount, languages: m.languages, model: m.model }));
  return NextResponse.json({ repos, answersEnabled: llmConfigured() });
}
