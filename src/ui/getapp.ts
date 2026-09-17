import { clear, el } from './dom'
import '../styles/getapp.css'
import androidQr from '../assets/qr-android.svg'
import windowsQr from '../assets/qr-windows.svg'

export interface GetApp {
  toggle(): void
  close(): void
  readonly open: boolean
}

const RELEASES = 'https://github.com/eoinjordan/HexagonNPUSimCity/releases'
const ANDROID_URL = `${RELEASES}/latest/download/HexagonNPUSimCity-arm64-cpu-preview.apk`
const WINDOWS_URL = `${RELEASES}/latest/download/HexagonNPUSimCity-arm64.msi`

/**
 * "Get the app" — a small modal with QR codes to the native preview installers.
 * The QR codes point at GitHub's stable `releases/latest/download/<asset>` URLs,
 * so they always resolve to the newest build once a release is tagged.
 */
export function createGetApp(): GetApp {
  const overlay = el('div', {
    id: 'getapp-overlay',
    class: 'getapp-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Get the native preview apps',
    hidden: true,
  })
  document.body.append(overlay)
  let open = false

  function card(kind: string, qr: string, name: string, url: string): HTMLElement {
    return el('div', { class: 'getapp-card' }, [
      el('div', { class: 'getapp-qr' }, [
        el('img', { src: qr, alt: `QR code linking to the ${name} download`, width: '160', height: '160' }),
      ]),
      el('div', { class: 'getapp-kind', text: kind }),
      el('div', { class: 'getapp-name', text: name }),
      el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', text: 'Download ↗' }),
    ])
  }

  function build(): void {
    clear(overlay)
    const panel = el('div', { class: 'getapp-panel' }, [
      el('div', { class: 'getapp-head' }, [
        el('h2', { text: 'Get the app' }),
        el('button', { class: 'getapp-close', 'aria-label': 'Close', text: '✕', onclick: () => close() }),
      ]),
      el('p', {
        class: 'getapp-sub',
        text: 'Scan to install the on-device preview. Android is a debug-signed evaluation build; Windows needs Windows 11 on ARM (Snapdragon) with WebView2.',
      }),
      el('div', { class: 'getapp-cards' }, [
        card('Scan with your phone', androidQr, 'Android APK (ARM64)', ANDROID_URL),
        card('Scan, or open on the PC', windowsQr, 'Windows installer (ARM64 MSI)', WINDOWS_URL),
      ]),
      el('p', {
        class: 'getapp-note',
        text: 'Preview builds are published on GitHub Releases; these links resolve once a release is tagged.',
      }),
      el('a', { class: 'getapp-all', href: RELEASES, target: '_blank', rel: 'noopener', text: 'All releases ↗' }),
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
    overlay.querySelector<HTMLElement>('button, a')?.focus()
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
