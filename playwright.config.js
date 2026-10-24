import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: "ux.spec.js", // the interaction journeys run with playwright.ux.config.js (own port, mocked APIs, service worker blocked)
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8000",
    browserName: "chromium",
    ...devices["Pixel 5"],
    viewport: { width: 393, height: 851 },
    serviceWorkers: "allow"
  },
  webServer: {
    command: "python -m uvicorn main:app --host 127.0.0.1 --port 8000",
    url: "http://127.0.0.1:8000/health",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
