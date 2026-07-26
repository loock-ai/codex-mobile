import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 130_000,
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4173/api/status",
    timeout: 20_000,
    reuseExistingServer: false,
  },
});
