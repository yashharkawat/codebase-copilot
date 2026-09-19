import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { clientKey, rateLimit } from "./ratelimit";

const MAX_BODY_BYTES = 8 * 1024;

export class PublicError extends Error {
  constructor(public readonly status: number, message: string, public readonly headers: Record<string, string> = {}) {
    super(message);
  }
}

export function enforceRateLimit(req: Request, scope: string, max: number, windowMs: number): void {
  const res = rateLimit(`${scope}:${clientKey(req)}`, max, windowMs);
  if (!res.ok) {
    console.warn(JSON.stringify({ event: "rate_limited", scope })); // no IP, no query text
    throw new PublicError(429, `Too many requests. Try again in ${res.retryAfterSec}s.`, { "Retry-After": String(res.retryAfterSec) });
  }
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  if (!req.headers.get("content-type")?.includes("application/json")) throw new PublicError(415, "Send application/json.");
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new PublicError(413, "Request body too large.");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new PublicError(400, "Body is not valid JSON.");
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new PublicError(400, parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ").slice(0, 300));
  return parsed.data;
}

/** Clients get a safe message; the real error goes to the server log only. */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof PublicError) return NextResponse.json({ error: err.message }, { status: err.status, headers: err.headers });
  console.error("[copilot] unhandled:", err);
  return NextResponse.json({ error: "Internal error." }, { status: 500 });
}
