import type { Bus } from '../core/bus'
import type { DistrictDef, SimState } from '../core/types'
import { hexCss } from '../core/util'
import { clear, el } from './dom'

export interface Inspector {
  show(def: DistrictDef): void
  hide(): void
  update(s: SimState): void
}

/** The bottom-right card that explains the selected district and reads it live. */
export function createInspector(bus: Bus): Inspector {
  const root = document.getElementById('inspector')!
  let current: DistrictDef | null = null
  let readout: HTMLElement | null = null

  function render(def: DistrictDef): void {
    clear(root)
    readout = el('div', { class: 'readout', text: '…' })
    root.append(
      el('div', { class: 'card' }, [
        el('div', { class: 'inspector-head' }, [
          el('span', { class: 'dot', style: { color: hexCss(def.color), background: hexCss(def.color) } }),
          el('span', { class: 't', text: def.name }),
          el('button', { class: 'close', 'aria-label': 'Close inspector', text: '✕', onclick: () => bus.emit('district:select', { id: null }) }),
        ]),
        el('div', { class: 'sub', text: def.subtitle }),
        el('div', { class: 'blurb', text: def.blurb }),
        readout,
      ]),
    )
  }

  return {
    show(def: DistrictDef): void {
      current = def
      render(def)
      root.classList.add('show')
    },
    hide(): void {
      current = null
      root.classList.remove('show')
    },
    update(s: SimState): void {
      if (current && readout) readout.textContent = current.readout(s)
    },
  }
}
