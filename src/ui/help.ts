import type { Bus } from '../core/bus'
import { COLOR } from '../core/theme'
import { hexCss } from '../core/util'
import { DISTRICTS } from '../world/districts'
import { clear, el } from './dom'

export interface Help {
  toggle(): void
  close(): void
  readonly open: boolean
}

const CAMERA_KEYS: [string, string][] = [
  ['Drag', 'Pan across the die'],
  ['Shift · drag', 'Orbit'],
  ['Wheel / pinch', 'Zoom'],
  ['Click', 'Select a district'],
]

const KEYS: [string, string][] = [
  ['T', 'Guided tour'],
  ['K / P', 'Pause / resume'],
  ['H', 'Establishing shot'],
  ['N', 'Day / night'],
  ['R', 'Reset'],
  ['1 / 2 / 3', 'LLM / Vision / Idle'],
  ['?', 'This panel'],
  ['Esc', 'Close overlay'],
]

/** The keyboard-and-legend overlay. A real modal dialog, closeable by button or Esc. */
export function createHelp(bus: Bus): Help {
  const overlay = document.getElementById('help-overlay')!
  let open = false

  function swatch(color: number, label: string): HTMLElement {
    return el('div', { class: 'kbd-row' }, [
      el('span', {
        class: 'name',
        html: `<span class="swatch" style="color:${hexCss(color)};background:${hexCss(color)}"></span> ${label}`,
      }),
    ])
  }

  function keyRows(rows: [string, string][]): HTMLElement[] {
    return rows.map(([k, d]) => el('div', { class: 'kbd-row' }, [el('span', { text: d }), el('kbd', { text: k })]))
  }

  function build(): void {
    clear(overlay)
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', 'Keyboard shortcuts and colour legend')

    const panel = el('div', { class: 'help-panel' }, [
      el('h2', { text: 'HexagonNPUSimCity' }),
      el('p', {
        class: 'muted',
        text: 'An explorable model of the Qualcomm Hexagon NPU. Figures are illustrative, not datasheet values.',
      }),
      el('div', { class: 'help-grid' }, [
        el('div', {}, [el('h4', { text: 'Camera' }), ...keyRows(CAMERA_KEYS)]),
        el('div', {}, [el('h4', { text: 'Keys' }), ...keyRows(KEYS)]),
        el('div', {}, [el('h4', { text: 'Districts' }), ...DISTRICTS.map((d) => swatch(d.color, d.name))]),
        el('div', {}, [
          el('h4', { text: 'Dataflow' }),
          swatch(COLOR.activation, 'Activations (NPU-local)'),
          swatch(COLOR.weight, 'Weights from DRAM'),
          swatch(COLOR.scalar, 'Scalar control'),
        ]),
      ]),
      el('button', { class: 'btn help-close', text: 'Close (Esc)', onclick: () => close() }),
    ])
    overlay.append(panel)
    overlay.addEventListener('click', (e: Event) => {
      if (e.target === overlay) close()
    })
  }

  function show(): void {
    if (!overlay.firstChild) build()
    overlay.hidden = false
    open = true
    overlay.querySelector<HTMLButtonElement>('button')?.focus()
  }

  function close(): void {
    overlay.hidden = true
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
