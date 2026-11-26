import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Shared types are imported from ../scanner/src.
  server: { fs: { allow: [".."] } },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
