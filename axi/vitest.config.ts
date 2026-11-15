import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["development"], preserveSymlinks: true },
  test: { include: ["**/src/**/*.test.ts"] },
});
