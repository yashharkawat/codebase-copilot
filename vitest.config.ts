import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000 },
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
});
