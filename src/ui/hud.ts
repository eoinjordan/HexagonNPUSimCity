import { type Bus } from '../core/bus'
import { COLOR } from '../core/theme'
import type { SimState } from '../core/types'
import { fmtNum, hexCss } from '../core/util'
import { PRECISIONS, WORKLOADS } from '../sim/model'
import { DISTRICTS } from '../world/districts'
import { clear, el } from './dom'

export interface Hud {
  update(s: SimState): void
  setPaused(paused: boolean): void
}

interface HudDeps {
  bus: Bus
  initial: SimState
}

/** The heads-up display: brand, workload/precision controls, legend and meters. */
export function createHud(deps: HudDeps): Hud {
  const { bus } = deps
  const top = document.getElementById('hud-top')!
  const left = document.getElementById('hud-left')!
  const right = document.getElementById('hud-right')!
  const bottom = document.getElementById('hud-bottom')!
  clear(top)
  clear(left)
  clear(right)
  clear(bottom)

  /* ---- top bar ---- */
  const brand = el('div', { class: 'brand' }, [
    el('div', {
      html: `<svg viewBox="0 0 100 100" width="30" height="30"><defs><linearGradient id="hb" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#9b6cff"/></linearGradient></defs><path d="M50 6 L88 28 L88 72 L50 94 L12 72 L12 28 Z" fill="none" stroke="url(#hb)" stroke-width="6"/><circle cx="50" cy="50" r="9" fill="url(#hb)"/></svg>`,
    }),
    el('div', { class: 'brand-text' }, [
      el('div', { class: 'brand-title', html: 'Hexagon<span>NPU</span>SimCity' }),
      el('div', { class: 'brand-sub', text: 'How the Hexagon NPU works, in 3D' }),
    ]),
  ])

  const workloadSel = el('select', {
    id: 'workload',
    'aria-label': 'Workload',
    onchange: (e: Event) => {
      const workload = WORKLOADS.find((item) => item.id === (e.target as HTMLSelectElement).value)
      if (workload) bus.emit('workload:change', { id: workload.id })
    },
  })
  for (const w of WORKLOADS) workloadSel.append(el('option', { value: w.id, text: w.label }))

  const precisionSel = el('select', {
    id: 'precision',
    'aria-label': 'Illustrative numeric format',
    'aria-describedby': 'model-caveat',
    title: 'Illustrative format, not a device capability or quantization result',
    onchange: (e: Event) => {
      const precision = PRECISIONS.find((item) => item === (e.target as HTMLSelectElement).value)
      if (precision) bus.emit('precision:change', { value: precision })
    },
  })
  for (const p of PRECISIONS) precisionSel.append(el('option', { value: p, text: p }))
  precisionSel.value = deps.initial.precision

  top.append(
    brand,
    el('div', { class: 'spacer' }),
    el('div', { class: 'control-group' }, [el('label', { for: 'workload', text: 'Workload' }), workloadSel]),
    el('div', { class: 'control-group' }, [el('label', { for: 'precision', text: 'Format' }), precisionSel]),
  )

  /* ---- left toolbar ---- */
  type VoidEvent = 'tour:toggle' | 'camera:home' | 'theme:toggle' | 'help:toggle' | 'settings:toggle' | 'getapp:toggle'
  const tool = (glyph: string, label: string, ev: VoidEvent) =>
    el('button', { class: 'tool', title: label, 'aria-label': label, onclick: () => bus.emit(ev, undefined) }, [
      document.createTextNode(glyph),
      el('small', { text: label }),
    ])
  const pauseTool = el('button', { class: 'tool', title: 'Pause / resume (K)', 'aria-label': 'Pause or resume', onclick: () => bus.emit('pause:toggle', undefined) }, [
    document.createTextNode('⏸'),
    el('small', { text: 'Pause (K)' }),
  ])
  left.append(
    tool('▶', 'Guided tour (T)', 'tour:toggle'),
    pauseTool,
    tool('⌂', 'Establishing shot (H)', 'camera:home'),
    tool('◐', 'Day / night (N)', 'theme:toggle'),
    tool('?', 'Keys & legend (?)', 'help:toggle'),
    tool('⚙', 'Settings — tune the figures', 'settings:toggle'),
    tool('⤓', 'Get the app — Android APK / Windows installer', 'getapp:toggle'),
  )

  /* ---- right legend ---- */
  const legend = el('div', { class: 'card' }, [el('h3', { text: 'Districts' })])
  for (const d of DISTRICTS) {
    legend.append(
      el('button', { class: 'legend-row', 'aria-label': `Focus ${d.name}`, onclick: () => {
        bus.emit('district:select', { id: d.id })
        bus.emit('camera:focus', { id: d.id })
      } }, [
        el('span', { class: 'swatch', style: { color: hexCss(d.color), background: hexCss(d.color) } }),
        el('span', { class: 'name', text: d.name }),
      ]),
    )
  }
  legend.append(el('h3', { text: 'Dataflow', style: { marginTop: '10px' } }))
  const flowLegend: [number, string][] = [
    [COLOR.activation, 'Activations'],
    [COLOR.weight, 'Weights'],
    [COLOR.scalar, 'Control'],
  ]
  for (const [c, name] of flowLegend) {
    legend.append(
      el('div', { class: 'legend-row' }, [
        el('span', { class: 'swatch', style: { color: hexCss(c), background: hexCss(c) } }),
        el('span', { class: 'name', text: name }),
      ]),
    )
  }
  right.append(legend)

  /* ---- bottom meters ---- */
  const metric = (k: string) => {
    const v = el('div', { class: 'v' })
    return { node: el('div', { class: 'metric' }, [el('div', { class: 'k', text: k }), v]), v }
  }
  const mTops = metric('Tensor TOPS')
  const mTok = metric('Tokens / s')
  const mPow = metric('Power (W)')
  const mWork = metric('Workload')

  const bar = (k: string, color: number) => {
    const fill = el('div', { class: 'fill', style: { background: hexCss(color), height: '4%' } })
    return { node: el('div', { class: 'bar' }, [el('div', { class: 'k', text: k }), el('div', { class: 'track' }, [fill])]), fill }
  }
  const bScalar = bar('Scal', COLOR.scalar)
  const bVector = bar('HVX', COLOR.vector)
  const bTensor = bar('HMX', COLOR.tensor)
  const bVtcm = bar('VTCM', COLOR.vtcm)

  bottom.append(
    el('div', { class: 'metrics' }, [
      el('p', { id: 'model-caveat', class: 'metrics-note', text: 'Illustrative model - not hardware measurements' }),
      mTops.node, mTok.node, mPow.node, mWork.node,
    ]),
    el('div', { class: 'bars' }, [bScalar.node, bVector.node, bTensor.node, bVtcm.node]),
  )

  const workloadLabel = (id: string) => WORKLOADS.find((w) => w.id === id)?.label ?? id

  function update(s: SimState): void {
    workloadSel.value = s.workload
    precisionSel.value = s.precision
    mTops.v.innerHTML = `${fmtNum(s.tops)} <small>${s.precision}</small>`
    mTok.v.textContent = s.tokensPerSec > 0.5 ? fmtNum(s.tokensPerSec) : '—'
    mPow.v.innerHTML = `${s.powerWatts.toFixed(1)} <small>W</small>`
    mWork.v.textContent = workloadLabel(s.workload)
    bScalar.fill.style.height = `${Math.max(4, s.util.scalar * 100)}%`
    bVector.fill.style.height = `${Math.max(4, s.util.vector * 100)}%`
    bTensor.fill.style.height = `${Math.max(4, s.util.tensor * 100)}%`
    bVtcm.fill.style.height = `${Math.max(4, s.vtcmOccupancy * 100)}%`
  }

  function setPaused(paused: boolean): void {
    pauseTool.firstChild!.textContent = paused ? '▶' : '⏸'
  }

  return { update, setPaused }
}
