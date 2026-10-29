/**
 * Week/Day time strip.
 * Week — translate3d on both axes: days on X, hours on Y (no native bars).
 * Day — vertical translate3d of day segments; sticky header.
 */

import type { LayoutPatch, NormalizedEvent, ViewContext } from '../types'
import { addDays, dayKey, eachDayKey, formatTime, parseDayKey, sameDay, startOfWeek } from '../utils/date'
import { escapeAttr, escapeHtml } from '../utils/dom'
import { eventsFingerprint, indexEventsByDay } from '../utils/eventIndex'
import {
  dateToDayIndex,
  dateToWeekIndex,
  dayIndexToDate,
  TranslateStrip,
  weekIndexToDate
} from '../utils/infiniteScroll'
import {
  BoundPan,
  bindPanKeys,
  canPanY,
  panChromeHtml,
  routePanWheel,
  syncPanHints
} from '../utils/panScroll'
import { eventEditableAttr, isEventEditable } from '../utils/eventEditable'
import { maxOverlapColumns, weekLayoutMetrics } from '../utils/responsive'
import {
  HOUR_PX,
  ALL_DAY_ROW_PX,
  TIMEGRID_MAX_PX,
  layoutDayBlocks,
  blockBoxStyle,
  allDayEventsForDay,
  renderAllDayHtml,
  resizeHandlesHtml
} from './timeGrid'

export type StripMode = 'week' | 'day'

const HEAD_PX = 36

function hoursHeight(ctx: ViewContext): number {
  const { start, end } = ctx.visibleHours
  return Math.max(1, end - start) * HOUR_PX
}

function hourLabelsHtml(ctx: ViewContext): string {
  const { start, end } = ctx.visibleHours
  const rows: string[] = []
  for (let h = start; h < end; h++) {
    rows.push(
      `<div class="rde-tg-label" style="height:${HOUR_PX}px">${String(h).padStart(2, '0')}:00</div>`
    )
  }
  return `<div class="rde-tg-labels">${rows.join('')}</div>`
}

function columnGrid(cols: number, compact: boolean, dayWidth: number): string {
  if (compact && dayWidth > 0) {
    return `repeat(${cols}, ${Math.round(dayWidth)}px)`
  }
  return `repeat(${cols}, minmax(0, 1fr))`
}

function headsHtml(
  days: Date[],
  ctx: ViewContext,
  mode: StripMode,
  dayWidth: number
): string {
  const today = new Date()
  const cols = columnGrid(days.length, ctx.compact, dayWidth)
  const cells = days
    .map((d) => {
      const label = new Intl.DateTimeFormat(ctx.locale, {
        weekday: 'short',
        day: 'numeric',
        ...(mode === 'day' ? { month: 'short' as const } : {})
      }).format(d)
      const key = dayKey(d)
      const cls = `rde-tg-head${sameDay(d, today) ? ' is-today' : ''}`
      if (mode === 'week') {
        return `<button type="button" class="${cls} rde-open-day" data-open-day="${key}" data-day="${key}">${escapeHtml(label)}</button>`
      }
      return `<div class="${cls}" data-day="${key}">${escapeHtml(label)}</div>`
    })
    .join('')
  return `<div class="rde-tg-heads" style="grid-template-columns:${cols}">${cells}</div>`
}

function eventsOnDay(byDay: Map<string, NormalizedEvent[]>, day: Date): NormalizedEvent[] {
  return byDay.get(dayKey(day)) || []
}

