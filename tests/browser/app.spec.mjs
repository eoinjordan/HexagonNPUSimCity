import { test, expect } from '@playwright/test'
import { createHash } from 'node:crypto'

async function canvasHash(canvas) {
  return createHash('sha256').update(await canvas.screenshot({
    style: '#hud, #boot, .label { visibility: hidden !important; }',
  })).digest('hex')
}

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
  const occluded = await page.locator('#hud-top select, #hud-left button').evaluateAll((elements) => elements.filter((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return !hit || !element.contains(hit)
  }).map((element) => element.getAttribute('aria-label')))
  expect(occluded).toEqual([])
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
  const paused = await canvasHash(canvas)
  await page.clock.fastForward(400)
  expect(await canvasHash(canvas)).toEqual(paused)
  await page.keyboard.press('k')
  await page.clock.fastForward(400)
  expect(await canvasHash(canvas)).not.toEqual(paused)
})

test('toolbar is keyboard-operable and reduced motion leaves the scene stable', async ({ page }) => {
  await expect(page.locator('#hud-left').getByRole('button')).toHaveCount(7)
  const firstTool = page.locator('#hud-left').getByRole('button').first()
  await firstTool.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#tour-layer')).toHaveClass(/show/)
  await page.keyboard.press('Escape')
  await expect(page.locator('#tour-layer')).not.toHaveClass(/show/)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.fastForward(200)
  const canvas = page.locator('#canvas-root canvas')
  const still = await canvasHash(canvas)
  await page.clock.fastForward(400)
  expect(await canvasHash(canvas)).toEqual(still)
})

test('home camera keeps all compute district labels within the viewport', async ({ page }) => {
  const labels = page.locator('#stage .label').filter({ hasText: /scalar accelerator|HVX|HMX/i })
  await expect(labels).toHaveCount(3)
  const boxes = await labels.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { name: element.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
  }))
  const viewport = page.viewportSize()
  for (const box of boxes) {
    expect(box.left, `${box.name} left edge`).toBeGreaterThanOrEqual(0)
    expect(box.right, `${box.name} right edge`).toBeLessThanOrEqual(viewport.width)
    expect(box.top, `${box.name} top edge`).toBeGreaterThanOrEqual(0)
    expect(box.bottom, `${box.name} bottom edge`).toBeLessThanOrEqual(viewport.height)
  }
})

test('keyboard workload, reset, help and persisted theme work end to end', async ({ page }) => {
  await page.keyboard.press('3')
  await page.clock.fastForward(40)
  await expect(page.locator('#workload')).toHaveValue('idle')
  await page.locator('#precision').selectOption('FP16')
  await page.locator('#precision').blur()
  await page.keyboard.press('r')
  await page.clock.fastForward(40)
  await expect(page.locator('#workload')).toHaveValue('llm-decode')
  await expect(page.locator('#precision')).toHaveValue('INT8')
  await page.keyboard.press('?')
  await expect(page.locator('#help-overlay')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#help-overlay')).toBeHidden()
  const previousTheme = await page.locator('html').getAttribute('data-theme')
  await page.keyboard.press('n')
  const expectedTheme = previousTheme === 'night' ? 'day' : 'night'
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme)
  await page.reload()
  await expect(page.locator('#canvas-root canvas')).toHaveCount(1)
  await page.clock.fastForward(100)
  await page.clock.fastForward(1000)
  await expect(page.locator('#boot')).toBeHidden()
  await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme)
})

test('QCS6490 gateway keeps vision, CPU language and idle measurements distinct', async ({ page }, testInfo) => {
  const requests = []
  let invalidVision = false
  await page.route('**/api/runtime/**', async (route) => {
    const request = route.request()
    requests.push(request.method())
    if (request.method() === 'GET') {
      await route.fulfill({ json: { models: ['MobileNet', 'oddessy-vlm', 'No inference'], workloads: [
        { id: 'vision-conv', backend: 'qnn-htp', model: 'MobileNet' },
        { id: 'llm-decode', backend: 'cpu', model: 'oddessy-vlm' },
        { id: 'idle', backend: 'none', model: 'No inference' },
      ] } })
      return
    }
    const uploaded = request.url().endsWith('/vision')
    const workload = uploaded ? 'vision-conv' : request.postDataJSON().workload
    const result = workload === 'vision-conv'
      ? { backend: invalidVision ? 'cpu' : 'qnn-htp', cpuFallback: false, top5: [{ label: 'Fixture classification' }], profile: { executionMs: 7.39, acceleratorCycles: 4000, acceleratorExecutionVerified: true, convolutionOperators: [{ cycles: 1200 }] } }
      : workload === 'llm-decode'
        ? { backend: 'cpu', generatedTokens: 32, generationMs: 6400, acceleratorExecutionVerified: false }
        : { backend: 'none', inferenceRequested: false, busy: false }
    await route.fulfill({ json: { source: 'qcs6490', workload, ...result } })
  })
  await page.goto('./?runtime=qcs6490')
  await page.clock.fastForward(1100)
  const panel = page.locator('#runtime-panel')
  const status = panel.locator('.runtime-status').first()
  const workload = page.getByRole('combobox', { name: 'Measured workload', exact: true })
  await expect(panel).toHaveAttribute('open', '')
  expect(requests).toEqual([])
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(status).toContainText('vision: QNN HTP | LLM: CPU')
  await expect(page.getByRole('combobox', { name: 'Local model', exact: true })).toBeHidden()
  await page.getByRole('button', { name: 'Run vision sample', exact: true }).click()
  await expect(status).toContainText('NPU vision | Fixture classification | 7.390 ms')
  await page.clock.fastForward(40)
  await expect(page.locator('#workload')).toHaveValue('vision-conv')
  expect(requests.length).toBe(2)
  await workload.selectOption('llm-decode')
  await expect(page.getByLabel('Vision image (optional)', { exact: true })).toBeHidden()
  expect(requests.length).toBe(2)
  await page.getByRole('button', { name: 'Run CPU LLM sample', exact: true }).click()
  await expect(status).toContainText('CPU LLM | 5.00 tokens/s')
  await expect(status).toContainText('no NPU LLM support')
  await workload.selectOption('idle')
  await page.getByRole('button', { name: 'Confirm idle', exact: true }).click()
  await expect(status).toContainText('Idle | no inference dispatched')
  await page.clock.fastForward(40)
  await expect(page.locator('#workload')).toHaveValue('idle')
  await workload.selectOption('vision-conv')
  const image = page.getByLabel('Vision image (optional)', { exact: true })
  await image.setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64') })
  await page.getByRole('button', { name: 'Run vision sample', exact: true }).click()
  await expect(status).toContainText('NPU vision')
  await page.clock.fastForward(40)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const panelBounds = await panel.boundingBox()
  expect(panelBounds.x).toBeGreaterThanOrEqual(0)
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(page.viewportSize().width)
  await page.screenshot({ path: testInfo.outputPath('qcs6490-runtime.png') })
  invalidVision = true
  await page.getByRole('button', { name: 'Run vision sample', exact: true }).click()
  await expect(status).toHaveText('Vision result lacks valid HTP execution evidence')
  await expect(page.getByRole('button', { name: 'Run vision sample', exact: true })).toBeEnabled()
})