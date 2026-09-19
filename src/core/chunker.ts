import path from "node:path";
import { createRequire } from "node:module";
import type Parser from "web-tree-sitter";
import { LANGUAGES, type LanguageSpec } from "./languages";
import type { Chunk, ChunkKind } from "./types";
import type { SourceFile } from "./walker";

/** Chunks above this are split: a class into its members, a function into windows. */
export const MAX_CHUNK_LINES = 80;
const WINDOW_LINES = 60;
const WINDOW_OVERLAP = 10;
/** Module-level leftovers smaller than this (imports, a stray const) are not worth a chunk. */
const MIN_MODULE_LINES = 4;

const require = createRequire(import.meta.url);
let parserReady: Promise<typeof Parser> | null = null;
const languageCache = new Map<string, Promise<Parser.Language>>();

async function getParserClass(): Promise<typeof Parser> {
  if (!parserReady) {
    parserReady = (async () => {
      const mod = (await import("web-tree-sitter")).default;
      await mod.init();
      return mod;
    })();
  }
  return parserReady;
}

async function loadLanguage(spec: LanguageSpec): Promise<Parser.Language> {
  let cached = languageCache.get(spec.id);
  if (!cached) {
    cached = (async () => {
      const P = await getParserClass();
      const wasmDir = path.dirname(require.resolve("tree-sitter-wasms/package.json"));
      return P.Language.load(path.join(wasmDir, "out", spec.wasm));
    })();
    languageCache.set(spec.id, cached);
  }
  return cached;
}

function makeChunk(file: SourceFile, lines: string[], start: number, end: number, kind: ChunkKind, symbol: string | null, parent: string | null): Chunk {
  return {
    id: `${file.file}#${start}-${end}`,
    file: file.file,
    language: file.language,
    symbol,
    parent,
    kind,
    startLine: start,
    endLine: end,
    text: lines.slice(start - 1, end).join("\n"),
  };
}

/** Fixed-size line windows. Used for the naive baseline, non-AST files and oversize functions. */
export function windowChunks(file: SourceFile, lines: string[], start: number, end: number, size: number, overlap: number, symbol: string | null = null, parent: string | null = null, kind: ChunkKind = "window"): Chunk[] {
  const out: Chunk[] = [];
  const step = Math.max(1, size - overlap);
  for (let s = start; s <= end; s += step) {
    const e = Math.min(end, s + size - 1);
    if (lines.slice(s - 1, e).some((l) => l.trim().length > 0)) out.push(makeChunk(file, lines, s, e, kind, symbol, parent));
    if (e === end) break;
  }
  return out;
}

/** Baseline: what most RAG tutorials do. No syntax awareness, no symbol names. */
export function chunkNaive(file: SourceFile): Chunk[] {
  const lines = file.content.split("\n");
  return windowChunks(file, lines, 1, lines.length, 50, 10);
}

function nodeName(node: Parser.SyntaxNode): string | null {
  const named = node.childForFieldName("name");
  if (named) return named.text;
  if (node.type === "impl_item") return node.childForFieldName("type")?.text ?? null;
  if (node.type === "type_declaration") return node.namedChildren[0]?.childForFieldName("name")?.text ?? null;
  return null;
}

/** `export const handler = async (c) => {...}` and friends: a variable holding a function or a long literal. */
function variableSymbol(node: Parser.SyntaxNode): { name: string; kind: ChunkKind } | null {
  // Class fields holding functions: `#cachedBody = (key) => {...}` is a method in everything but syntax.
  if (node.type === "public_field_definition" || node.type === "field_definition") {
    const name = node.childForFieldName("name") ?? node.childForFieldName("property");
    const value = node.childForFieldName("value");
    if (!name || !value || (value.type !== "arrow_function" && value.type !== "function_expression" && value.type !== "function")) return null;
    return { name: name.text, kind: "method" };
  }
  if (node.type !== "lexical_declaration" && node.type !== "variable_declaration") return null;
  const decl = node.namedChildren.find((c) => c.type === "variable_declarator");
  const name = decl?.childForFieldName("name");
  const value = decl?.childForFieldName("value");
  if (!decl || !name || !value || name.type !== "identifier") return null;
  const isFn = value.type === "arrow_function" || value.type === "function_expression" || value.type === "function";
  const span = node.endPosition.row - node.startPosition.row + 1;
  if (!isFn && span < MIN_MODULE_LINES) return null;
  return { name: name.text, kind: isFn ? "function" : "module" };
}

