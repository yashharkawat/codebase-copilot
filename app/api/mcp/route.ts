import { createMcpHandler } from "mcp-handler";
import { registerCopilotTools, SERVER_INFO } from "@/src/mcp/tools";
import { enforceRateLimit, toErrorResponse } from "@/src/server/http";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Remote MCP endpoint (Streamable HTTP, stateless). Same tools as the stdio server. */
const mcp = createMcpHandler((server) => registerCopilotTools(server), { serverInfo: SERVER_INFO });

async function handler(req: Request): Promise<Response> {
  try {
    enforceRateLimit(req, "mcp", 60, 60_000);
  } catch (err) {
    return toErrorResponse(err);
  }
  return mcp(req);
}

export { handler as GET, handler as POST, handler as DELETE };