function blocksHtml(
  byDay: Map<string, NormalizedEvent[]>,
  day: Date,
  ctx: ViewContext,
  dayWidth: number
): string {
  const { start, end } = ctx.visibleHours
  const blocks = layoutDayBlocks(eventsOnDay(byDay, day), day, start, end)
  const compact = ctx.compact
  const maxCols = maxOverlapColumns(dayWidth, compact)
  const showTime = !compact || dayWidth >= 100

  return blocks
    .map((b) => {
      const id = String(b.event.occurrenceId || b.event.id)
      const color = b.event.color || 'var(--rde-event-default)'
      let col = b.col
      let colCount = b.colCount
      if (compact && colCount > maxCols) {
        colCount = maxCols
        col = Math.min(col, maxCols - 1)
      }
      const width = 100 / colCount
      const left = col * width
      const time = formatTime(b.event.start, ctx.locale)
      const timeHtml =
        showTime && b.height >= 26
          ? `<small>${escapeHtml(time)}${b.event.location ? ' · ' + escapeHtml(b.event.location) : ''}</small>`
          : ''
      const titleOnly = b.height < 22
      const handles = isEventEditable(b.event, ctx.editable) ? resizeHandlesHtml('ns') : ''
      return `<button type="button" class="rde-block${titleOnly ? ' rde-block--compact' : ''}" data-event-id="${escapeAttr(id)}" data-editable="${eventEditableAttr(b.event, ctx.editable)}" style="--rde-event-color:${escapeAttr(color)};top:${b.top}px;height:${b.height}px;left:calc(${left}% + 2px);width:calc(${width}% - 4px)" title="${escapeAttr(b.event.title)}"><span class="rde-block__title">${escapeHtml(b.event.title)}</span>${timeHtml}${handles}</button>`
    })
    .join('')
}

export class TimeStripController {
  private host: HTMLElement | null = null
  private headsEl: HTMLElement | null = null
  private stripEl: HTMLElement | null = null
  private headsStripEl: HTMLElement | null = null
  private viewportEl: HTMLElement | null = null
  private ctx: ViewContext | null = null
  private scroller: TranslateStrip | null = null
  private mode: StripMode
  private events: NormalizedEvent[] = []
  private byDay = new Map<string, NormalizedEvent[]>()
  private lastAnchorKey = ''
  private activeIndex: number | null = null
  private hoursH = 0
  private segH = 0
  private segW = 0
  private dayWidth = 0
  private allDayH = 0
  private cols = 1
  private resizeObs: ResizeObserver | null = null
  private resizeRaf = 0
  private eventsFp = ''
  private timeScrollEl: HTMLElement | null = null
  private timeInnerEl: HTMLElement | null = null
  private yPan: BoundPan | null = null
  private unbindKeys: (() => void) | null = null
  private previewKeys: string[] = []

  constructor(mode: StripMode) {
    this.mode = mode
  }

