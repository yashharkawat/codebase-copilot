import { z } from "zod";
import { REPO_ID } from "../core/store";

const repo = z.string().regex(REPO_ID, "invalid repo id");
const query = z.string().trim().min(2, "query too short").max(500, "query too long");

export const SearchRequest = z.object({
  repo,
  query,
  mode: z.enum(["hybrid", "dense", "bm25"]).default("hybrid"),
  rerank: z.boolean().default(false),
  k: z.number().int().min(1).max(20).default(8),
});

export const AskRequest = z.object({ repo, query });

export type SearchRequest = z.infer<typeof SearchRequest>;
