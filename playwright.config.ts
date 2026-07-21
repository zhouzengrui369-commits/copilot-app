import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.OPENCLAW_WORKBENCH_URL || "http://127.0.0.1:38888",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "tablet", use: { channel: "chrome", viewport: { width: 1024, height: 768 } } },
    { name: "mobile", use: { channel: "chrome", isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 }, userAgent: devices["iPhone 15"].userAgent } },
  ],
});
