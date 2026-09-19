import fs from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { languageForFile } from "./languages";

export interface WalkOptions {
  /** Only index files under these repo-relative prefixes (e.g. ["src"]) */
  include?: string[];
  includeTests?: boolean;
  maxFileBytes?: number;
}

export interface SourceFile {
  /** Repo-relative POSIX path */
  file: string;
  language: string;
  ast: boolean;
  content: string;
}

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", ".next", ".vercel", "coverage", "vendor",
  "target", "__pycache__", ".venv", "venv", ".idea", ".vscode", ".cache", "tmp",
]);

/** Never index these, even if the repo forgot to git-ignore them. */
const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml))$/i;
const GENERATED_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.min\.(js|css)|.*\.d\.ts|.*\.map)$/i;
const TEST_FILE = /(\.(test|spec)\.[a-z]+$)|(^|\/)(__tests__|__mocks__|tests?|fixtures?)\//i;

/** High-confidence credential patterns. A file containing one is skipped entirely. */
const SECRET_CONTENT = [
  /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, // GitHub token
  /\bsk-(ant-|or-v1-|proj-)?[A-Za-z0-9_-]{32,}\b/, // OpenAI / Anthropic / OpenRouter keys
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/, // Slack
];

export function containsSecret(content: string): boolean {
  return SECRET_CONTENT.some((re) => re.test(content));
}

export function isIndexablePath(rel: string, opts: WalkOptions = {}): boolean {
  if (SECRET_FILE.test(rel) || GENERATED_FILE.test(rel)) return false;
  if (!opts.includeTests && TEST_FILE.test(rel)) return false;
  if (opts.include?.length && !opts.include.some((p) => rel === p || rel.startsWith(p.replace(/\/$/, "") + "/"))) return false;
  return languageForFile(rel) !== null;
}

export async function walkRepo(root: string, opts: WalkOptions = {}): Promise<{ files: SourceFile[]; skippedSecrets: string[] }> {
  const maxBytes = opts.maxFileBytes ?? 256 * 1024;
  const ig: Ignore = ignore();
  try {
    ig.add(await fs.readFile(path.join(root, ".gitignore"), "utf8"));
  } catch {
    /* no .gitignore */
  }

  const files: SourceFile[] = [];
  const skippedSecrets: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (entry.isSymbolicLink()) continue; // never follow links out of the repo
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || ig.ignores(rel + "/")) continue;
        await visit(abs);
        continue;
      }
      if (!entry.isFile() || ig.ignores(rel) || !isIndexablePath(rel, opts)) continue;
      const stat = await fs.stat(abs);
      if (stat.size === 0 || stat.size > maxBytes) continue;
      const content = await fs.readFile(abs, "utf8");
      if (content.includes("\u0000")) continue; // binary
      if (containsSecret(content)) {
        skippedSecrets.push(rel);
        continue;
      }
      const lang = languageForFile(rel)!;
      files.push({ file: rel, language: lang.language, ast: lang.ast, content });
    }
  }

  await visit(root);
  return { files, skippedSecrets };
}
