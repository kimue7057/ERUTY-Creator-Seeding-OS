import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser", timeout: 60000, workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", viewport: { width: 1440, height: 1000 }, trace: "off" },
  reporter: "list",
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/login", reuseExistingServer: !process.env.CI, timeout: 120000,
  },
});