export async function chunkAst(file: SourceFile): Promise<Chunk[]> {
  const lines = file.content.split("\n");
  const spec = LANGUAGES[file.language];
  if (!file.ast || !spec) return windowChunks(file, lines, 1, lines.length, WINDOW_LINES, WINDOW_OVERLAP);

  const P = await getParserClass();
  const parser = new P();
  parser.setLanguage(await loadLanguage(spec));
  const tree = parser.parse(file.content);
  const chunks: Chunk[] = [];
  const covered: Array<[number, number]> = [];

  /** Pull doc comments and decorators that sit directly above a symbol into its chunk. */
  function leadingStart(node: Parser.SyntaxNode): number {
    let start = node.startPosition.row + 1;
    let prev = node.previousSibling;
    while (prev && (spec.commentNodes.includes(prev.type) || prev.type === "decorator") && prev.endPosition.row + 1 >= start - 1) {
      start = prev.startPosition.row + 1;
      prev = prev.previousSibling;
    }
    return start;
  }

  function emit(node: Parser.SyntaxNode, outer: Parser.SyntaxNode, kind: ChunkKind, symbol: string | null, parent: string | null): void {
    const start = leadingStart(outer);
    const end = outer.endPosition.row + 1;
    const span = end - start + 1;
    if (span <= MAX_CHUNK_LINES) {
      chunks.push(makeChunk(file, lines, start, end, kind, symbol, parent));
      covered.push([start, end]);
      return;
    }
    const isContainer = kind === "class" || kind === "interface";
    const before = chunks.length;
    if (isContainer) visitChildren(node, symbol ?? parent);
    if (isContainer && chunks.length > before) {
      // Keep the declaration head (signature, fields) so "what is class X" still resolves.
      const firstMember = Math.min(...chunks.slice(before).map((c) => c.startLine));
      if (firstMember - start >= 2) {
        chunks.push(makeChunk(file, lines, start, firstMember - 1, kind, symbol, parent));
        covered.push([start, firstMember - 1]);
      }
      return;
    }
    // A very long function: overlapping windows that all carry the symbol name.
    chunks.push(...windowChunks(file, lines, start, end, WINDOW_LINES, WINDOW_OVERLAP, symbol, parent, kind));
    covered.push([start, end]);
  }

  function visit(node: Parser.SyntaxNode, outer: Parser.SyntaxNode, parent: string | null): void {
    if (spec.transparentNodes.includes(node.type)) {
      for (const child of node.namedChildren) visit(child, node.parent === tree.rootNode || outer === node ? node : outer, parent);
      return;
    }
    const kind = spec.symbolNodes[node.type];
    if (kind) {
      emit(node, outer, kind, nodeName(node), parent);
      return;
    }
    const variable = variableSymbol(node);
    if (variable) {
      emit(node, outer, variable.kind, variable.name, parent);
      return;
    }
    if (spec.containerNodes.includes(node.type)) visitChildren(node, parent);
  }

  function visitChildren(node: Parser.SyntaxNode, parent: string | null): void {
    for (const child of node.namedChildren) {
      if (child.type === "class_body" || child.type === "declaration_list" || child.type === "block" || child.type === "interface_body") {
        visitChildren(child, parent);
      } else {
        visit(child, child, parent);
      }
    }
  }

  for (const child of tree.rootNode.namedChildren) visit(child, child, null);
  tree.delete();
  parser.delete();

  // Whatever no symbol claimed (config objects, route tables, top-level statements) becomes module chunks.
  covered.sort((a, b) => a[0] - b[0]);
  let cursor = 1;
  const gaps: Array<[number, number]> = [];
  for (const [s, e] of covered) {
    if (s > cursor) gaps.push([cursor, s - 1]);
    cursor = Math.max(cursor, e + 1);
  }
  if (cursor <= lines.length) gaps.push([cursor, lines.length]);
  for (const [s, e] of gaps) {
    const body = lines.slice(s - 1, e).filter((l) => {
      const t = l.trim();
      return t.length > 0 && !/^(import\b|export \* from|export \{[^}]*\} from|from\b.*\bimport\b|\/\/|\/\*|\*|#|use\b|package\b)/.test(t);
    });
    if (body.length < MIN_MODULE_LINES) continue;
    chunks.push(...windowChunks(file, lines, s, e, WINDOW_LINES, WINDOW_OVERLAP, null, null, "module"));
  }

  chunks.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  return mergeTinyDeclarations(file, lines, chunks);
}

const TINY_LINES = 8;
const MERGED_MAX_LINES = 40;
const DECLARATION_KINDS = new Set<ChunkKind>(["type", "interface", "enum"]);

/**
 * A file of thirty 2-line type aliases would otherwise become thirty near-empty vectors that
 * crowd real logic out of the top-k. Adjacent tiny declarations are folded into one chunk.
 */
function mergeTinyDeclarations(file: SourceFile, lines: string[], chunks: Chunk[]): Chunk[] {
  const out: Chunk[] = [];
  let run: Chunk[] = [];
  const flush = () => {
    if (run.length === 1) out.push(run[0]);
    else if (run.length > 1) {
      const names = run.map((c) => c.symbol).filter(Boolean) as string[];
      const label = names.slice(0, 6).join(", ") + (names.length > 6 ? ", …" : "");
      out.push(makeChunk(file, lines, run[0].startLine, run[run.length - 1].endLine, "type", label, null));
    }
    run = [];
  };
  for (const c of chunks) {
    const tiny = DECLARATION_KINDS.has(c.kind) && c.parent === null && c.endLine - c.startLine + 1 <= TINY_LINES;
    const prev = run[run.length - 1];
    const adjacent = prev && c.startLine - prev.endLine <= 2 && c.endLine - run[0].startLine + 1 <= MERGED_MAX_LINES;
    if (tiny && (!prev || adjacent)) run.push(c);
    else {
      flush();
      if (tiny) run.push(c);
      else out.push(c);
    }
  }
  flush();
  return out;
}
