import { describe, expect, it } from "vitest";
import { chunkAst, chunkNaive, MAX_CHUNK_LINES } from "../src/core/chunker";
import type { SourceFile } from "../src/core/walker";

const file = (content: string, name = "src/a.ts", language = "typescript"): SourceFile => ({ file: name, language, ast: true, content });
const body = (n: number) => Array.from({ length: n }, (_, i) => `    const v${i} = ${i};`).join("\n");

describe("AST chunker", () => {
  it("emits one chunk per top-level symbol and attaches the doc comment", async () => {
    const chunks = await chunkAst(file(`import x from "y";\n\n/** Adds. */\nexport function add(a: number, b: number) {\n  return a + b;\n}\n\nexport const sub = (a: number, b: number) => a - b;\n`));
    expect(chunks.map((c) => [c.symbol, c.kind, c.startLine])).toEqual([["add", "function", 3], ["sub", "function", 8]]);
    expect(chunks[0].text).toContain("/** Adds. */");
  });

  it("splits a large class into methods that remember their parent", async () => {
    const src = `export class Big {\n  private n = 0;\n\n  first() {\n${body(50)}\n  }\n\n  #cached = (key: string) => {\n${body(45)}\n  };\n}\n`;
    const chunks = await chunkAst(file(src));
    const methods = chunks.filter((c) => c.kind === "method");
    expect(methods.map((c) => c.symbol)).toEqual(["first", "#cached"]); // class-field arrow functions count as methods
    expect(methods.every((c) => c.parent === "Big")).toBe(true);
    expect(chunks.some((c) => c.kind === "class" && c.symbol === "Big")).toBe(true); // declaration head kept
    expect(Math.max(...chunks.map((c) => c.endLine - c.startLine + 1))).toBeLessThanOrEqual(MAX_CHUNK_LINES);
  });

  it("windows an oversized function but keeps its name on every window", async () => {
    const chunks = await chunkAst(file(`export function huge() {\n${body(200)}\n}\n`));
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.symbol === "huge")).toBe(true);
  });

  it("merges runs of tiny type aliases into one chunk", async () => {
    const chunks = await chunkAst(file(`export type A = string;\nexport type B = number;\nexport type C = boolean;\nexport interface D { x: 1 }\n`));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].symbol).toBe("A, B, C, D");
  });

  it("handles Python", async () => {
    const chunks = await chunkAst(file(`import os\n\n@decorator\ndef handler(event):\n    return event\n\nclass Repo:\n    def get(self, id):\n        return id\n`, "app.py", "python"));
    expect(chunks.map((c) => c.symbol)).toEqual(["handler", "Repo"]);
    expect(chunks[0].text.startsWith("@decorator")).toBe(true);
  });

  it("produces stable ids of the form file#start-end", async () => {
    const [c] = await chunkAst(file(`export function f() {\n  return 1;\n}\n`));
    expect(c.id).toBe("src/a.ts#1-3");
  });
});

describe("naive baseline", () => {
  it("cuts fixed windows with overlap and no symbol names", () => {
    const chunks = chunkNaive(file(Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n")));
    expect(chunks.map((c) => [c.startLine, c.endLine])).toEqual([[1, 50], [41, 90], [81, 120]]);
    expect(chunks.every((c) => c.symbol === null)).toBe(true);
  });
});
