/**
 * Translate3d infinite strip — same idea as @rolldate/core Scroll.
 * Axis Y (default) or X. No native overflow scrollbar.
 */

import { startOfWeek } from './date'

export interface TranslateStripHandlers {
  /** Rebuild mounted segment DOM for [startIndex, startIndex+count) */
  paint: (startIndex: number, count: number) => void
  /** Dominant absolute segment index changed / settled */
  onSettle: (dominantIndex: number) => void
  /** Buffer range changed — parent should load events */
  onRangeChange: (startIndex: number, count: number) => void
  /**
   * Optional incremental DOM ops — avoids full innerHTML rebuild (scroll jump).
   * If any is missing, falls back to paint().
   */
  insertStart?: (fromAbs: number, n: number) => void
  insertEnd?: (fromAbs: number, n: number) => void
  removeStart?: (n: number) => void
  removeEnd?: (n: number) => void
  /** Resize segment size in place (week width) */
  onSegmentSize?: (size: number) => void
}

export interface TranslateStripOptions {
  /** Fixed segment size along the scroll axis (px) */
  segmentSize: number
  bufferSize: number
  /** 'y' vertical (month/day/agenda), 'x' horizontal (week) */
  axis?: 'x' | 'y'
  /** Edge threshold in segments before extending buffer */
  prefetchSegments?: number
  /**
   * Wheel: which deltas drive the strip.
   * 'natural' — X uses deltaX (fallback deltaY), Y uses deltaY
   * 'y-as-x' — vertical wheel scrolls horizontal strip (week view)
   */
  wheelMode?: 'natural' | 'y-as-x'
  /** Invert vertical-wheel→axis mapping (week: down → forward / next) */
  wheelInvert?: boolean
  /** Listen for wheel on viewport (disable when parent handles week wheel) */
  wheelEnabled?: boolean
  /** Optional absolute index bounds (inclusive) */
  minIndex?: number
  maxIndex?: number
  /** Mirror translate3d on a sibling strip (week day headers) */
  syncTransformEl?: HTMLElement
}

function clampIndex(index: number, min?: number, max?: number): number {
  let i = index
  if (min != null && i < min) i = min
  if (max != null && i > max) i = max
  return i
}

/**
 * Viewport must be overflow:hidden.
 * Strip receives translate3d; children are fixed-size segments in a row (x) or column (y).
 */
export class TranslateStrip {
  private viewport: HTMLElement
  private strip: HTMLElement
  private segmentSize: number
  private bufferSize: number
  private prefetch: number
  private axis: 'x' | 'y'
  private wheelMode: 'natural' | 'y-as-x'
  private wheelInvert: boolean
  private wheelEnabled: boolean
  private syncTransformEl?: HTMLElement
  private minIndex?: number
  private maxIndex?: number
  private handlers: TranslateStripHandlers

  private startIndex = 0
  private count = 0
  private offset = 0
  private listening = false

  private wheelRaf = 0
  private settleRaf = 0
  private scrollAnimId = 0
  private touchDragging = false
  private touchLast = 0
  private touchLastY = 0
  private touchLastTime = 0
  private touchVelocity = 0
  private touchAxisLock: 'x' | 'y' | null = null
  private touchStartX = 0
  private touchStartY = 0
  private momentumId = 0
  private extending = false

  constructor(
    viewport: HTMLElement,
    strip: HTMLElement,
    opts: TranslateStripOptions,
    handlers: TranslateStripHandlers
  ) {
    this.viewport = viewport
    this.strip = strip
    this.segmentSize = Math.max(1, opts.segmentSize)
    this.bufferSize = Math.max(4, opts.bufferSize)
    this.prefetch = opts.prefetchSegments ?? 2
    this.axis = opts.axis ?? 'y'
    this.wheelMode = opts.wheelMode ?? 'natural'
    this.wheelInvert = opts.wheelInvert === true
    this.wheelEnabled = opts.wheelEnabled !== false
    this.syncTransformEl = opts.syncTransformEl
    this.minIndex = opts.minIndex
    this.maxIndex = opts.maxIndex
    this.handlers = handlers
    this.strip.dataset.axis = this.axis
  }

