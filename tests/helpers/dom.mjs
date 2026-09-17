import { JSDOM } from 'jsdom'

export function installDom({ html = '', reducedMotion = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const previous = new Map()
  const names = ['window', 'document', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'HTMLSelectElement', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']
  for (const name of names) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    const value = name === 'window' ? window : window[name]
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? value.bind(window) : value,
    })
  }
  let motion = reducedMotion
  const media = new window.EventTarget()
  Object.defineProperties(media, {
    matches: { get: () => motion },
    media: { value: '(prefers-reduced-motion: reduce)' },
  })
  window.matchMedia = () => media

  return {
    window,
    document: window.document,
    setReducedMotion(value) {
      motion = value
      const event = new window.Event('change')
      Object.defineProperty(event, 'matches', { value })
      media.dispatchEvent(event)
    },
    cleanup() {
      window.close()
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
    },
  }
}

export function pointer(window, element, type, clientX, clientY, options = {}) {
  const Pointer = window.PointerEvent ?? window.MouseEvent
  element.dispatchEvent(new Pointer(type, {
    bubbles: true,
    clientX,
    clientY,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    ...options,
  }))
}