/** Minimal DOM builder so the UI modules stay declarative and dependency-free. */
export type Attrs = {
  class?: string
  text?: string
  html?: string
  title?: string
  style?: Partial<CSSStyleDeclaration>
  dataset?: Record<string, string>
  [key: string]: unknown
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue
    if (k === 'class') node.className = v as string
    else if (k === 'text') node.textContent = v as string
    else if (k === 'html') node.innerHTML = v as string
    else if (k === 'style') Object.assign(node.style, v)
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (typeof v === 'boolean') {
      if (v) node.setAttribute(k, '')
    } else {
      node.setAttribute(k, String(v))
    }
  }
  for (const c of children) node.append(c)
  return node
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}
