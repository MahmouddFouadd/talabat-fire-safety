import { defineConfig, devices } from "@playwright/test";

const local = !process.env.CI; // the sandbox used during development has Chromium only
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 45_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:4173/", locale: "ar-EG", timezoneId: "Africa/Cairo",
    ...(process.env.PW_CHROMIUM ? { launchOptions: { executablePath: process.env.PW_CHROMIUM } } : {}) },
  webServer: { command: "npx vite preview --port 4173 --strictPort", port: 4173, reuseExistingServer: true },
  projects: [
    { name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "laptop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    { name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "android-pixel7", use: { ...devices["Pixel 7"] } },
    { name: "small-360", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 740 } } },
    ...(local ? [] : [
      { name: "iphone-14-safari", use: { ...devices["iPhone 14"] } },
      { name: "ipad-safari", use: { ...devices["iPad (gen 7)"] } },
    ]),
  ],
});
