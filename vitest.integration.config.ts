import path from "node:path";
import { defineConfig } from "vitest/config";

// HTTP integration tests (*.integration.test.ts) require a local Supabase
// stack and a running Astro server -- see
// src/lib/test-support/integration-client.ts's header comment. Kept out of
// the default `npm run test` / vitest.config.ts include so plain unit tests
// stay infra-free; run these via `npm run test:integration`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
  },
});
