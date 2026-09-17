import type { Bus } from '../core/bus'

export interface Controls {
  dispose(): void
}

/**
 * Global keyboard shortcuts. Every key maps to a bus event so the rest of the
 * app never listens to the keyboard directly; `Escape` is the one exception,
 * routed to a dismiss callback that closes whatever overlay is topmost.
 */
export function createControls(bus: Bus, onDismiss: () => void): Controls {
  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return
    if (e.metaKey || e.ctrlKey || e.altKey) return

    switch (e.key) {
      case 't':
      case 'T':
        bus.emit('tour:toggle', undefined)
        break
      case 'k':
      case 'K':
      case 'p':
      case 'P':
        bus.emit('pause:toggle', undefined)
        break
      case 'h':
      case 'H':
        bus.emit('camera:home', undefined)
        break
      case 'n':
      case 'N':
        bus.emit('theme:toggle', undefined)
        break
      case 'r':
      case 'R':
        bus.emit('reset', undefined)
        break
      case '1':
        bus.emit('workload:change', { id: 'llm-decode' })
        break
      case '2':
        bus.emit('workload:change', { id: 'vision-conv' })
        break
      case '3':
        bus.emit('workload:change', { id: 'idle' })
        break
      case '?':
      case '/':
        bus.emit('help:toggle', undefined)
        e.preventDefault()
        break
      case 'Escape':
        onDismiss()
        break
      default:
        return
    }
  }

  window.addEventListener('keydown', onKey)
  return {
    dispose() {
      window.removeEventListener('keydown', onKey)
    },
  }
}
