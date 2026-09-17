import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  page.integrationErrors = errors
  await page.clock.install({ time: new Date('2026-09-17T12:00:00Z') })
  await page.clock.pauseAt(new Date('2026-09-17T12:00:01Z'))
  await page.goto('./')
  await expect(page.locator('#canvas-root canvas')).toHaveCount(1)
  await page.clock.fastForward(100)
  await page.clock.fastForward(1000)
  await expect(page.locator('#boot')).toBeHidden()
})

test.afterEach(async ({ page }) => {
  expect(page.integrationErrors).toEqual([])
})

test('production build boots under a Pages subdirectory with usable controls and no horizontal overflow', async ({ page }, testInfo) => {
  await expect(page.locator('#hud-top select')).toHaveCount(2)
  expect(await page.locator('body').innerText()).toMatch(/illustrative/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const overflow = await page.locator('button, select').evaluateAll((elements) => elements.filter((element) => {
    if (!element.getClientRects().length) return false
    const rect = element.getBoundingClientRect()
    return rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1
  }).map((element) => element.getAttribute('aria-label') || element.textContent))
  expect(overflow).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('app.png') })
})

test('production controls change workload and precision and keyboard pause freezes the scene', async ({ page }) => {
  await page.locator('#hud-top select').nth(0).selectOption('vision-conv')
  await page.locator('#hud-top select').nth(1).selectOption('INT4')
  await page.clock.fastForward(300)
  await expect(page.locator('#hud-bottom')).toContainText('INT4')
  await expect(page.locator('#hud-bottom')).toContainText('Vision / conv')
  await page.locator('#hud-top select').nth(1).blur()
  await page.keyboard.press('k')
  await page.clock.fastForward(100)
  const canvas = page.locator('#canvas-root canvas')
  const paused = await canvas.screenshot()
  await page.clock.fastForward(400)
  expect(await canvas.screenshot()).toEqual(paused)
  await page.keyboard.press('k')
  await page.clock.fastForward(400)
  expect(await canvas.screenshot()).not.toEqual(paused)
})

test('toolbar is keyboard-operable and reduced motion leaves the scene stable', async ({ page }) => {
  await expect(page.locator('#hud-left').getByRole('button')).toHaveCount(5)
  const firstTool = page.locator('#hud-left').getByRole('button').first()
  await firstTool.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#tour-layer')).toHaveClass(/show/)
  await page.keyboard.press('Escape')
  await expect(page.locator('#tour-layer')).not.toHaveClass(/show/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.fastForward(200)
  const canvas = page.locator('#canvas-root canvas')
  const still = await canvas.screenshot()
  await page.clock.fastForward(400)
  expect(await canvas.screenshot()).toEqual(still)
})