  get state(): {
    startIndex: number
    count: number
    segmentSize: number
    offset: number
    axis: 'x' | 'y'
  } {
    return {
      startIndex: this.startIndex,
      count: this.count,
      segmentSize: this.segmentSize,
      offset: this.offset,
      axis: this.axis
    }
  }

  /** Update segment size (e.g. week width on resize) without changing index */
  setSegmentSize(size: number): void {
    const next = Math.max(1, Math.round(size))
    if (next === this.segmentSize) return
    const local = this.dominantIndex() - this.startIndex
    this.segmentSize = next
    this.offset = -(local * this.segmentSize)
    this.apply()
    if (this.handlers.onSegmentSize) this.handlers.onSegmentSize(next)
    else this.handlers.paint(this.startIndex, this.count)
  }

  /**
   * Recenter buffer on absolute index and paint.
   * align 'start' — segment flush with viewport start.
   * align 'center' — segment near start + small inset.
   */
  reset(targetIndex: number, opts: { align?: 'start' | 'center' } = {}): void {
    this.cancelMomentum()
    this.cancelScrollAnim()
    this.cancelSettle()
    targetIndex = clampIndex(targetIndex, this.minIndex, this.maxIndex)
    const half = Math.floor(this.bufferSize / 2)
    this.startIndex = targetIndex - half
    this.count = this.bufferSize
    const local = half
    const align = opts.align ?? 'start'
    if (align === 'start') {
      this.offset = -(local * this.segmentSize)
    } else {
      const view = this.viewSize()
      this.offset =
        -(local * this.segmentSize) + Math.min(view * 0.12, this.segmentSize * 0.25)
    }
    this.handlers.paint(this.startIndex, this.count)
    this.apply()
    this.handlers.onRangeChange(this.startIndex, this.count)
    this.handlers.onSettle(targetIndex)
    requestAnimationFrame(() => this.maybeExtend())
  }

  /**
   * Scroll so `targetIndex` aligns with the viewport.
   * Animates when requested and target is already in the mounted buffer.
   */
  scrollToIndex(
    targetIndex: number,
    opts: { animate?: boolean; align?: 'start' | 'center' } = {}
  ): void {
    this.cancelMomentum()
    this.cancelScrollAnim()
    this.cancelSettle()
    targetIndex = clampIndex(targetIndex, this.minIndex, this.maxIndex)

    const align = opts.align ?? 'start'
    const local = targetIndex - this.startIndex

    if (local < 0 || local >= this.count) {
      this.reset(targetIndex, { align })
      return
    }

    const targetOffset = this.offsetForIndex(targetIndex, align)
    const animate = opts.animate === true && Math.abs(this.offset - targetOffset) > 1

    if (!animate) {
      this.offset = targetOffset
      this.apply()
      this.maybeExtend()
      this.handlers.onSettle(targetIndex)
      return
    }

    const from = this.offset
    const duration = 320
    const t0 = performance.now()

    const step = (now: number): void => {
      const t = Math.min(1, (now - t0) / duration)
      const eased = 1 - (1 - t) ** 3
      this.offset = from + (targetOffset - from) * eased
      this.apply()
      if (t < 1) {
        this.scrollAnimId = requestAnimationFrame(step)
        return
      }
      this.scrollAnimId = 0
      this.maybeExtend()
      this.handlers.onSettle(targetIndex)
    }
    this.scrollAnimId = requestAnimationFrame(step)
  }

  start(): void {
    if (this.listening) return
    this.listening = true
    if (this.wheelEnabled) {
      this.viewport.addEventListener('wheel', this.onWheel, { passive: false })
    }
    this.viewport.addEventListener('touchstart', this.onTouchStart, { passive: true })
    this.viewport.addEventListener('touchmove', this.onTouchMove, { passive: false })
    this.viewport.addEventListener('touchend', this.onTouchEnd, { passive: true })
    this.viewport.addEventListener('touchcancel', this.onTouchEnd, { passive: true })
  }

  stop(): void {
    this.listening = false
    this.cancelMomentum()
    this.cancelScrollAnim()
    this.cancelSettle()
    cancelAnimationFrame(this.wheelRaf)
    if (this.wheelEnabled) {
      this.viewport.removeEventListener('wheel', this.onWheel)
    }
    this.viewport.removeEventListener('touchstart', this.onTouchStart)
    this.viewport.removeEventListener('touchmove', this.onTouchMove)
    this.viewport.removeEventListener('touchend', this.onTouchEnd)
    this.viewport.removeEventListener('touchcancel', this.onTouchEnd)
  }

