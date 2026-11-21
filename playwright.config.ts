import { defineConfig } from '@playwright/test';

const dashboardPort = Number(process.env.RG_TEST_DASHBOARD_PORT ?? '3200');
const apiPort = process.env.RG_TEST_API_PORT ?? '4200';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 25_000,
  expect: { timeout: 10_000 },
  reporter: process.env.RG_TEST_REPORT_DIR
    ? [['line'], ['json', { outputFile: `${process.env.RG_TEST_REPORT_DIR}/playwright.json` }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${dashboardPort}`,
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: [
    {
      command: 'node src/api/main.ts',
      url: `http://127.0.0.1:${apiPort}/health`,
      env: { RELEASEGUARD_API_PORT: apiPort, RELEASEGUARD_POLICY: '' },
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `node node_modules/next/dist/bin/next dev dashboard --webpack --hostname 127.0.0.1 --port ${dashboardPort}`,
      url: `http://127.0.0.1:${dashboardPort}`,
      env: { NEXT_TELEMETRY_DISABLED: '1', RELEASEGUARD_API_PORT: apiPort },
      timeout: 90_000,
      reuseExistingServer: false,
    },
  ],
});
