import type { Bus } from '../core/bus'
import type { DistrictId } from '../core/types'
import { clear, el } from './dom'

interface TourStep {
  focus: DistrictId | 'home'
  title: string
  body: string
}

/**
 * A short guided walk of the fused NPU pipeline, following one inference from
 * weights in memory through the accelerators and back.
 */
const STEPS: TourStep[] = [
  {
    focus: 'home',
    title: 'The Hexagon NPU, from above',
    body: 'Purpose-built for on-device AI inference at low power. Three accelerators are fused around one shared memory. Let’s follow an inference through them.',
  },
  {
    focus: 'vtcm',
    title: 'VTCM — the shared memory',
    body: 'A large, dedicated memory every accelerator can reach. Sharing data here — instead of over system DRAM — is what makes the fused design fast and efficient.',
  },
  {
    focus: 'microtile',
    title: 'Micro-tile inferencing',
    body: 'Weights and activations arrive cut into small tiles (orange), streamed in so the engines stay fed at ultra-low power rather than stalling on big transfers.',
  },
  {
    focus: 'scalar',
    title: 'The scalar accelerator',
    body: 'Runs control flow and sequences the other engines — the parts of a model that aren’t big matrix math. Watch the scheduler ring spin up with load.',
  },
  {
    focus: 'vector',
    title: 'HVX — the vector engine',
    body: 'Wide SIMD lanes handle the per-element work between matrix multiplies: activations, normalisation, pooling. The lanes ripple as data streams through.',
  },
  {
    focus: 'tensor',
    title: 'HMX — the tensor engine',
    body: 'The multiply-accumulate array where most TOPS live. A wavefront sweeps the grid as it accumulates convolutions and matmuls. Try INT4 vs FP16 and watch it change.',
  },
  {
    focus: 'cpu',
    title: 'Heterogeneous compute',
    body: 'The NPU is the star, but the Oryon CPU and Adreno GPU share the workload. Placing each task on the right engine is what delivers performance at low power.',
  },
  {
    focus: 'sensors',
    title: 'Always-on efficiency',
    body: 'Low-power sensing wakes the big engines only when there’s work. That efficiency is what lets generative AI run on-device, on battery.',
  },
]

export interface Tour {
  toggle(): void
  start(): void
  stop(): void
  next(): void
  prev(): void
  readonly active: boolean
}

export function createTour(bus: Bus): Tour {
  const layer = document.getElementById('tour-layer')!
  let i = 0
  let active = false

  function present(): void {
    const step = STEPS[i]
    if (step.focus === 'home') bus.emit('camera:home', undefined)
    else {
      bus.emit('camera:focus', { id: step.focus })
      bus.emit('district:select', { id: step.focus })
    }
    clear(layer)
    const dots = el('div', { class: 'tour-dots' }, STEPS.map((_, k) => el('i', { class: k === i ? 'on' : '' })))
    layer.append(
      el('div', { class: 'tour-card' }, [
        el('div', { class: 'step', text: `Step ${i + 1} of ${STEPS.length}` }),
        el('h2', { text: step.title }),
        el('p', { text: step.body }),
        el('div', { class: 'tour-nav' }, [
          el('button', { class: 'btn', text: '‹ Back', onclick: () => prev() }),
          el('button', { class: 'btn', text: i === STEPS.length - 1 ? 'Finish' : 'Next ›', onclick: () => next() }),
          el('div', { class: 'spacer' }),
          dots,
          el('button', { class: 'btn', text: 'Exit', onclick: () => stop() }),
        ]),
      ]),
    )
  }

  function start(): void {
    active = true
    i = 0
    layer.classList.add('show')
    present()
  }

  function stop(): void {
    active = false
    layer.classList.remove('show')
    bus.emit('district:select', { id: null })
    bus.emit('camera:home', undefined)
  }

  function next(): void {
    if (!active) return
    if (i >= STEPS.length - 1) return stop()
    i++
    present()
  }

  function prev(): void {
    if (!active || i === 0) return
    i--
    present()
  }

  return {
    toggle: () => (active ? stop() : start()),
    start,
    stop,
    next,
    prev,
    get active() {
      return active
    },
  }
}
