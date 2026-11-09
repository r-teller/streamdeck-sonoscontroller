import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/playwright',
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173/plugin.html",
    reuseExistingServer: true,
  },
  use: {
    screenshot: 'on',
    baseURL: 'http://localhost:4173',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