  /** External nudge (e.g. week wheel when time band is not scrolling) */
  nudgeBy(delta: number): void {
    this.nudge(delta)
  }

  /** Re-run edge extension after layout / segment-size sync */
  refreshBuffer(): void {
    this.maybeExtend()
  }

  dominantIndex(): number {
    const view = this.viewSize()
    const mid = -this.offset + view / 2
    const local = Math.floor(mid / this.segmentSize)
    return this.startIndex + Math.max(0, Math.min(this.count - 1, local))
  }

  private viewSize(): number {
    return this.axis === 'x'
      ? this.viewport.clientWidth || this.segmentSize
      : this.viewport.clientHeight || this.segmentSize
  }

  private offsetForIndex(absIndex: number, align: 'start' | 'center'): number {
    const local = absIndex - this.startIndex
    if (align === 'start') return -(local * this.segmentSize)
    const view = this.viewSize()
    return -(local * this.segmentSize) + Math.min(view * 0.12, this.segmentSize * 0.25)
  }

  private cancelSettle(): void {
    if (this.settleRaf) {
      cancelAnimationFrame(this.settleRaf)
      this.settleRaf = 0
    }
  }

  private cancelScrollAnim(): void {
    if (this.scrollAnimId) {
      cancelAnimationFrame(this.scrollAnimId)
      this.scrollAnimId = 0
    }
  }

  private apply(): void {
    const t =
      this.axis === 'x'
        ? `translate3d(${this.offset}px, 0, 0)`
        : `translate3d(0, ${this.offset}px, 0)`
    this.strip.style.transform = t
    if (this.syncTransformEl) this.syncTransformEl.style.transform = t
  }

  private scheduleSettle(): void {
    this.cancelSettle()
    this.settleRaf = requestAnimationFrame(() => {
      this.settleRaf = 0
      this.maybeExtend()
      this.handlers.onSettle(this.dominantIndex())
    })
  }

  private nudge(delta: number): void {
    this.offset += delta
    this.apply()
    this.scheduleSettle()
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    e.stopPropagation()

    this.cancelScrollAnim()

    const fromTrackpadX =
      this.axis === 'x' && Math.abs(e.deltaX) > Math.abs(e.deltaY)

    let raw: number
    if (this.wheelMode === 'y-as-x' || this.axis === 'x') {
      raw = fromTrackpadX ? e.deltaX : e.deltaY
    } else {
      raw = e.deltaY
    }
    raw *= 0.9

    let signed: number
    if (this.wheelInvert) {
      signed = fromTrackpadX ? -raw : raw
    } else {
      signed = fromTrackpadX ? raw : -raw
    }

    this.nudge(signed)
  }

  private onTouchStart = (e: TouchEvent): void => {
    if (!e.touches || e.touches.length !== 1) return
    this.cancelMomentum()
    this.cancelScrollAnim()
    this.touchDragging = true
    this.touchAxisLock = null
    this.touchStartX = e.touches[0].clientX
    this.touchStartY = e.touches[0].clientY
    this.touchLast = this.axis === 'x' ? e.touches[0].clientX : e.touches[0].clientY
    this.touchLastY = e.touches[0].clientY
    this.touchLastTime = performance.now()
    this.touchVelocity = 0
  }

  private onTouchMove = (e: TouchEvent): void => {
    if (!this.touchDragging || !e.touches || e.touches.length !== 1) return
    const x = e.touches[0].clientX
    const y = e.touches[0].clientY

    if (this.axis === 'x' && this.touchAxisLock === null) {
      const adx = Math.abs(x - this.touchStartX)
      const ady = Math.abs(y - this.touchStartY)
      if (adx > 8 || ady > 8) {
        this.touchAxisLock = adx >= ady * 1.2 ? 'x' : 'y'
      } else {
        return
      }
    }

    if (this.axis === 'x' && this.touchAxisLock === 'y') {
      return
    }

    e.preventDefault()
    const pos = this.axis === 'x' ? x : y
    const d = pos - this.touchLast
    const now = performance.now()
    const dt = now - this.touchLastTime
    if (dt > 0 && dt < 120) {
      this.touchVelocity = this.touchVelocity * 0.65 + (d / dt) * 0.35
    }
    this.touchLast = pos
    this.touchLastY = y
    this.touchLastTime = now
    if (Math.abs(d) < 1) return
    this.nudge(d)
  }