  mount(ctx: ViewContext): void {
    this.destroy()
    this.ctx = ctx
    this.host = ctx.root
    this.events = ctx.events
    this.indexEvents(ctx.events)
    this.eventsFp = eventsFingerprint(ctx.events)
    this.hoursH = hoursHeight(ctx)
    this.cols = this.mode === 'week' ? 7 : 1
    const horizontal = this.mode === 'week'
    const hasAllDay = this.hasAllDayEvents()
    this.allDayH = hasAllDay ? ALL_DAY_ROW_PX : 0
    this.segH = horizontal ? this.hoursH : this.hoursH + this.allDayH

    if (horizontal) {
      this.host.innerHTML = `
        <div class="rde-timegrid rde-timegrid--infinite rde-timegrid--week rde-timegrid--x rde-pan" tabindex="0" style="--rde-week-seg-h:${this.segH}px">
          <div class="rde-tg-main">
            <div class="rde-tg-week-top">
              <div class="rde-tg-corner-col">
                <div class="rde-tg-corner" style="height:${HEAD_PX}px"></div>
                ${this.allDayH ? `<div class="rde-tg-corner-spacer" style="height:${this.allDayH}px"></div>` : ''}
              </div>
              <div class="rde-tg-heads-viewport">
                <div class="rde-tg-heads-strip" data-heads-strip></div>
              </div>
            </div>
            <div class="rde-tg-body-scroll" data-time-scroll>
              <div class="rde-tg-week-scroll-inner" data-time-inner style="height:${this.segH}px">
                <div class="rde-tg-week-grid">
                  <div class="rde-tg-rail-col">
                    ${hourLabelsHtml(ctx)}
                  </div>
                  <div class="rde-viewport rde-tg-viewport" data-viewport style="height:${this.segH}px">
                    <div class="rde-strip rde-strip--x" data-strip></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          ${panChromeHtml(ctx.locale)}
        </div>
      `
    } else {
      this.host.innerHTML = `
        <div class="rde-timegrid rde-timegrid--infinite rde-timegrid--day">
          <div class="rde-tg-sticky">
            <div class="rde-tg-corner"></div>
            <div class="rde-tg-heads" data-heads></div>
          </div>
          <div class="rde-viewport rde-tg-viewport" data-viewport>
            <div class="rde-strip" data-strip></div>
          </div>
        </div>
      `
    }

    this.headsEl = this.host.querySelector('[data-heads]')
    if (this.headsEl) {
      this.dayWidth = this.calcDayWidth()
      this.headsEl.style.gridTemplateColumns = columnGrid(this.cols, ctx.compact, this.dayWidth)
    }
    this.stripEl = this.host.querySelector('[data-strip]')
    this.headsStripEl = horizontal ? this.host.querySelector('[data-heads-strip]') : null
    this.viewportEl = this.host.querySelector('[data-viewport]') as HTMLElement
    if (horizontal) {
      this.timeScrollEl = this.host.querySelector('[data-time-scroll]')
      this.timeInnerEl = this.host.querySelector('[data-time-inner]')
      if (this.timeScrollEl && this.timeInnerEl) {
        this.yPan = new BoundPan(this.timeScrollEl, this.timeInnerEl, () => this.refreshPanHints())
      }
      this.host.addEventListener('wheel', this.onWeekHostWheel, { passive: false, capture: true })
      const pane = this.host.querySelector<HTMLElement>('.rde-timegrid--week')
      if (pane) {
        this.unbindKeys = bindPanKeys(pane, {
          canX: () => true,
          canY: () => this.yPan?.canScroll() === true,
          nudgeX: (delta) => this.scroller?.nudgeBy(delta),
          nudgeY: (delta) => this.yPan?.nudge(delta)
        })
      }
    }

    this.updateWeekMetrics()

    const stripOpts = horizontal
      ? {
          axis: 'x' as const,
          wheelMode: 'y-as-x' as const,
          wheelInvert: true,
          wheelEnabled: false,
          segmentSize: this.segW,
          bufferSize: 12,
          prefetchSegments: 2,
          minIndex: ctx.minWeekIndex,
          maxIndex: ctx.maxWeekIndex,
          syncTransformEl: this.headsStripEl ?? undefined
        }
      : {
          axis: 'y' as const,
          segmentSize: this.segH,
          bufferSize: 12,
          prefetchSegments: 2,
          minIndex: ctx.minDayIndex,
          maxIndex: ctx.maxDayIndex
        }

    this.scroller = new TranslateStrip(
      this.viewportEl,
      this.stripEl!,
      stripOpts,
      {
        paint: (start, count) => this.paint(start, count),
        onSettle: (idx) => this.onSettle(idx),
        onRangeChange: (start, count) => this.emitRange(start, count),
        insertStart: (from, n) => this.insertSegments(from, n, 'start'),
        insertEnd: (from, n) => this.insertSegments(from, n, 'end'),
        removeStart: (n) => this.removeSegments(n, 'start'),
        removeEnd: (n) => this.removeSegments(n, 'end'),
        onSegmentSize: (size) => this.applySegmentWidth(size)
      }
    )

    const center = horizontal
      ? dateToWeekIndex(ctx.cursor, ctx.firstDayOfWeek)
      : dateToDayIndex(ctx.cursor)

    this.activeIndex = center
    this.scroller.reset(center, { align: 'start' })
    this.scroller.start()
    this.applyGridHeight()
    this.yPan?.apply()
    this.refreshPanHints()

    if (this.mode === 'day') {
      requestAnimationFrame(() => {
        this.syncActiveHighlight()
        this.syncDaySegmentHeight()
      })
    } else {
      requestAnimationFrame(() => {
        this.applyGridHeight()
        this.syncActiveHighlight()
      })
    }

    if (horizontal && typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => {
        if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf)
        this.resizeRaf = requestAnimationFrame(() => {
          this.resizeRaf = 0
          this.onViewportResize()
          this.applyGridHeight()
        })
      })
      this.resizeObs.observe(this.viewportEl)
      const weekTop = this.host.querySelector('.rde-tg-week-top')
      if (weekTop) this.resizeObs.observe(weekTop)
    }

    this.host.addEventListener('click', this.onClick)
  }

  applyLayout(patch: LayoutPatch): void {
    if (!this.ctx || !this.scroller) return
    const prevCompact = this.ctx.compact
    this.ctx = { ...this.ctx, compact: patch.compact, layoutWidth: patch.layoutWidth }

    if (this.mode === 'week') {
      const prevSegW = this.segW
      this.updateWeekMetrics()
      if (Math.abs(this.segW - prevSegW) >= 8 || prevCompact !== patch.compact) {
        this.scroller.setSegmentSize(this.segW)
        this.repaintVisible()
      }
    } else if (prevCompact !== patch.compact) {
      this.repaintVisible()
    }
  }

  syncEvents(events: NormalizedEvent[]): void {
    const fp = eventsFingerprint(events)
    if (fp === this.eventsFp) return
    this.eventsFp = fp
    this.events = events
    this.indexEvents(events)
    this.refreshDayBlocks()
  }

  private indexEvents(events: NormalizedEvent[]): void {
    this.byDay = indexEventsByDay(events)
  }

  goToDate(date: Date): void {
    if (!this.scroller || !this.ctx) return
    const idx =
      this.mode === 'week'
        ? dateToWeekIndex(date, this.ctx.firstDayOfWeek)
        : dateToDayIndex(date)
    this.activeIndex = idx
    this.lastAnchorKey = ''
    this.scroller.reset(idx, { align: 'start' })
  }

  nudge(delta: number): void {
    this.scroller?.nudgeBy(delta)
  }

  scrollTimeBand(delta: number): void {
    this.yPan?.nudge(-delta)
  }

  previewTimedMove(
    id: string,
    start: Date,
    end: Date,
    originDay: Date,
    _resourceId?: string
  ): { top: number; height: number; leftPct: number; widthPct: number } | null {
    if (!this.stripEl || !this.ctx) return null
    const preview = this.events.map((ev) =>
      String(ev.occurrenceId || ev.id) === id ? { ...ev, start, end } : ev
    )
    const byDay = indexEventsByDay(preview)
    const keys = new Set<string>([
      ...this.previewKeys,
      ...eachDayKey(originDay, start),
      ...eachDayKey(start, end)
    ])
    const ghostDay = dayKey(start)
    let slot: { top: number; height: number; leftPct: number; widthPct: number } | null = null
    for (const key of keys) {
      this.stripEl.querySelectorAll<HTMLElement>(`.rde-tg-col[data-day="${key}"]`).forEach((col) => {
        const found = this.paintLiveColumn(col, byDay, id, key === ghostDay)
        if (key === ghostDay && found) slot = found
      })
    }
    this.previewKeys = [...keys]
    return slot
  }

  clearTimedPreview(): void {
    if (!this.previewKeys.length) return
    this.previewKeys = []
    this.refreshDayBlocks()
  }

  private paintLiveColumn(
    col: HTMLElement,
    byDay: Map<string, NormalizedEvent[]>,
    movingId: string,
    hideMoving: boolean
  ): { top: number; height: number; leftPct: number; widthPct: number } | null {
    if (!this.ctx || !col.dataset.day) return null
    const day = parseDayKey(col.dataset.day)
    const { start, end } = this.ctx.visibleHours
    const blocks = layoutDayBlocks(eventsOnDay(byDay, day), day, start, end)
    const compact = this.ctx.compact
    const maxCols = maxOverlapColumns(this.dayWidth, compact)
    const byId = new Map<string, (typeof blocks)[number]>()
    for (const b of blocks) {
      let colI = b.col
      let colCount = b.colCount
      if (compact && colCount > maxCols) {
        colCount = maxCols
        colI = Math.min(colI, maxCols - 1)
      }
      byId.set(String(b.event.occurrenceId || b.event.id), { ...b, col: colI, colCount })
    }

    col.querySelectorAll('.rde-tg-slot, .rde-block--live').forEach((el) => el.remove())

    col.querySelectorAll<HTMLElement>('.rde-block[data-event-id]').forEach((el) => {
      const id = el.dataset.eventId || ''
      if (id === movingId && hideMoving) {
        el.style.opacity = '0'
        el.style.pointerEvents = 'none'
        return
      }
      const b = byId.get(id)
      if (!b) {
        el.style.opacity = '0'
        return
      }
      const box = blockBoxStyle(b)
      el.style.top = box.top
      el.style.height = box.height
      el.style.left = box.left
      el.style.width = box.width
      el.style.opacity = ''
      el.style.pointerEvents = id === movingId ? 'none' : ''
    })

    const mine = byId.get(movingId)
    if (!mine) return null
    const widthPct = 100 / Math.max(1, mine.colCount)
    const mark = document.createElement('div')
    mark.className = 'rde-tg-slot'
    mark.style.top = `${mine.top}px`
    mark.style.height = `${mine.height}px`
    mark.style.left = `calc(${mine.col * widthPct}% + 2px)`
    mark.style.width = `calc(${widthPct}% - 4px)`
    col.appendChild(mark)
    return {
      top: mine.top,
      height: mine.height,
      leftPct: mine.col * widthPct,
      widthPct
    }
  }

  destroy(): void {
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf)
    this.resizeRaf = 0
    this.resizeObs?.disconnect()
    this.resizeObs = null
    this.host?.removeEventListener('wheel', this.onWeekHostWheel, { capture: true })
    this.unbindKeys?.()
    this.unbindKeys = null
    this.scroller?.stop()
    this.scroller = null
    this.yPan = null
    this.host?.removeEventListener('click', this.onClick)
    if (this.host) this.host.innerHTML = ''
    this.host = null
    this.headsEl = null
    this.stripEl = null
    this.headsStripEl = null
    this.viewportEl = null
    this.timeScrollEl = null
    this.timeInnerEl = null
    this.ctx = null
    this.activeIndex = null
    this.previewKeys = []
  }

  private calcDayWidth(): number {
    if (!this.viewportEl || !this.ctx) return 120
    if (this.mode !== 'week') {
      return Math.max(280, this.viewportEl.clientWidth || 800)
    }
    return weekLayoutMetrics(this.viewportEl.clientWidth, this.ctx.compact).dayWidth
  }

  private applyGridHeight(): void {
    if (!this.host || !this.ctx) return
    const grid = this.host.querySelector<HTMLElement>('.rde-timegrid')
    if (!grid) return
    const top = this.host.querySelector<HTMLElement>('.rde-tg-week-top, .rde-tg-sticky')
    const headerH = top?.offsetHeight || HEAD_PX + (this.mode === 'week' ? this.allDayH : 0)
    const bodyContent = this.hoursH + (this.mode === 'day' ? this.allDayH : 0)
    const cs = getComputedStyle(grid)
    const frame =
      (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    const availableBody = TIMEGRID_MAX_PX - frame - headerH

    if (this.mode === 'week' && this.timeScrollEl) {
      const needsY = canPanY(this.hoursH, availableBody)
      const bodyH = needsY ? Math.max(80, availableBody) : this.hoursH
      grid.style.height = needsY ? `${TIMEGRID_MAX_PX}px` : ''
      grid.style.maxHeight = `${TIMEGRID_MAX_PX}px`
      this.timeScrollEl.style.height = `${bodyH}px`
      this.timeScrollEl.style.flex = needsY ? '1 1 auto' : '0 0 auto'
      this.yPan?.setContentSize(this.hoursH)
      this.yPan?.setViewSize(bodyH)
    } else {
      const gridH = Math.min(TIMEGRID_MAX_PX, headerH + bodyContent + frame)
      grid.style.height = `${gridH}px`
      grid.style.maxHeight = `${TIMEGRID_MAX_PX}px`
      if (this.viewportEl) {
        this.viewportEl.style.height = `${Math.max(80, gridH - frame - HEAD_PX)}px`
      }
    }

    this.yPan?.setOffset(this.yPan.offset)
    this.refreshPanHints()
  }

  private updateWeekMetrics(): void {
    if (!this.viewportEl || !this.ctx || this.mode !== 'week') return
    const rail = this.ctx.compact ? 46 : 52
    const vw =
      this.viewportEl.clientWidth ||
      Math.max(280, (this.ctx.layoutWidth || 800) - rail)
    const { segW, dayWidth } = weekLayoutMetrics(vw, this.ctx.compact)
    this.segW = segW
    this.dayWidth = dayWidth
  }

  private onViewportResize(): void {
    if (!this.viewportEl || !this.scroller || !this.ctx || this.mode !== 'week') return
    const prevSegW = this.segW
    this.updateWeekMetrics()
    if (Math.abs(this.segW - prevSegW) < 8) return
    this.scroller.setSegmentSize(this.segW)
    if (this.ctx.compact) {
      this.repaintVisible()
    } else {
      this.applySegmentWidth(this.segW)
    }
  }

  private syncDaySegmentHeight(): void {
    if (!this.scroller || !this.stripEl || this.mode !== 'day') return
    const seg = this.stripEl.querySelector<HTMLElement>('.rde-time-seg')
    if (!seg) return
    const measured = seg.offsetHeight
    if (measured > 0 && Math.abs(measured - this.segH) >= 2) {
      this.segH = measured
      this.scroller.setSegmentSize(measured)
    }
  }

  private repaintVisible(): void {
    if (!this.scroller || !this.stripEl) return
    const { startIndex, count } = this.scroller.state
    this.paint(startIndex, count)
    if (this.mode === 'day') {
      requestAnimationFrame(() => this.syncDaySegmentHeight())
    }
  }

  private hasAllDayEvents(): boolean {
    return this.events.some((e) => e.allDay)
  }

  private allDayRowHtml(days: Date[]): string {
    if (!this.ctx || !this.allDayH) return ''
    const cols = columnGrid(days.length, this.ctx.compact, this.dayWidth)
    const cells = days
      .map((d) => {
        const evs = allDayEventsForDay(this.events, d)
        return `<div class="rde-allday-col" data-day="${dayKey(d)}">${renderAllDayHtml(evs, this.ctx!.locale, this.ctx!.editable)}</div>`
      })
      .join('')
    return `<div class="rde-allday-row" style="height:${this.allDayH}px;grid-template-columns:${cols}">${cells}</div>`
  }

  private segmentDates(absIndex: number): Date[] {
    if (!this.ctx) return []
    if (this.mode === 'week') {
      const start = weekIndexToDate(absIndex, this.ctx.firstDayOfWeek)
      return Array.from({ length: 7 }, (_, i) => addDays(start, i))
    }
    return [dayIndexToDate(absIndex)]
  }

  private headSegmentHtml(abs: number): string {
    if (!this.ctx) return ''
    const days = this.segmentDates(abs)
    const isActive = this.activeIndex !== null && abs === this.activeIndex
    const sizeStyle = `width:${this.segW}px;min-width:${this.segW}px;max-width:${this.segW}px`
    const parts = [
      `<div class="rde-week-head-seg${isActive ? ' is-active' : ''}" data-seg="${abs}" style="${sizeStyle}">`,
      headsHtml(days, this.ctx, this.mode, this.dayWidth)
    ]
    if (this.allDayH) parts.push(this.allDayRowHtml(days))
    parts.push('</div>')
    return parts.join('')
  }

  private segmentHtml(abs: number, withEvents: boolean): string {
    if (!this.ctx) return ''
    const horizontal = this.mode === 'week'
    const days = this.segmentDates(abs)
    const active = this.activeIndex
    const isActive = active !== null && abs === active
    const colGrid = columnGrid(this.cols, this.ctx.compact && horizontal, this.dayWidth)
    const sizeStyle = horizontal
      ? `width:${this.segW}px;min-width:${this.segW}px;max-width:${this.segW}px;height:${this.segH}px`
      : `height:${this.segH}px`
    const parts: string[] = [
      `<div class="rde-time-seg${horizontal ? ' rde-time-seg--x' : ''}${isActive ? ' is-active' : ''}" data-seg="${abs}" style="${sizeStyle}">`
    ]
    if (horizontal) {
      parts.push(
        `<div class="rde-time-seg__cols" style="height:${this.hoursH}px;grid-template-columns:${colGrid}">`
      )
    } else {
      if (this.allDayH) parts.push(this.allDayRowHtml(days))
      parts.push(hourLabelsHtml(this.ctx))
      parts.push(
        `<div class="rde-time-seg__cols" style="height:${this.hoursH}px;grid-template-columns:${colGrid}">`
      )
    }
    for (const day of days) {
      const key = dayKey(day)
      const body = withEvents ? blocksHtml(this.byDay, day, this.ctx, this.dayWidth) : ''
      parts.push(
        `<div class="rde-tg-col${!horizontal && isActive ? ' is-active' : ''}" data-day="${key}">${body}</div>`
      )
    }
    parts.push('</div></div>')
    return parts.join('')
  }

  private paint(startIndex: number, count: number): void {
    if (!this.stripEl || !this.ctx) return
    const parts: string[] = []
    for (let i = 0; i < count; i++) parts.push(this.segmentHtml(startIndex + i, true))
    this.stripEl.innerHTML = parts.join('')
    if (this.mode === 'week' && this.headsStripEl) {
      const headParts: string[] = []
      for (let i = 0; i < count; i++) headParts.push(this.headSegmentHtml(startIndex + i))
      this.headsStripEl.innerHTML = headParts.join('')
    }
    this.syncActiveHighlight()
  }

  private insertSegments(fromAbs: number, n: number, side: 'start' | 'end'): void {
    if (!this.stripEl || n <= 0) return
    const html = Array.from({ length: n }, (_, i) => this.segmentHtml(fromAbs + i, true)).join('')
    if (side === 'start') this.stripEl.insertAdjacentHTML('afterbegin', html)
    else this.stripEl.insertAdjacentHTML('beforeend', html)
    if (this.mode === 'week' && this.headsStripEl) {
      const headHtml = Array.from({ length: n }, (_, i) => this.headSegmentHtml(fromAbs + i)).join('')
      if (side === 'start') this.headsStripEl.insertAdjacentHTML('afterbegin', headHtml)
      else this.headsStripEl.insertAdjacentHTML('beforeend', headHtml)
    }
    this.syncActiveHighlight()
  }

  private removeSegments(n: number, side: 'start' | 'end'): void {
    if (!this.stripEl || n <= 0) return
    for (let i = 0; i < n; i++) {
      const child =
        side === 'start' ? this.stripEl.firstElementChild : this.stripEl.lastElementChild
      child?.remove()
    }
    if (this.mode === 'week' && this.headsStripEl) {
      for (let i = 0; i < n; i++) {
        const child =
          side === 'start'
            ? this.headsStripEl.firstElementChild
            : this.headsStripEl.lastElementChild
        child?.remove()
      }
    }
  }

  private applySegmentWidth(size: number): void {
    this.segW = size
    if (!this.stripEl) return
    const apply = (selector: string): void => {
      this.stripEl!.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        el.style.width = `${size}px`
        el.style.minWidth = `${size}px`
        el.style.maxWidth = `${size}px`
      })
    }
    if (this.ctx?.compact) return
    apply('.rde-time-seg--x')
    this.headsStripEl?.querySelectorAll<HTMLElement>('.rde-week-head-seg').forEach((el) => {
      el.style.width = `${size}px`
      el.style.minWidth = `${size}px`
      el.style.maxWidth = `${size}px`
    })
  }

  private refreshDayBlocks(): void {
    if (!this.stripEl || !this.ctx) return
    this.stripEl.querySelectorAll<HTMLElement>('.rde-tg-col[data-day]').forEach((col) => {
      const key = col.dataset.day
      if (!key) return
      const [y, m, d] = key.split('-').map(Number)
      col.innerHTML = blocksHtml(this.byDay, new Date(y, m - 1, d), this.ctx!, this.dayWidth)
    })
  }

  private updateHeader(days: Date[]): void {
    if (!this.headsEl || !this.ctx) return
    this.headsEl.innerHTML = days
      .map((d) => {
        const label = new Intl.DateTimeFormat(this.ctx!.locale, {
          weekday: 'short',
          day: 'numeric',
          ...(this.mode === 'day' ? { month: 'short' as const } : {})
        }).format(d)
        return `<div class="rde-tg-head${sameDay(d, new Date()) ? ' is-today' : ''} is-active" data-day="${dayKey(d)}">${escapeHtml(label)}</div>`
      })
      .join('')
  }

  private onSettle(abs: number): void {
    if (!this.scroller || !this.ctx) return
    this.activeIndex = abs
    const days = this.segmentDates(abs)
    if (this.mode === 'day') {
      this.updateHeader(days)
    }
    this.syncActiveHighlight()

    const anchor =
      this.mode === 'week'
        ? startOfWeek(days[0], this.ctx.firstDayOfWeek)
        : days[0]
    const key = dayKey(anchor)
    if (key !== this.lastAnchorKey) {
      this.lastAnchorKey = key
      this.ctx.onAnchorChange(anchor)
    }
  }

  private syncActiveHighlight(): void {
    if (!this.stripEl || this.activeIndex === null) return
    const active = this.activeIndex
    if (this.mode === 'week') {
      this.headsStripEl?.querySelectorAll<HTMLElement>('.rde-week-head-seg[data-seg]').forEach((seg) => {
        seg.classList.toggle('is-active', Number(seg.dataset.seg) === active)
      })
      this.stripEl.querySelectorAll<HTMLElement>('.rde-time-seg--x[data-seg]').forEach((seg) => {
        seg.classList.toggle('is-active', Number(seg.dataset.seg) === active)
      })
      return
    }
    if (this.mode === 'day') {
      this.stripEl.querySelectorAll<HTMLElement>('.rde-time-seg[data-seg]').forEach((seg) => {
        const on = Number(seg.dataset.seg) === active
        seg.classList.toggle('is-active', on)
        seg.querySelectorAll('.rde-tg-col').forEach((col) => {
          col.classList.toggle('is-active', on)
        })
      })
    }
  }

  private emitRange(startIndex: number, count: number): void {
    if (!this.ctx) return
    if (this.mode === 'week') {
      const from = weekIndexToDate(startIndex, this.ctx.firstDayOfWeek)
      const to = addDays(
        weekIndexToDate(startIndex + count - 1, this.ctx.firstDayOfWeek),
        6
      )
      this.ctx.onRangeChange({ from, to })
    } else {
      const from = dayIndexToDate(startIndex)
      const to = addDays(dayIndexToDate(startIndex + count - 1), 1)
      this.ctx.onRangeChange({ from, to })
    }
  }

  private refreshPanHints(): void {
    const pane = this.host?.querySelector<HTMLElement>('.rde-timegrid--week')
    if (!pane) return
    const y = this.yPan
    syncPanHints(pane, {
      canX: true,
      canY: y?.canScroll() === true,
      yAtStart: y?.atStart() !== false,
      yAtEnd: y?.atEnd() !== false
    })
  }

  private onWeekHostWheel = (e: WheelEvent): void => {
    if (this.mode !== 'week' || !this.scroller) return
    const route = routePanWheel(e, true, this.yPan?.canScroll() === true)
    if (!route) return
    e.preventDefault()
    e.stopPropagation()
    if (route.axis === 'x') this.scroller.nudgeBy(route.delta)
    else this.yPan?.nudge(route.delta)
    this.refreshPanHints()
  }

  private onClick = (e: MouseEvent): void => {
    if (!this.ctx) return
    const t = e.target as HTMLElement
    const eventBtn = t.closest<HTMLElement>('[data-event-id]')
    if (eventBtn?.dataset.eventId) {
      const ev = this.ctx.getEvent(eventBtn.dataset.eventId)
      if (ev) {
        e.stopPropagation()
        this.ctx.onEventClick(ev, e)
      }
      return
    }
    if (t.closest('[data-resize]')) return
    const openEl = t.closest<HTMLElement>('[data-open-day]')
    if (openEl?.dataset.openDay && this.mode === 'week') {
      e.stopPropagation()
      this.ctx.onDayOpen(parseDayKey(openEl.dataset.openDay))
      return
    }
    const dayEl = t.closest<HTMLElement>('[data-day]')
    if (dayEl?.dataset.day) {
      const [y, m, d] = dayEl.dataset.day.split('-').map(Number)
      const date = new Date(y, m - 1, d)
      if (this.ctx.isDateDisabled(date)) return
      this.ctx.onDateClick(date, e)
    }
  }
}
