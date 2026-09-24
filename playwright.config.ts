import { defineConfig } from "@playwright/test";
const baseURL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:8087";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 12000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run server",
    env: { ADDR: new URL(baseURL).host },
    url: baseURL + "/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
