import { defineConfig, devices } from '@playwright/test';
const apiPort=process.env.TEST_API_PORT??'8787';
const webPort=process.env.TEST_WEB_PORT??'5173';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,timeout:45000,retries:0,
  use:{baseURL:`http://127.0.0.1:${webPort}`,trace:'retain-on-failure'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'iphone',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}},{name:'ipad',use:{...devices['iPad (gen 7)'],defaultBrowserType:'chromium'}}],
  webServer:[{command:'npx tsx tests/test-server.ts',url:`http://127.0.0.1:${apiPort}/api/me`,reuseExistingServer:false,timeout:60000},{command:`npm run dev -- --port ${webPort} --strictPort`,url:`http://127.0.0.1:${webPort}`,reuseExistingServer:false,timeout:60000}]
});
