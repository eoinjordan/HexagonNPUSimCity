import { defineConfig } from '@playwright/test'

const app = process.env.TEST_APP === '1'
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4179)
const base = '/__pages_test__/'
const baseURL = `http://127.0.0.1:${port}${base}`

export default defineConfig({
  testDir: './tests/browser',
  testMatch: app ? 'app.spec.mjs' : 'engine.spec.mjs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run ${app ? 'preview' : 'dev'} -- --host 127.0.0.1 --port ${port} --strictPort --base ${base}`,
    url: app ? baseURL : `${baseURL}tests/fixtures/scene.html`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
})