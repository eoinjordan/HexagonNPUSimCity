import type { Bus } from '../core/bus'
import type { Precision, Sim, WorkloadId, WorkloadProfile } from '../core/types'
import { DEFAULT_SIM_CONFIG, PRECISIONS, WORKLOADS } from '../sim/model'
import { clear, el } from './dom'
import '../styles/settings.css'

export interface Settings {
  toggle(): void
  close(): void
  readonly open: boolean
}

/** Illustrative ONNX opset versions offered in the drawer (display/config only). */
const OPSET_CHOICES = [9, 11, 13, 15, 17, 19, 21, 22]

/**
 * A deliberately understated config drawer behind the toolbar cog. It edits the
 * model's *illustrative* figures live so you can see what changing them does to
 * the NPU and the readouts. The defaults are untouched — "Restore defaults"
 * always returns to the reviewed values in docs/verification.md.
 */
export function createSettings(bus: Bus, sim: Sim): Settings {
  let open = false
  const drawer = el('aside', {
    id: 'settings-drawer',
    class: 'settings-drawer',
    role: 'dialog',
    'aria-label': 'Configuration — illustrative figures',
    'aria-hidden': 'true',
  })
  document.body.append(drawer)

  function setPeak(p: Precision, v: number): void {
    const peakTops: Partial<Record<Precision, number>> = {}
    peakTops[p] = v
    sim.configure({ peakTops })
  }
  function setTokenCeil(p: Precision, v: number): void {
    const tokenCeil: Partial<Record<Precision, number>> = {}
    tokenCeil[p] = v
    sim.configure({ tokenCeil })
  }
  function setProfile(id: WorkloadId, profile: Partial<WorkloadProfile>): void {
    const workloads: Partial<Record<WorkloadId, Partial<WorkloadProfile>>> = {}
    workloads[id] = profile
    sim.configure({ workloads })
  }

  function numberRow(
    label: string,
    value: number,
    opts: { min: number; max: number; step: number },
    onChange: (v: number) => void,
  ): HTMLElement {
    const input = el('input', {
      type: 'number', value: String(value), min: String(opts.min), max: String(opts.max), step: String(opts.step), 'aria-label': label,
    }) as HTMLInputElement
    input.addEventListener('input', () => {
      const v = Number(input.value)
      if (Number.isFinite(v)) onChange(v)
    })
    return el('label', { class: 'settings-row' }, [el('span', { class: 'settings-label', text: label }), input])
  }

  function sliderRow(
    label: string,
    value: number,
    opts: { min: number; max: number; step: number; pct?: boolean },
    onChange: (v: number) => void,
  ): HTMLElement {
    const fmt = (v: number) => (opts.pct ? `${Math.round(v * 100)}%` : String(v))
    const out = el('span', { class: 'settings-val', text: fmt(value) })
    const input = el('input', {
      type: 'range', value: String(value), min: String(opts.min), max: String(opts.max), step: String(opts.step), 'aria-label': label,
    }) as HTMLInputElement
    input.addEventListener('input', () => {
      const v = Number(input.value)
      out.textContent = fmt(v)
      onChange(v)
    })
    return el('label', { class: 'settings-row settings-row--slider' }, [el('span', { class: 'settings-label', text: label }), input, out])
  }

  function opsetSummary(): string {
    const s = sim.getConfig().supportedOpsets
    return s.length ? `Supported: ${s.join(', ')}` : 'No opsets marked supported'
  }

  function render(): void {
    const cfg = sim.getConfig()
    clear(drawer)

    drawer.append(
      el('div', { class: 'settings-head' }, [
        el('div', { class: 'settings-title', text: 'Settings' }),
        el('button', { class: 'settings-close', 'aria-label': 'Close settings', text: '✕', onclick: () => close() }),
      ]),
      el('p', {
        class: 'settings-note',
        text: 'Illustrative figures — changes apply live and are not datasheet values. Defaults reproduce docs/verification.md.',
      }),
    )

    const tops = el('div', { class: 'settings-section' }, [el('h4', { text: 'Tensor engine (HMX) · peak TOPS by format' })])
    for (const p of PRECISIONS) tops.append(numberRow(p, cfg.peakTops[p], { min: 0, max: 400, step: 1 }, (v) => setPeak(p, v)))
    drawer.append(tops)

    const tok = el('div', { class: 'settings-section' }, [el('h4', { text: 'Generative decode · tokens/s ceiling by format' })])
    for (const p of PRECISIONS) tok.append(numberRow(p, cfg.tokenCeil[p], { min: 0, max: 400, step: 1 }, (v) => setTokenCeil(p, v)))
    drawer.append(tok)

    const wid = sim.state.workload
    const wl = cfg.workloads[wid]
    const wlLabel = WORKLOADS.find((w) => w.id === wid)?.label ?? wid
    const wlSec = el('div', { class: 'settings-section' }, [
      el('h4', { text: `Workload profile · ${wlLabel}` }),
      el('p', { class: 'settings-hint', text: 'Editing the currently selected workload — switch workload in the top bar to tune another.' }),
    ])
    wlSec.append(
      sliderRow('Scalar target', wl.scalar, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { scalar: v })),
      sliderRow('HVX (vector) target', wl.vector, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { vector: v })),
      sliderRow('HMX (tensor) target', wl.tensor, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { tensor: v })),
      sliderRow('VTCM occupancy target', wl.vtcm, { min: 0, max: 1, step: 0.01, pct: true }, (v) => setProfile(wid, { vtcm: v })),
      sliderRow('Token scale', wl.tokenScale, { min: 0, max: 1, step: 0.05 }, (v) => setProfile(wid, { tokenScale: v })),
      numberRow('Resident micro-tiles', wl.microTiles, { min: 0, max: 2000, step: 10 }, (v) => setProfile(wid, { microTiles: v })),
    )
    drawer.append(wlSec)

    const pw = el('div', { class: 'settings-section' }, [el('h4', { text: 'Package power model (W)' })])
    pw.append(
      numberRow('Idle base', cfg.power.base, { min: 0, max: 10, step: 0.1 }, (v) => sim.configure({ power: { base: v } })),
      numberRow('Scalar coeff', cfg.power.scalar, { min: 0, max: 10, step: 0.1 }, (v) => sim.configure({ power: { scalar: v } })),
      numberRow('Vector coeff', cfg.power.vector, { min: 0, max: 10, step: 0.1 }, (v) => sim.configure({ power: { vector: v } })),
      numberRow('Tensor coeff', cfg.power.tensor, { min: 0, max: 10, step: 0.1 }, (v) => sim.configure({ power: { tensor: v } })),
    )
    drawer.append(pw)

    const ops = el('div', { class: 'settings-section' }, [
      el('h4', { text: 'Runtime · supported ONNX opsets' }),
      el('p', { class: 'settings-hint', text: 'Illustrative — shows where a “supported opsets” setting would live. It records the choice but does not change the animation.' }),
    ])
    const grid = el('div', { class: 'settings-opsets' })
    const summary = el('p', { class: 'settings-summary', text: opsetSummary() })
    for (const v of OPSET_CHOICES) {
      const box = el('input', { type: 'checkbox', id: `opset-${v}`, checked: cfg.supportedOpsets.includes(v) }) as HTMLInputElement
      box.addEventListener('change', () => {
        const cur = new Set(sim.getConfig().supportedOpsets)
        if (box.checked) cur.add(v)
        else cur.delete(v)
        sim.configure({ supportedOpsets: [...cur].sort((a, b) => a - b) })
        summary.textContent = opsetSummary()
      })
      grid.append(el('label', { class: 'settings-opset', for: `opset-${v}` }, [box, document.createTextNode(` ${v}`)]))
    }
    ops.append(grid, summary)
    drawer.append(ops)

    drawer.append(
      el('div', { class: 'settings-foot' }, [
        el('button', {
          class: 'btn',
          text: 'Restore defaults',
          onclick: () => {
            sim.configure(DEFAULT_SIM_CONFIG)
            render()
          },
        }),
      ]),
    )
  }

  // Keep the workload section in step with the active workload while open.
  bus.on('workload:change', () => {
    if (open) render()
  })

  function show(): void {
    render()
    drawer.classList.add('open')
    drawer.setAttribute('aria-hidden', 'false')
    open = true
    drawer.querySelector<HTMLElement>('button, input')?.focus()
  }
  function close(): void {
    drawer.classList.remove('open')
    drawer.setAttribute('aria-hidden', 'true')
    open = false
  }
  function toggle(): void {
    if (open) close()
    else show()
  }

  return {
    toggle,
    close,
    get open() {
      return open
    },
  }
}
