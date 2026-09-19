import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { containsSecret, isIndexablePath, walkRepo } from "../src/core/walker";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-walk-"));
  const write = async (rel: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  };
  await write(".gitignore", "generated/\n");
  await write("src/app.ts", "export const a = 1;\n");
  await write("src/app.test.ts", "test('x', () => {});\n");
  await write("src/leaky.ts", `const key = "AKIA${"A".repeat(16)}";\n`);
  await write(".env", "SECRET=1\n");
  await write("config/secrets.json", "{}\n");
  await write("generated/out.ts", "export {};\n");
  await write("node_modules/pkg/index.js", "module.exports = 1;\n");
  await fs.symlink("/etc", path.join(root, "src", "escape"));
});

afterAll(() => fs.rm(root, { recursive: true, force: true }));

describe("walker", () => {
  it("indexes source, and skips tests, ignored dirs, dependencies, secrets and symlinks", async () => {
    const { files, skippedSecrets } = await walkRepo(root);
    expect(files.map((f) => f.file)).toEqual(["src/app.ts"]);
    expect(skippedSecrets).toEqual(["src/leaky.ts"]);
  });

  it("can include tests and restrict to a prefix", async () => {
    const { files } = await walkRepo(root, { includeTests: true, include: ["src"] });
    expect(files.map((f) => f.file).sort()).toEqual(["src/app.test.ts", "src/app.ts"]);
  });

  it("never treats credential files as indexable", () => {
    for (const p of [".env", ".env.production", "deploy/id_rsa", "certs/server.pem", "a/credentials.json", ".npmrc"]) expect(isIndexablePath(p)).toBe(false);
    expect(isIndexablePath("src/env.ts")).toBe(true);
  });

  it("detects high-confidence credential patterns", () => {
    expect(containsSecret("-----BEGIN RSA PRIVATE KEY-----")).toBe(true);
    expect(containsSecret(`token = "ghp_${"a".repeat(36)}"`)).toBe(true);
    expect(containsSecret("const skeleton = 'sk-short'")).toBe(false);
  });
});
