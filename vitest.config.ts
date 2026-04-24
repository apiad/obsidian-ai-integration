import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      // Redirect `import ... from "obsidian"` to our in-memory fake so
      // plugin-side code can be exercised without a live Obsidian runtime.
      obsidian: path.resolve(__dirname, "src/testing/fake-vault.ts"),
    },
  },
});
