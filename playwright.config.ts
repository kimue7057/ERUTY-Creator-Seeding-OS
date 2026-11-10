import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", timeout: 60000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", viewport: { width: 1440, height: 1000 }, trace: "off" },
  reporter: "list",
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000",
    // Own the server so a reused development process cannot skip the provider fixture.
    url: "http://127.0.0.1:3000/login", reuseExistingServer: false, timeout: 120000,
    env: { NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${new URL("./tests/browser/meta-fetch-fixture.mjs", import.meta.url).href}`].filter(Boolean).join(" ") },
  },
});
