import { describe, expect, it } from "vitest";
import { Bm25Index } from "../src/core/bm25";
import { findSymbols, findUsages, search } from "../src/core/retriever";
import { loadIndex, type LoadedIndex } from "../src/core/store";
import type { Chunk } from "../src/core/types";

const chunk = (id: string, symbol: string | null, text: string, startLine = 1): Chunk => ({ id, file: id.split("#")[0], language: "typescript", symbol, parent: null, kind: "function", startLine, endLine: startLine + text.split("\n").length - 1, text });

function fakeIndex(chunks: Chunk[]): LoadedIndex {
  return {
    manifest: { id: "t", name: "t", source: "", commit: null, chunker: "ast", model: "m", dim: 2, chunkCount: chunks.length, fileCount: 1, languages: {}, createdAt: "" },
    chunks,
    vectors: new Float32Array(chunks.length * 2),
    bm25: new Bm25Index(chunks.map((c) => ({ text: c.text, boosted: c.symbol ?? "" }))),
    byId: new Map(chunks.map((c, i) => [c.id, i])),
  };
}

describe("findUsages", () => {
  const index = fakeIndex([
    chunk("a.ts#10-12", "run", "const pool = createPool()\nconst x = createPoolSize\n// recreatePool()", 10),
    chunk("b.ts#1-1", "createPool", "export const createPool = () => {}"),
  ]);

  it("matches whole identifiers only and reports absolute line numbers", () => {
    const { total, items } = findUsages(index, "createPool", 10);
    expect(total).toBe(2);
    expect(items.map((u) => `${u.file}:${u.line}`)).toEqual(["a.ts:10", "b.ts:1"]);
  });

  it("paginates", () => {
    expect(findUsages(index, "createPool", 1, 1).items.map((u) => u.file)).toEqual(["b.ts"]);
  });

  it("treats regex metacharacters as plain text (no ReDoS surface)", () => {
    const started = performance.now();
    expect(findUsages(index, "(a+)+$", 10).total).toBe(0);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("findSymbols", () => {
  it("puts exact, case-insensitive matches before partial ones", () => {
    const index = fakeIndex([chunk("a.ts#1-1", "setCookieHeader", "x"), chunk("b.ts#1-1", "setCookie", "y")]);
    expect(findSymbols(index, "SETCOOKIE", 5).map((c) => c.symbol)).toEqual(["setCookie", "setCookieHeader"]);
  });
});

describe("search", () => {
  it("bm25 mode needs no embedding model and respects pathPrefix", async () => {
    const index = fakeIndex([chunk("src/a.ts#1-1", "signCookie", "sign the cookie"), chunk("lib/b.ts#1-1", "signCookie", "sign the cookie")]);
    const hits = await search(index, "sign cookie", { mode: "bm25", rerank: false, k: 5, pathPrefix: "lib" });
    expect(hits.map((h) => h.chunk.file)).toEqual(["lib/b.ts"]);
    expect(hits[0].ranks.bm25).toBe(1);
  });
});

describe("loadIndex", () => {
  it("rejects ids that are not well-formed or not on disk — no path is ever built from them", async () => {
    for (const id of ["../etc", "hono/../../x", "/abs", "", "A".repeat(80), "hono%2f.."]) expect(await loadIndex(id)).toBeNull();
    expect(await loadIndex("does-not-exist")).toBeNull();
  });
});
