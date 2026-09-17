import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  await page.goto('tests/fixtures/scene.html')
  await page.waitForFunction(() => Boolean(window.engineTest))
  expect(errors).toEqual([])
  page.integrationErrors = errors
})

test.afterEach(async ({ page }) => {
  expect(page.integrationErrors).toEqual([])
})

test('renderer creates a nonblank correctly sized WebGL canvas under a project base', async ({ page }, testInfo) => {
  const pixels = await page.evaluate(() => window.engineTest.signature())
  const info = await page.evaluate(() => window.engineTest.rendererInfo())
  const viewport = page.viewportSize()
  expect(pixels.error).toBe(0)
  expect(pixels.colors).toBeGreaterThan(50)
  expect(pixels.width).toBe(viewport.width * info.ratio)
  expect(pixels.height).toBe(viewport.height * info.ratio)
  expect(info.ratio).toBeLessThanOrEqual(2)
  expect(info).toMatchObject({ srgb: true, filmic: true, shadows: true, filteredShadows: true, exposure: 1.1 })
  expect(info.calls).toBeGreaterThan(0)
  await expect(page.locator('#labels-root .label')).toHaveCount(8)
  await page.screenshot({ path: testInfo.outputPath('scene.png') })
})

test('simulation advances visible pixels, pauses without drift and resumes without new geometry', async ({ page }) => {
  const before = await page.evaluate(() => ({ pixels: window.engineTest.signature(), info: window.engineTest.rendererInfo() }))
  await page.evaluate(() => window.engineTest.step(60))
  const running = await page.evaluate(() => window.engineTest.signature())
  expect(running.hash).not.toBe(before.pixels.hash)
  await page.evaluate(() => window.engineTest.pause())
  const paused = await page.evaluate(() => ({ pixels: window.engineTest.signature(), state: window.engineTest.state() }))
  await page.evaluate(() => window.engineTest.step(120))
  expect(await page.evaluate(() => window.engineTest.signature())).toEqual(paused.pixels)
  expect(await page.evaluate(() => window.engineTest.state())).toEqual(paused.state)
  await page.evaluate(() => { window.engineTest.pause(); window.engineTest.step(60) })
  expect((await page.evaluate(() => window.engineTest.signature())).hash).not.toBe(paused.pixels.hash)
  expect((await page.evaluate(() => window.engineTest.rendererInfo())).geometries).toBe(before.info.geometries)
})

test('real pointer input selects a district and orbit dragging does not select', async ({ page }, testInfo) => {
  const point = await page.evaluate(() => window.engineTest.project('tensor'))
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(point.x, point.y)
  else await page.mouse.click(point.x, point.y)
  expect(await page.evaluate(() => window.engineTest.selection())).toBe('tensor')
  await page.evaluate(() => window.engineTest.clearSelection())
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 40, point.y + 20, { steps: 5 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.engineTest.selection())).toBeNull()
})

test('resize updates the drawing buffer and renderer resources can be released', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await expect(page.locator('canvas')).toHaveCSS('width', '800px')
  const pixels = await page.evaluate(() => window.engineTest.signature())
  const ratio = (await page.evaluate(() => window.engineTest.rendererInfo())).ratio
  expect(pixels.width).toBe(800 * ratio)
  expect(pixels.height).toBe(600 * ratio)
  expect(pixels.colors).toBeGreaterThan(50)
  expect(await page.evaluate(() => window.engineTest.dispose())).toBeGreaterThan(0)
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.locator('#labels-root .label')).toHaveCount(0)
})