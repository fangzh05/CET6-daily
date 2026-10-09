import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:45000,retries:0,
  use:{baseURL:'http://127.0.0.1:5173',trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'iphone',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},{name:'ipad',use:{...devices['iPad (gen 7)'],defaultBrowserType:'chromium'}}],
  webServer:[{command:'npx tsx tests/test-server.ts',url:'http://127.0.0.1:8787/api/me',reuseExistingServer:false,timeout:60000},{command:'npm run dev -- --port 5173 --strictPort',url:'http://127.0.0.1:5173',reuseExistingServer:false,timeout:60000}]
});
