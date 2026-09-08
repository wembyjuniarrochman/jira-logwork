import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Tanpa ini Svelte 5 me-resolve ke build server-nya, dan `mount()` —
    // yang dipakai @testing-library/svelte — melempar
    // "lifecycle_function_unavailable". Tes store murni tidak terpengaruh
    // karena tidak pernah me-mount komponen, jadi kekurangannya baru
    // terlihat saat tes komponen pertama ditulis.
    conditions: ["browser"],
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,js}"],
    passWithNoTests: true,
  },
});
