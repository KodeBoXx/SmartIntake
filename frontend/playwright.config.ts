import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/m5-playwright-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4215', trace: 'retain-on-failure' },
  webServer: { command: 'npm run start -- --port 4215', url: 'http://127.0.0.1:4215', reuseExistingServer: false, timeout: 120_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
