/**
 * Dual-axis pan for Week / Timeline: translate3d only, no native scrollbar.
 * Vertical wheel pans Y only when content overflows. Trackpad X and
 * Shift+wheel pan sideways. Vertical never becomes horizontal by default.
 */

export interface WheelRoute {
  axis: 'x' | 'y'
  delta: number
}

export const PAN_WHEEL = 0.9
export const PAN_ARROW = 56
export const PAN_PAGE = 200

export function canPanY(content: number, view: number): boolean {
  return content - view > 1
}

export function clampPanOffset(offset: number, content: number, view: number): number {
  const min = Math.min(0, view - content)
  if (offset > 0) return 0
  if (offset < min) return min
  return offset
}

export function routePanWheel(e: WheelEvent, canX: boolean, canY: boolean): WheelRoute | null {
  const ax = Math.abs(e.deltaX)
  const ay = Math.abs(e.deltaY)
  if (e.shiftKey && canX && ay > 0.5) {
    return { axis: 'x', delta: e.deltaY * PAN_WHEEL }
  }
  if (ax > ay && canX) {
    return { axis: 'x', delta: -e.deltaX * PAN_WHEEL }
  }
  if (canY && ay >= ax) {
    return { axis: 'y', delta: -e.deltaY * PAN_WHEEL }
  }
  return null
}

export class BoundPan {
  offset = 0
  private viewport: HTMLElement
  private strip: HTMLElement
  private contentPx: number | null = null
  private viewPx: number | null = null
  private onChange?: () => void

  constructor(viewport: HTMLElement, strip: HTMLElement, onChange?: () => void) {
    this.viewport = viewport
    this.strip = strip
    this.onChange = onChange
  }

  setContentSize(px: number): void {
    this.contentPx = Math.max(0, px)
  }

  setViewSize(px: number): void {
    this.viewPx = Math.max(0, px)
  }

  contentSize(): number {
    if (this.contentPx != null) return this.contentPx
    return this.strip.scrollHeight || this.strip.offsetHeight || 0
  }

  viewSize(): number {
    if (this.viewPx != null) return this.viewPx
    return this.viewport.clientHeight || 0
  }

  canScroll(): boolean {
    return canPanY(this.contentSize(), this.viewSize())
  }

  atStart(): boolean {
    return this.offset > -0.5
  }

  atEnd(): boolean {
    return this.offset <= clampPanOffset(-1e6, this.contentSize(), this.viewSize()) + 0.5
  }

  nudge(delta: number): void {
    this.setOffset(this.offset + delta)
  }

  setOffset(next: number): void {
    const clamped = clampPanOffset(next, this.contentSize(), this.viewSize())
    if (clamped === this.offset) {
      this.apply()
      return
    }
    this.offset = clamped
    this.apply()
    this.onChange?.()
  }

  apply(): void {
    this.strip.style.transform = `translate3d(0, ${this.offset}px, 0)`
  }
}

export function panHintText(_locale: string): string {
  return '← Shift + scroll →'
}

export function panChromeHtml(locale: string): string {
  return `<div class="rde-pan-edges" aria-hidden="true"><span class="rde-pan-edge is-left"></span><span class="rde-pan-edge is-right"></span><span class="rde-pan-edge is-top"></span><span class="rde-pan-edge is-bottom"></span></div><p class="rde-pan-hint">${panHintText(locale)}</p>`
}

export function syncPanHints(
  root: HTMLElement,
  state: { canX: boolean; canY: boolean; yAtStart: boolean; yAtEnd: boolean }
): void {
  root.classList.toggle('is-pan-x', state.canX)
  root.classList.toggle('is-pan-y', state.canY)
  root.classList.toggle('is-pan-top', state.canY && !state.yAtStart)
  root.classList.toggle('is-pan-bottom', state.canY && !state.yAtEnd)
  const hint = root.querySelector<HTMLElement>('.rde-pan-hint')
  if (hint) hint.hidden = !state.canX
}

export function bindPanKeys(
  root: HTMLElement,
  handlers: {
    canX: () => boolean
    canY: () => boolean
    nudgeX: (delta: number) => void
    nudgeY: (delta: number) => void
  }
): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    const canX = handlers.canX()
    const canY = handlers.canY()
    let used = false
    if (e.key === 'ArrowLeft' && canX) {
      handlers.nudgeX(PAN_ARROW)
      used = true
    } else if (e.key === 'ArrowRight' && canX) {
      handlers.nudgeX(-PAN_ARROW)
      used = true
    } else if (e.key === 'ArrowUp') {
      if (e.shiftKey && canX) handlers.nudgeX(PAN_ARROW)
      else if (canY) handlers.nudgeY(PAN_ARROW)
      else return
      used = true
    } else if (e.key === 'ArrowDown') {
      if (e.shiftKey && canX) handlers.nudgeX(-PAN_ARROW)
      else if (canY) handlers.nudgeY(-PAN_ARROW)
      else return
      used = true
    } else if (e.key === 'PageUp') {
      if (canY) handlers.nudgeY(PAN_PAGE)
      else return
      used = true
    } else if (e.key === 'PageDown') {
      if (canY) handlers.nudgeY(-PAN_PAGE)
      else return
      used = true
    } else if (e.key === 'Home' && canY) {
      handlers.nudgeY(1e6)
      used = true
    } else if (e.key === 'End' && canY) {
      handlers.nudgeY(-1e6)
      used = true
    }
    if (used) {
      e.preventDefault()
      e.stopPropagation()
    }
  }
  root.addEventListener('keydown', onKey)
  return () => root.removeEventListener('keydown', onKey)
}
