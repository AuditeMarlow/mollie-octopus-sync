import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests are colocated as `*.test.ts` next to the source file. Pure functions
// only — no jsdom needed (component tests aren't in scope yet).
//
// The alias swaps `@tauri-apps/plugin-http` for a stub at test time. Our
// source modules import `fetch` from that package at the top level, but the
// pure functions under test don't call it. The stub lets the imports resolve
// in a Node environment.
export default defineConfig({
  resolve: {
    alias: {
      "@tauri-apps/plugin-http": fileURLToPath(
        new URL("./tests/stubs/tauri-plugin-http.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
