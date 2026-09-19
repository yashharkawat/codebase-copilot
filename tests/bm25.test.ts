import { describe, expect, it } from "vitest";
import { Bm25Index, tokenize } from "../src/core/bm25";

describe("code-aware tokenizer", () => {
  it("splits camelCase, snake_case and acronyms, and keeps the whole identifier", () => {
    expect(tokenize("getCookieValue")).toEqual(expect.arrayContaining(["getcookievalue", "get", "cookie", "value"]));
    expect(tokenize("parse_signed_cookie")).toEqual(expect.arrayContaining(["parse", "sign", "cookie"]));
    expect(tokenize("HTTPException")).toEqual(expect.arrayContaining(["http", "exception"]));
  });

  it("drops question words from queries only", () => {
    expect(tokenize("where is the router", true)).toEqual(["router"]);
    expect(tokenize("where is the router")).toContain("where");
  });
});

describe("BM25", () => {
  const index = new Bm25Index([
    { text: "export const setCookie = (c, name, value) => {}", boosted: "setCookie src/helper/cookie.ts" },
    { text: "class TrieRouter { add(method, path) {} match(method, path) {} }", boosted: "TrieRouter src/router/trie.ts" },
    { text: "const cookieJar = parse(header)", boosted: "src/utils/misc.ts" },
  ]);

  it("ranks the symbol-name match above a body-only match", () => {
    expect(index.search("set cookie", 3).map(([i]) => i)).toEqual([0, 2]);
  });

  it("honours the allow filter and returns nothing for unknown terms", () => {
    expect(index.search("cookie", 3, (i) => i !== 0).map(([i]) => i)).toEqual([2]);
    expect(index.search("zzzz", 3)).toEqual([]);
  });
});