  private onTouchEnd = (): void => {
    const wasVertical = this.axis === 'x' && this.touchAxisLock === 'y'
    this.touchDragging = false
    this.touchAxisLock = null

    if (wasVertical) return

    const v = this.touchVelocity * 16
    if (Math.abs(v) < 0.4) return
    let velocity = v
    const step = (): void => {
      if (Math.abs(velocity) < 0.35) {
        this.momentumId = 0
        return
      }
      this.nudge(velocity)
      velocity *= 0.92
      this.momentumId = requestAnimationFrame(step)
    }
    this.momentumId = requestAnimationFrame(step)
  }

  private cancelMomentum(): void {
    if (this.momentumId) {
      cancelAnimationFrame(this.momentumId)
      this.momentumId = 0
    }
  }

  private canMutate(): boolean {
    const h = this.handlers
    return !!(h.insertStart && h.insertEnd && h.removeStart && h.removeEnd)
  }

  private maybeExtend(): void {
    if (this.extending) return
    const view = this.viewSize()
    const lead = -this.offset
    const trail = lead + view
    // Use continuous positions — only react at true edges, not every peek into neighbor
    const localStart = lead / this.segmentSize
    const localEnd = trail / this.segmentSize
    const mutate = this.canMutate()
    // Keep several segments of slack before trimming so mid-scroll never destroys DOM
    const softMax = this.bufferSize + Math.max(4, this.prefetch * 2)
    const edge = 0.35 // extend only when <35% into the edge segment

    if (localStart < edge) {
      if (this.minIndex != null && this.startIndex <= this.minIndex) return
      const add = Math.min(4, Math.max(2, Math.ceil(this.bufferSize / 3)))
      this.extending = true
      this.startIndex -= add
      this.count += add
      this.offset -= add * this.segmentSize
      if (mutate) this.handlers.insertStart!(this.startIndex, add)
      if (this.count > softMax) {
        const trim = this.count - this.bufferSize
        this.count -= trim
        if (mutate) this.handlers.removeEnd!(trim)
      }
      if (!mutate) this.handlers.paint(this.startIndex, this.count)
      this.apply()
      this.extending = false
      this.handlers.onRangeChange(this.startIndex, this.count)
      return
    }

    if (localEnd > this.count - edge) {
      if (this.maxIndex != null && this.startIndex + this.count - 1 >= this.maxIndex) return
      const add = Math.min(4, Math.max(2, Math.ceil(this.bufferSize / 3)))
      this.extending = true
      const absStart = this.startIndex + this.count
      this.count += add
      if (mutate) this.handlers.insertEnd!(absStart, add)
      if (this.count > softMax) {
        const trim = this.count - this.bufferSize
        this.startIndex += trim
        this.count -= trim
        this.offset += trim * this.segmentSize
        if (mutate) this.handlers.removeStart!(trim)
      }
      if (!mutate) this.handlers.paint(this.startIndex, this.count)
      this.apply()
      this.extending = false
      this.handlers.onRangeChange(this.startIndex, this.count)
    }
  }
}

/** Week index relative to epoch week */
export function dateToWeekIndex(date: Date, firstDayOfWeek: 0 | 1): number {
  const ref = firstDayOfWeek === 1 ? new Date(1970, 0, 5) : new Date(1970, 0, 4)
  const start = startOfWeek(date, firstDayOfWeek)
  return Math.round((start.getTime() - ref.getTime()) / 86400000 / 7)
}

export function weekIndexToDate(weekIndex: number, firstDayOfWeek: 0 | 1): Date {
  const ref = firstDayOfWeek === 1 ? new Date(1970, 0, 5) : new Date(1970, 0, 4)
  const d = new Date(ref)
  d.setDate(ref.getDate() + weekIndex * 7)
  return d
}

export function dateToDayIndex(date: Date): number {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const ref = Date.UTC(1970, 0, 1)
  return Math.floor((day - ref) / 86400000)
}

export function dayIndexToDate(dayIndex: number): Date {
  const d = new Date(1970, 0, 1)
  d.setDate(d.getDate() + dayIndex)
  return d
}
