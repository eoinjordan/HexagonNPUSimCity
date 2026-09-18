import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, expect } from '@playwright/test'
import { formatBoardMeasurement } from '../src/runtime/telemetry.ts'

const { values } = parseArgs({ options: {
  url: { type: 'string', default: 'http://127.0.0.1:4173/' },
  'gateway-url': { type: 'string' },
  only: { type: 'string' },
} })
const root = fileURLToPath(new URL('..', import.meta.url))
const media = join(root, 'docs/media')
const work = await mkdtemp(join(tmpdir(), 'hexagon-media-'))
const framesPerSecond = 8
const frameMilliseconds = 1000 / framesPerSecond
const clips = ['overview', 'tour', 'quantization', 'workloads']
if (values['gateway-url']) clips.push('qcs6490')
if (values.only) assert.ok(clips.includes(values.only), 'Unknown clip or missing --gateway-url for qcs6490')
const selected = values.only ? [values.only] : clips

function localUrl(value) {
  const url = new URL(value)
  assert.ok(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Use a local preview or SSH tunnel')
  assert.ok(!url.username && !url.password, 'Do not put credentials in recording URLs')
  return url
}

function execute(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command}: ${result.stderr}`)
  return result.stdout
}

function checkPixels(png) {
  const pixels = execute('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, encoding: null })
  const colors = new Set()
  for (let offset = 0; offset < pixels.length; offset += 96) colors.add(`${pixels[offset] >> 4},${pixels[offset + 1] >> 4},${pixels[offset + 2] >> 4}`)
  assert.ok(colors.size > 30, `Canvas appears blank: ${colors.size} sampled colors`)
  return createHash('sha256').update(png).digest('hex')
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
await mkdir(media, { recursive: true })
let manifest = { kind: 'browser-recorded-documentation-media', clips: {} }
try {
  manifest = JSON.parse(await readFile(join(media, 'recordings.json'), 'utf8'))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

try {
  for (const name of selected) {
    const directory = join(work, name)
    await mkdir(directory)
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`) })
    await page.clock.install({ time: new Date('2026-09-18T12:00:00Z') })
    await page.clock.pauseAt(new Date('2026-09-18T12:00:01Z'))
    const url = localUrl(name === 'qcs6490' ? values['gateway-url'] : values.url)
    if (name === 'qcs6490') url.searchParams.set('runtime', 'qcs6490')
    else url.searchParams.delete('runtime')
    await page.goto(url.href)
    await page.evaluate(() => document.fonts.ready)
    await page.clock.fastForward(100)
    await page.clock.fastForward(1100)
    await expect(page.locator('#boot')).toBeHidden()
    await expect(page.locator('#canvas-root canvas')).toHaveCount(1)
    for (let index = 0; index < 24; index += 1) await page.clock.fastForward(frameMilliseconds)
    const canvas = page.locator('#canvas-root canvas')
    const screenshotOptions = { style: '#hud, #boot, .label { visibility: hidden !important; }' }
    const firstCanvas = checkPixels(await canvas.screenshot(screenshotOptions))
    const evidence = []
    let frame = 0
    const capture = async count => {
      await page.mouse.move(2, 2)
      for (let index = 0; index < count; index += 1) {
        await page.clock.fastForward(frameMilliseconds)
        await page.screenshot({ path: join(directory, `frame-${String(frame).padStart(4, '0')}.png`) })
        frame += 1
      }
    }

    if (name === 'overview') {
      await capture(24)
      await page.getByRole('button', { name: 'Day / night (N)', exact: true }).click()
      await capture(24)
      await page.getByRole('button', { name: 'Day / night (N)', exact: true }).click()
      await capture(16)
    } else if (name === 'tour') {
      await page.getByRole('button', { name: 'Guided tour (T)', exact: true }).click()
      for (let step = 0; step < 6; step += 1) {
        if (step) await page.locator('#tour-layer').getByRole('button', { name: /Next/ }).click()
        await capture(24)
      }
    } else if (name === 'quantization') {
      for (const precision of ['INT4', 'INT8', 'INT16', 'FP16']) {
        await page.locator('#precision').selectOption(precision)
        await capture(20)
        await expect(page.locator('#hud-bottom')).toContainText(precision)
      }
    } else if (name === 'workloads') {
      for (const workload of ['llm-decode', 'vision-conv', 'idle']) {
        await page.locator('#workload').selectOption(workload)
        await capture(24)
      }
    } else {
      const status = page.locator('#runtime-panel .runtime-status').first()
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await expect(status).toContainText('vision: QNN HTP | LLM: CPU')
      await capture(12)
      for (const [workload, button] of [['vision-conv', 'Run vision sample'], ['llm-decode', 'Run CPU LLM sample'], ['idle', 'Confirm idle']]) {
        await page.getByRole('combobox', { name: 'Measured workload', exact: true }).selectOption(workload)
        const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/runtime/run' && response.request().method() === 'POST', { timeout: 150_000 })
        await page.getByRole('button', { name: button, exact: true }).click()
        const response = await pending
        assert.ok(response.ok(), `Gateway returned ${response.status()}`)
        const result = await response.json()
        const summary = formatBoardMeasurement(workload, result)
        await expect(status).toHaveText(summary)
        evidence.push({ workload, backend: result.backend, summary,
          acceleratorExecutionVerified: result.profile?.acceleratorExecutionVerified ?? result.acceleratorExecutionVerified ?? false,
          inferenceRequested: workload !== 'idle', artifacts: result.artifacts ?? null })
        await capture(32)
      }
    }
    const lastCanvas = checkPixels(await canvas.screenshot(screenshotOptions))
    assert.notEqual(firstCanvas, lastCanvas, `${name}: canvas did not change`)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows horizontally')
    assert.deepEqual(errors, [])
    const width = name === 'qcs6490' ? 1280 : 960
    const height = name === 'qcs6490' ? 800 : 600
    const encoded = join(directory, 'encoded.gif')
    execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(framesPerSecond), '-i', join(directory, 'frame-%04d.png'),
      '-filter_complex', `[0:v]scale=${width}:${height}:flags=lanczos,split[frames][colors];[colors]palettegen=max_colors=160[palette];[frames][palette]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop', '0', encoded])
    const optimized = join(directory, `${name}.gif`)
    execute('gifsicle', ['-O3', '--no-warnings', encoded, '-o', optimized])
    const stream = JSON.parse(execute('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames,duration', '-of', 'json', optimized])).streams[0]
    assert.equal(stream.width, width)
    assert.equal(stream.height, height)
    assert.equal(Number(stream.nb_read_frames), frame)
    assert.ok(Math.abs(Number(stream.duration) - frame / framesPerSecond) < 0.15)
    const bytes = (await stat(optimized)).size
    assert.ok(bytes < 8 * 1024 * 1024, `${name}: GIF exceeds 8 MiB`)
    const decoded = join(tmpdir(), `hexagon-${name}-preview.png`)
    execute('ffmpeg', ['-v', 'error', '-y', '-i', optimized, '-ss', String(frame / framesPerSecond / 2), '-frames:v', '1', decoded])
    const artifact = join(media, `${name}.gif`)
    await copyFile(optimized, `${artifact}.tmp`)
    await rename(`${artifact}.tmp`, artifact)
    manifest.clips[name] = { recordedAt: new Date().toISOString(), url: url.href, width, height, frames: frame, framesPerSecond,
      durationSeconds: Number(stream.duration), bytes, sha256: createHash('sha256').update(await readFile(artifact)).digest('hex'),
      scope: name === 'qcs6490' ? 'Real completed gateway requests. NPU vision, CPU language, no-dispatch idle. GIF playback is not request latency.' : 'Illustrative simulation only, not hardware performance.', evidence }
    console.log(JSON.stringify({ clip: name, ...manifest.clips[name], decodedFrame: decoded }, null, 2))
    await context.close()
  }
  await writeFile(join(media, 'recordings.json'), `${JSON.stringify(manifest, null, 2)}\n`)
} finally {
  await browser.close()
  await rm(work, { recursive: true, force: true })
}