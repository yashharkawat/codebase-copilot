export interface LanguageSpec {
  id: string;
  wasm: string;
  /** Node types emitted as their own chunk */
  symbolNodes: Record<string, "function" | "method" | "class" | "interface" | "type" | "enum">;
  /** Node types whose children are searched for nested symbols when the node is too large */
  containerNodes: string[];
  /** Wrappers to look through (export statements, decorators) */
  transparentNodes: string[];
  commentNodes: string[];
}

const tsLike = (id: string, wasm: string): LanguageSpec => ({
  id,
  wasm,
  symbolNodes: {
    function_declaration: "function",
    generator_function_declaration: "function",
    method_definition: "method",
    class_declaration: "class",
    abstract_class_declaration: "class",
    interface_declaration: "interface",
    type_alias_declaration: "type",
    enum_declaration: "enum",
  },
  containerNodes: ["class_declaration", "abstract_class_declaration", "class_body", "internal_module", "module", "statement_block"],
  transparentNodes: ["export_statement", "ambient_declaration"],
  commentNodes: ["comment"],
});

export const LANGUAGES: Record<string, LanguageSpec> = {
  typescript: tsLike("typescript", "tree-sitter-typescript.wasm"),
  tsx: tsLike("tsx", "tree-sitter-tsx.wasm"),
  javascript: tsLike("javascript", "tree-sitter-javascript.wasm"),
  python: {
    id: "python",
    wasm: "tree-sitter-python.wasm",
    symbolNodes: { function_definition: "function", class_definition: "class" },
    containerNodes: ["class_definition", "block"],
    transparentNodes: ["decorated_definition"],
    commentNodes: ["comment"],
  },
  go: {
    id: "go",
    wasm: "tree-sitter-go.wasm",
    symbolNodes: { function_declaration: "function", method_declaration: "method", type_declaration: "type" },
    containerNodes: [],
    transparentNodes: [],
    commentNodes: ["comment"],
  },
  rust: {
    id: "rust",
    wasm: "tree-sitter-rust.wasm",
    symbolNodes: {
      function_item: "function",
      struct_item: "class",
      enum_item: "enum",
      trait_item: "interface",
      impl_item: "class",
      type_item: "type",
    },
    containerNodes: ["impl_item", "trait_item", "declaration_list", "mod_item"],
    transparentNodes: [],
    commentNodes: ["line_comment", "block_comment"],
  },
  java: {
    id: "java",
    wasm: "tree-sitter-java.wasm",
    symbolNodes: {
      class_declaration: "class",
      interface_declaration: "interface",
      enum_declaration: "enum",
      method_declaration: "method",
      constructor_declaration: "method",
    },
    containerNodes: ["class_declaration", "class_body", "interface_declaration", "interface_body"],
    transparentNodes: [],
    commentNodes: ["line_comment", "block_comment"],
  },
};

const EXTENSIONS: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
};

/** Plain-text files that are still worth indexing with the window chunker. */
const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cs", ".kt", ".swift", ".sql", ".sh", ".yaml", ".yml", ".toml"]);

export function languageForFile(file: string): { language: string; ast: boolean } | null {
  const dot = file.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = file.slice(dot).toLowerCase();
  if (EXTENSIONS[ext]) return { language: EXTENSIONS[ext], ast: true };
  if (TEXT_EXTENSIONS.has(ext)) return { language: ext.slice(1), ast: false };
  return null;
}
